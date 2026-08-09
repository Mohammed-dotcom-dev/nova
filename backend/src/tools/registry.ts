import { AgentTool, ToolContext, ToolResult } from "./types.js";

export class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool) {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentTool[] {
    return [...this.tools.values()];
  }

  // Schema shape the provider layer needs — name/description/inputSchema only.
  // Risk level and executor stay server-side and are never sent to the model.
  toProviderDefinitions() {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async run(name: string, input: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }

    const timeout = new Promise<ToolResult>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: `Tool "${name}" timed out` }), tool.timeoutMs)
    );

    let result: ToolResult;
    try {
      result = await Promise.race([tool.execute(input, context), timeout]);
    } catch (err) {
      result = { ok: false, error: (err as Error).message };
    }

    if (result.ok) {
      const verification = tool.verify(result);
      if (!verification.ok) {
        return { ok: false, error: `Verification failed: ${verification.reason ?? "unknown reason"}` };
      }
    }
    return result;
  }
}
