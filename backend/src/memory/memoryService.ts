import { NovaDb } from "../db/supabaseClient.js";
import { EmbeddingProvider } from "./embeddingProvider.js";

export type MemoryType = "episodic" | "semantic" | "preference";
export type MemoryClassification = "temporary" | "useful" | "important" | "persistent" | "sensitive";

export interface RetrievedMemory {
  memoryId: string;
  content: string;
  memoryType: MemoryType;
  classification: MemoryClassification;
  similarity: number;
}

// Implements the retrieval pipeline from section 10:
// generate query -> search -> rank -> return only what's relevant.
// Callers inject only the top-k results into the prompt, never the full table.
export class MemoryService {
  constructor(private embeddings: EmbeddingProvider) {}

  async remember(
    db: NovaDb,
    userId: string,
    content: string,
    opts: { memoryType: MemoryType; classification?: MemoryClassification; conversationId?: string }
  ): Promise<{ ok: boolean; error?: string }> {
    // "sensitive" classification means don't persist at all — see section 11.
    if (opts.classification === "sensitive") {
      return { ok: false, error: "Refusing to persist content classified as sensitive" };
    }

    const { data: memoryRow, error: insertError } = await db
      .from("memories")
      .insert({
        user_id: userId,
        content,
        memory_type: opts.memoryType,
        classification: opts.classification ?? "useful",
        source_conversation_id: opts.conversationId ?? null,
      })
      .select("id")
      .single();

    if (insertError || !memoryRow) {
      return { ok: false, error: insertError?.message ?? "Insert failed" };
    }

    try {
      const vector = await this.embeddings.embed(content);
      const { error: embedError } = await db
        .from("memory_embeddings")
        .insert({ memory_id: memoryRow.id, embedding: vector });
      if (embedError) {
        // Roll back the memory row rather than leaving an unsearchable orphan.
        await db.from("memories").delete().eq("id", memoryRow.id);
        return { ok: false, error: `Embedding storage failed: ${embedError.message}` };
      }
    } catch (err) {
      await db.from("memories").delete().eq("id", memoryRow.id);
      return { ok: false, error: `Embedding generation failed: ${(err as Error).message}` };
    }

    return { ok: true };
  }

  async recall(
    db: NovaDb,
    userId: string,
    query: string,
    limit = 6
  ): Promise<RetrievedMemory[]> {
    let vector: number[];
    try {
      vector = await this.embeddings.embed(query);
    } catch {
      return []; // degrade gracefully — agent still works without memory context
    }

    const { data, error } = await db.rpc("match_memories", {
      query_embedding: vector,
      match_user_id: userId,
      match_count: limit,
      min_similarity: 0.3,
    });

    if (error || !data) return [];

    return (data as any[]).map((row) => ({
      memoryId: row.memory_id,
      content: row.content,
      memoryType: row.memory_type,
      classification: row.classification,
      similarity: row.similarity,
    }));
  }
}
