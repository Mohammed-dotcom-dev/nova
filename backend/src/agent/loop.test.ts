import { describe, it, expect } from "vitest";
import { ModelRouter } from "../providers/router.js";
import { ToolRegistry } from "../tools/registry.js";
import { runAgentLoop } from "./loop.js";
import type { AIProvider, ChatOptions, ChatResult, StreamChunk } from "../providers/types.js";
import type { AgentTool, ToolResult } from "../tools/types.js";
import type { MemoryService } from "../memory/memoryService.js";
import type { NovaDb } from "../db/supabaseClient.js";

// Minimal chainable fake standing in for the Supabase query builder. Supports
// exactly the calls the agent loop makes (insert/update/select/single/eq),
// and is awaitable at any point in the chain since real supabase-js queries are too.
class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  constructor(private result: { data: any; error: any } = { data: { id: "fake-id" }, error: null }) {}
  select() { return this; }
  single() { return Promise.resolve(this.result); }
  eq() { return this; }
  neq() { return this; }
  order() { return this; }
  limit() { return this; }
  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled as any);
  }
}

function fakeDb(): NovaDb {
  return {
    from: () => ({
      insert: () => new FakeQuery(),
      update: () => new FakeQuery(),
      delete: () => new FakeQuery(),
      select: () => new FakeQuery({ data: [], error: null }),
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as NovaDb;
}

function fakeMemory(): MemoryService {
  return { recall: async () => [], remember: async () => ({ ok: true }) } as unknown as MemoryService;
}

// Fake provider: first call requests the "echo" tool, second call returns final text.
// Lets us verify the loop's tool-call -> observe -> verify -> synthesize path
// without hitting the real NVIDIA API (unreachable from this sandbox).
class FakeToolCallingProvider implements AIProvider {
  readonly id = "fake";
  readonly supportsTools = true;
  private callCount = 0;

  async chat(options: ChatOptions): Promise<ChatResult> {
    this.callCount++;
    if (this.callCount === 1) {
      return {
        content: "",
        toolCalls: [{ id: "call_1", name: "echo", arguments: { text: "hello" } }],
        finishReason: "tool_calls",
      };
    }
    const toolMsg = options.messages.find((m) => m.role === "tool");
    return {
      content: `Final answer using: ${toolMsg?.content ?? "nothing"}`,
      toolCalls: [],
      finishReason: "stop",
    };
  }

  async *stream(): AsyncIterable<StreamChunk> {
    yield { type: "done" };
  }

  async healthCheck() {
    return { ok: true };
  }
}

const echoTool: AgentTool = {
  name: "echo",
  description: "Echoes text back",
  riskLevel: "safe",
  timeoutMs: 1000,
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async execute(input): Promise<ToolResult> {
    const { text } = input as { text: string };
    return { ok: true, data: { echoed: text } };
  },
  verify(result) {
    const data = result.data as { echoed?: string } | undefined;
    return data?.echoed ? { ok: true } : { ok: false, reason: "no echoed field" };
  },
};

describe("agent loop", () => {
  it("executes a tool call, verifies it, and synthesizes a final answer", async () => {
    const router = new ModelRouter();
    router.register(new FakeToolCallingProvider());
    router.setRule({ taskType: "tool_heavy", providerIds: ["fake"] });

    const tools = new ToolRegistry();
    tools.register(echoTool);

    const events = [];
    for await (const ev of runAgentLoop({
      router,
      tools,
      memory: fakeMemory(),
      db: fakeDb(),
      userId: "test-user",
      conversationId: "test-conv",
      userMessage: "say hello",
      history: [],
    })) {
      events.push(ev);
    }

    const toolCallEvent = events.find((e) => e.type === "tool_call");
    const toolResultEvent = events.find((e) => e.type === "tool_result");
    const finalEvent = events.find((e) => e.type === "final");

    expect(toolCallEvent?.detail).toBe("echo");
    expect((toolResultEvent?.data as any).ok).toBe(true);
    expect((finalEvent?.data as any).content).toContain("echoed");
  });

  it("reports a clean error when the provider fails, never a stack trace", async () => {
    class FailingProvider implements AIProvider {
      readonly id = "failing";
      readonly supportsTools = true;
      async chat(): Promise<ChatResult> {
        throw new Error("boom");
      }
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: "error", error: "boom" };
      }
      async healthCheck() {
        return { ok: false, detail: "boom" };
      }
    }

    const router = new ModelRouter();
    router.register(new FailingProvider());
    router.setRule({ taskType: "tool_heavy", providerIds: ["failing"] });

    const tools = new ToolRegistry();
    const events = [];
    for await (const ev of runAgentLoop({
      router,
      tools,
      memory: fakeMemory(),
      db: fakeDb(),
      userId: "test-user",
      conversationId: "test-conv",
      userMessage: "hi",
      history: [],
    })) {
      events.push(ev);
    }

    const finalEvent = events.find((e) => e.type === "final");
    expect((finalEvent?.data as any).content).not.toContain("Error:");
    expect((finalEvent?.data as any).content.length).toBeGreaterThan(0);
  });
});
