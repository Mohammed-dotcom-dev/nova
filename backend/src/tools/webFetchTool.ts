import { AgentTool, ToolResult } from "./types.js";

// Basic SSRF guard: block obviously internal/loopback/link-local targets.
// Not exhaustive (a production system should resolve DNS and check the
// resolved IP too) but stops the naive cases.
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  if (lower === "0.0.0.0" || lower === "::1") return true;
  if (lower === "169.254.169.254") return true; // cloud metadata endpoint
  return false;
}

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  description: "Fetch a public web page and return its extracted text content.",
  riskLevel: "safe",
  timeoutMs: 15_000,
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Absolute http(s) URL to fetch" },
    },
    required: ["url"],
    additionalProperties: false,
  },

  async execute(input): Promise<ToolResult> {
    const { url } = input as { url?: string };
    if (!url) return { ok: false, error: "Missing required field: url" };

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `Invalid URL: ${url}` };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: `Unsupported protocol: ${parsed.protocol}` };
    }
    if (isBlockedHost(parsed.hostname)) {
      return { ok: false, error: `Refusing to fetch internal/blocked host: ${parsed.hostname}` };
    }

    try {
      const res = await fetch(parsed.toString(), {
        redirect: "follow",
        headers: { "User-Agent": "NOVA-Agent/0.1 (+tool:web_fetch)" },
      });
      const status = res.status;
      const contentType = res.headers.get("content-type") ?? "";
      const text = await res.text();

      // 5MB soft cap so a huge response can't blow up context/memory.
      const truncated = text.length > 5_000_000 ? text.slice(0, 5_000_000) : text;
      const stripped = contentType.includes("html")
        ? truncated
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : truncated;

      return {
        ok: status >= 200 && status < 300,
        data: {
          url: parsed.toString(),
          status,
          contentType,
          text: stripped.slice(0, 20_000),
        },
        error: status >= 200 && status < 300 ? undefined : `HTTP ${status}`,
      };
    } catch (err) {
      return { ok: false, error: `Fetch failed: ${(err as Error).message}` };
    }
  },

  verify(result) {
    if (!result.ok) return { ok: false, reason: "execution reported failure" };
    const data = result.data as { text?: string; status?: number } | undefined;
    if (!data || typeof data.status !== "number") {
      return { ok: false, reason: "result missing status field" };
    }
    if (!data.text || data.text.trim().length === 0) {
      return { ok: false, reason: "fetched page had no extractable text" };
    }
    return { ok: true };
  },
};
