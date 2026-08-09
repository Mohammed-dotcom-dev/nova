import { supabase } from "./supabaseClient.js";

export interface AgentStreamEvent {
  type: "status" | "tool_call" | "tool_result" | "text_delta" | "error" | "final" | "conversation";
  detail?: string;
  data?: unknown;
}

// fetch + ReadableStream instead of EventSource, since EventSource can't send
// a POST body or custom Authorization header and this endpoint needs both.
export async function* streamChat(
  message: string,
  history: { role: "user" | "assistant"; content: string }[],
  conversationId?: string
): AsyncGenerator<AgentStreamEvent> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    yield { type: "error", detail: "Not signed in" };
    return;
  }

  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message, history, conversationId }),
  });

  if (!res.ok || !res.body) {
    yield { type: "error", detail: `Request failed: HTTP ${res.status}` };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const lines = chunk.split("\n");
      const eventLine = lines.find((l) => l.startsWith("event:"));
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (!eventLine || !dataLine) continue;

      const type = eventLine.slice(6).trim() as AgentStreamEvent["type"];
      try {
        const parsed = JSON.parse(dataLine.slice(5).trim());
        yield { type, detail: parsed.detail, data: parsed.data };
      } catch {
        continue;
      }
    }
  }
}
