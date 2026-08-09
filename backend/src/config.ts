import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  nvidia: {
    apiKey: process.env.NVIDIA_API_KEY ?? "",
    model: process.env.NVIDIA_MODEL ?? "meta/llama-3.1-70b-instruct",
    embeddingModel: process.env.NVIDIA_EMBEDDING_MODEL ?? "nvidia/nv-embedqa-e5-v5",
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    anonKey: process.env.SUPABASE_ANON_KEY ?? "",
  },
};

export function assertConfigured() {
  required("NVIDIA_API_KEY");
  required("SUPABASE_URL");
  required("SUPABASE_ANON_KEY");
}
