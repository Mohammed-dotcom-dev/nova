import { NovaDb } from "../db/supabaseClient.js";
import { ModelRouter } from "../providers/router.js";
import { ChatMessage, ProviderError } from "../providers/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ToolContext } from "../tools/types.js";
import { MemoryService } from "../memory/memoryService.js";
import { writeAuditLog } from "../security/middleware.js";

export interface AgentEvent {
  type: "status" | "tool_call" | "tool_result" | "text_delta" | "error" | "final";
  detail?: string;
  data?: unknown;
}

const SYSTEM_PROMPT = `You are NOVA, a personal AI agent.
- Use tools when they let you answer with real, verified information instead of guessing.
- Never claim to have done something (fetched a page, run code) that you did not actually do via a tool.
- Be concise. Match the user's tone.`;

const MAX_TOOL_ITERATIONS = 4;

export async function* runAgentLoop(params: {
  router: ModelRouter;
  tools: ToolRegistry;
  memory: MemoryService;
  db: NovaDb;
  userId: string;
  conversationId: string;
  userMessage: string;
  history: ChatMessage[];
}): AsyncGenerator<AgentEvent> {
  const { router, tools, memory, db, userId, conversationId, userMessage, history } = params;

  yield { type: "status", detail: "Understanding request" };

  const { data: run, error: runError } = await db
    .from("agent_runs")
    .insert({ user_id: userId, conversation_id: conversationId, status: "running" })
    .select("id")
    .single();

  const agentRunId: string | null = runError ? null : run?.id ?? null;

  const logEvent = async (eventType: string, detail?: string, data?: unknown) => {
    if (!agentRunId) return;
    await db.from("agent_events").insert({ agent_run_id: agentRunId, event_type: eventType, detail, data: data ?? null });
  };

  await logEvent("status", "Understanding request");

  const recalled = await memory.recall(db, userId, userMessage, 5);
  const memoryContext = recalled.length
    ? `Relevant things you know about this user:\n${recalled.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(memoryContext ? [{ role: "system" as const, content: memoryContext }] : []),
    ...history,
    { role: "user", content: userMessage },
  ];

  let iterations = 0;
  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    let result;
    try {
      result = await router.chat("tool_heavy", { messages, tools: tools.toProviderDefinitions() });
    } catch (err) {
      const message = err instanceof ProviderError ? humanizeProviderError(err) : "Something went wrong talking to the model.";
      await logEvent("error", message);
      if (agentRunId) await db.from("agent_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", agentRunId);
      yield { type: "error", detail: message };
      yield { type: "final", data: { content: message } };
      return;
    }

    if (result.finishReason !== "tool_calls" || result.toolCalls.length === 0) {
      yield { type: "status", detail: "Preparing response" };
      await logEvent("final", undefined, { content: result.content });
      if (agentRunId) await db.from("agent_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", agentRunId);
      yield { type: "final", data: { content: result.content } };
      return;
    }

    messages.push({ role: "assistant", content: result.content ?? "" });

    for (const call of result.toolCalls) {
      yield { type: "tool_call", detail: call.name, data: call.arguments };
      await logEvent("tool_call", call.name, call.arguments);

      const startedAt = Date.now();
      const toolResult = await tools.run(call.name, call.arguments, { userId, requestId: agentRunId ?? "unknown" } satisfies ToolContext);
      const latencyMs = Date.now() - startedAt;

      const tool = tools.get(call.name);
      await writeAuditLog(
        db,
        userId,
        `tool:${call.name}`,
        tool?.riskLevel ?? "moderate",
        toolResult.ok ? "allowed" : "error",
        { arguments: call.arguments, latencyMs }
      );
      await db.from("tool_runs").insert({
        user_id: userId,
        agent_run_id: agentRunId,
        tool_name: call.name,
        input: call.arguments,
        output: toolResult.ok ? toolResult.data : null,
        ok: toolResult.ok,
        error: toolResult.ok ? null : toolResult.error,
        latency_ms: latencyMs,
      });

      yield { type: "tool_result", detail: call.name, data: toolResult.ok ? { ok: true } : { ok: false, error: toolResult.error } };
      await logEvent("tool_result", call.name, { ok: toolResult.ok, error: toolResult.error });

      messages.push({
        role: "tool",
        content: toolResult.ok ? JSON.stringify(toolResult.data) : `Tool failed: ${toolResult.error}`,
        toolCallId: call.id,
        name: call.name,
      });
    }

    yield { type: "status", detail: "Verifying results" };
    await logEvent("status", "Verifying results");
  }

  const timeoutMessage = "I hit the tool-call limit for this turn without reaching a final answer. Want me to keep going?";
  if (agentRunId) await db.from("agent_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", agentRunId);
  yield { type: "final", data: { content: timeoutMessage } };
}

function humanizeProviderError(err: ProviderError): string {
  switch (err.kind) {
    case "auth":
      return "I couldn't authenticate with the AI provider — check that the API key is set correctly.";
    case "rate_limit":
      return "The AI provider is rate-limiting requests right now. Try again in a moment.";
    case "network":
      return "I couldn't reach the AI provider (network issue). Try again shortly.";
    default:
      return "The AI provider returned something I couldn't use. Try rephrasing or try again.";
  }
}
