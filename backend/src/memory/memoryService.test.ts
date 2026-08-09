import { describe, it, expect, vi } from "vitest";
import { MemoryService } from "./memoryService.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import type { NovaDb } from "../db/supabaseClient.js";

function fakeDbWithSpies() {
  const deletedIds: string[] = [];
  const db = {
    from: (table: string) => ({
      insert: (row: any) => ({
        select: () => ({
          single: () =>
            Promise.resolve(
              table === "memories" ? { data: { id: "mem-1" }, error: null } : { data: null, error: null }
            ),
        }),
        // memory_embeddings insert is awaited directly, no .select()
        then: (resolve: any) => resolve({ data: null, error: table === "memory_embeddings" ? { message: "boom" } : null }),
      }),
      delete: () => ({
        eq: (_col: string, id: string) => {
          deletedIds.push(id);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  } as unknown as NovaDb;
  return { db, deletedIds };
}

describe("MemoryService", () => {
  it("refuses to persist content classified as sensitive", async () => {
    const embeddings: EmbeddingProvider = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) };
    const memory = new MemoryService(embeddings);
    const { db } = fakeDbWithSpies();

    const result = await memory.remember(db, "user-1", "some health detail", {
      memoryType: "semantic",
      classification: "sensitive",
    });

    expect(result.ok).toBe(false);
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it("rolls back the memory row if embedding storage fails", async () => {
    const embeddings: EmbeddingProvider = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) };
    const memory = new MemoryService(embeddings);
    const { db, deletedIds } = fakeDbWithSpies();

    const result = await memory.remember(db, "user-1", "likes bubble tea", { memoryType: "preference" });

    expect(result.ok).toBe(false);
    expect(deletedIds).toContain("mem-1");
  });

  it("degrades gracefully (returns empty) if embedding the query fails during recall", async () => {
    const embeddings: EmbeddingProvider = { embed: vi.fn().mockRejectedValue(new Error("network down")) };
    const memory = new MemoryService(embeddings);
    const { db } = fakeDbWithSpies();

    const result = await memory.recall(db, "user-1", "what do I like?");
    expect(result).toEqual([]);
  });
});
