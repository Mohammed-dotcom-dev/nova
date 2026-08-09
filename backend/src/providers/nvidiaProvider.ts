import {
  AIProvider,
  ChatOptions,
  ChatResult,
  ProviderError,
  StreamChunk,
  ToolCallRequest,
} from "./types.js";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

interface NvidiaProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

// Thin adapter over NVIDIA's OpenAI-compatible /chat/completions endpoint.
// Kept isolated behind AIProvider so swapping to Anthropic/OpenAI later
// never touches the agent core, router, or tool executor.
export class NvidiaProvider implements AIProvider {
  readonly id = "nvidia";
  readonly supportsTools = true;

  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(config: NvidiaProviderConfig) {
    if (!config.apiKey) {
      throw new ProviderError("NVIDIA API key is missing", "nvidia", "auth", false);
    }
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? NVIDIA_BASE_URL;
  }

  private toOpenAiMessages(options: ChatOptions) {
    return options.messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.toolCallId, name: m.name };
      }
      return { role: m.role, content: m.content };
    });
  }

  private toOpenAiTools(options: ChatOptions) {
    if (!options.tools || options.tools.length === 0) return undefined;
    return options.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }

  private async request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: body.stream ? "text/event-stream" : "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      throw new ProviderError(
        `Network error calling NVIDIA API: ${(err as Error).message}`,
        "nvidia",
        "network",
        true
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderError("NVIDIA API authentication failed", "nvidia", "auth", false);
    }
    if (res.status === 429) {
      throw new ProviderError("NVIDIA API rate limit hit", "nvidia", "rate_limit", true);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderError(
        `NVIDIA API returned ${res.status}: ${text.slice(0, 300)}`,
        "nvidia",
        res.status >= 500 ? "network" : "invalid_response",
        res.status >= 500
      );
    }
    return res;
  }

  async chat(options: ChatOptions): Promise<ChatResult> {
    const res = await this.request({
      model: this.model,
      messages: this.toOpenAiMessages(options),
      tools: this.toOpenAiTools(options),
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 1024,
      stream: false,
    });

    const data = (await res.json()) as any;
    const choice = data.choices?.[0];
    if (!choice) {
      throw new ProviderError("NVIDIA API returned no choices", "nvidia", "invalid_response", true);
    }

    const toolCalls: ToolCallRequest[] = (choice.message?.tool_calls ?? []).map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: safeJsonParse(tc.function?.arguments),
    }));

    return {
      content: choice.message?.content ?? "",
      toolCalls,
      finishReason: mapFinishReason(choice.finish_reason),
      raw: data,
    };
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamChunk> {
    const res = await this.request({
      model: this.model,
      messages: this.toOpenAiMessages(options),
      tools: this.toOpenAiTools(options),
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 1024,
      stream: true,
    });

    if (!res.body) {
      yield { type: "error", error: "No response body from NVIDIA API" };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    // Accumulate partial tool-call deltas keyed by index, since streamed tool
    // calls arrive as fragments of name/arguments across multiple chunks.
    const toolCallAccum: Record<number, { id: string; name: string; args: string }> = {};

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            for (const idx of Object.keys(toolCallAccum)) {
              const acc = toolCallAccum[Number(idx)];
              yield {
                type: "tool_call",
                toolCall: { id: acc.id, name: acc.name, arguments: safeJsonParse(acc.args) },
              };
            }
            yield { type: "done" };
            return;
          }
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            yield { type: "text_delta", textDelta: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallAccum[idx]) {
                toolCallAccum[idx] = { id: tc.id ?? `call_${idx}`, name: "", args: "" };
              }
              if (tc.function?.name) toolCallAccum[idx].name += tc.function.name;
              if (tc.function?.arguments) toolCallAccum[idx].args += tc.function.arguments;
            }
          }
        }
      }
      yield { type: "done" };
    } catch (err) {
      yield { type: "error", error: (err as Error).message };
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const result = await this.chat({
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 4,
      } as ChatOptions);
      return { ok: true, detail: `model responded (${result.finishReason})` };
    } catch (err) {
      return { ok: false, detail: (err as Error).message };
    }
  }
}

function safeJsonParse(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function mapFinishReason(reason: string | undefined): ChatResult["finishReason"] {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "stop") return "stop";
  return "error";
}
