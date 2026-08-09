export type RiskLevel = "safe" | "moderate" | "dangerous";

export interface ToolContext {
  userId: string;
  requestId: string;
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema, shown to the model
  riskLevel: RiskLevel;
  timeoutMs: number;

  execute(input: unknown, context: ToolContext): Promise<ToolResult>;
  // Independent check the agent core runs on the result before trusting it —
  // this is the "verification" step from section 13, per-tool.
  verify(result: ToolResult): { ok: boolean; reason?: string };
}
