import { AIProvider, ChatOptions, ChatResult, ProviderError, StreamChunk } from "./types.js";

export type TaskType = "simple" | "reasoning" | "coding" | "tool_heavy" | "long_context";

interface RouteRule {
  taskType: TaskType;
  providerIds: string[]; // ordered priority; router falls back down the list
}

// Provider-independent router. Holds a registry of providers plus routing rules,
// and the agent core only ever asks the router for a chat/stream — it never
// imports a specific provider.
export class ModelRouter {
  private providers = new Map<string, AIProvider>();
  private rules: RouteRule[] = [];
  private cooldowns = new Map<string, number>(); // providerId -> epoch ms until retry allowed

  register(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }

  setRule(rule: RouteRule) {
    this.rules = this.rules.filter((r) => r.taskType !== rule.taskType);
    this.rules.push(rule);
  }

  private candidateOrder(taskType: TaskType): AIProvider[] {
    const rule = this.rules.find((r) => r.taskType === taskType);
    const ids = rule?.providerIds ?? [...this.providers.keys()];
    return ids.map((id) => this.providers.get(id)).filter((p): p is AIProvider => Boolean(p));
  }

  private isCoolingDown(providerId: string): boolean {
    const until = this.cooldowns.get(providerId);
    return typeof until === "number" && until > Date.now();
  }

  private applyCooldown(providerId: string, ms = 30_000) {
    this.cooldowns.set(providerId, Date.now() + ms);
  }

  async chat(taskType: TaskType, options: ChatOptions): Promise<ChatResult> {
    const candidates = this.candidateOrder(taskType);
    if (candidates.length === 0) {
      throw new ProviderError("No AI provider registered", "router", "unknown", false);
    }

    let lastError: Error | undefined;
    for (const provider of candidates) {
      if (this.isCoolingDown(provider.id)) continue;
      try {
        return await provider.chat(options);
      } catch (err) {
        lastError = err as Error;
        if (err instanceof ProviderError && err.kind === "rate_limit") {
          this.applyCooldown(provider.id);
        }
        if (err instanceof ProviderError && !err.retryable) {
          // auth/config errors won't be fixed by falling back within the same
          // provider, but a different provider might still work — keep going.
          continue;
        }
      }
    }
    throw lastError ?? new ProviderError("All providers failed", "router", "unknown", false);
  }

  async *stream(taskType: TaskType, options: ChatOptions): AsyncIterable<StreamChunk> {
    const candidates = this.candidateOrder(taskType);
    if (candidates.length === 0) {
      yield { type: "error", error: "No AI provider registered" };
      return;
    }
    for (const provider of candidates) {
      if (this.isCoolingDown(provider.id)) continue;
      let sawError = false;
      for await (const chunk of provider.stream(options)) {
        if (chunk.type === "error") {
          sawError = true;
          this.applyCooldown(provider.id, 10_000);
          break;
        }
        yield chunk;
      }
      if (!sawError) return;
    }
    yield { type: "error", error: "All providers failed to stream" };
  }

  async healthCheckAll(): Promise<Record<string, { ok: boolean; detail?: string }>> {
    const out: Record<string, { ok: boolean; detail?: string }> = {};
    for (const [id, provider] of this.providers) {
      out[id] = await provider.healthCheck();
    }
    return out;
  }
}
