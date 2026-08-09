// Provider-independent contract. Every AI backend (NVIDIA NIM, Anthropic, OpenAI, etc.)
// implements this interface. The agent core never talks to a provider SDK directly.

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // present when role === "tool": which tool call this message is a result for
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinitionForProvider {
  name: string;
  description: string;
  // JSON schema for the tool's input
  inputSchema: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCallRequest[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  raw?: unknown;
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDefinitionForProvider[];
  temperature?: number;
  maxTokens?: number;
}

export interface StreamChunk {
  type: "text_delta" | "tool_call" | "done" | "error";
  textDelta?: string;
  toolCall?: ToolCallRequest;
  error?: string;
}

// Every provider must implement this. The agent core, router, and tool executor
// only ever depend on this interface — never on a specific vendor SDK.
export interface AIProvider {
  readonly id: string;
  readonly supportsTools: boolean;

  chat(options: ChatOptions): Promise<ChatResult>;
  stream(options: ChatOptions): AsyncIterable<StreamChunk>;

  // Lightweight reachability check used by the diagnostics system (section 33).
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly kind: "rate_limit" | "auth" | "network" | "invalid_response" | "unknown",
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
