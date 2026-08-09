export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

// NVIDIA NIM's embedding endpoint (OpenAI-compatible /v1/embeddings). Kept
// behind the same EmbeddingProvider interface so swapping models/providers
// never touches the memory service that calls it.
export class NvidiaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private apiKey: string,
    private model: string,
    private baseUrl = "https://integrate.api.nvidia.com/v1"
  ) {}

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: [text],
        input_type: "query",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Embedding request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error("Embedding response missing vector");
    return embedding;
  }
}
