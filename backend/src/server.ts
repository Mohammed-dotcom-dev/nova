import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config, assertConfigured } from "./config.js";
import { ModelRouter } from "./providers/router.js";
import { NvidiaProvider } from "./providers/nvidiaProvider.js";
import { NvidiaEmbeddingProvider } from "./memory/embeddingProvider.js";
import { MemoryService } from "./memory/memoryService.js";
import { ToolRegistry } from "./tools/registry.js";
import { webFetchTool } from "./tools/webFetchTool.js";
import { buildChatRouter } from "./routes/chat.js";
import { buildMemoryRouter } from "./routes/memory.js";
import { requireAuth, AuthedRequest } from "./auth/middleware.js";

assertConfigured();

const router = new ModelRouter();
router.register(new NvidiaProvider({ apiKey: config.nvidia.apiKey, model: config.nvidia.model }));
router.setRule({ taskType: "tool_heavy", providerIds: ["nvidia"] });

const embeddings = new NvidiaEmbeddingProvider(config.nvidia.apiKey, config.nvidia.embeddingModel);
const memory = new MemoryService(embeddings);

const tools = new ToolRegistry();
tools.register(webFetchTool);

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  const providers = await router.healthCheckAll();
  const allOk = Object.values(providers).every((p) => p.ok);
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    providers,
    tools: tools.list().map((t: { name: string }) => t.name),
    supabaseConfigured: Boolean(config.supabase.url && config.supabase.anonKey),
  });
});

app.get("/api/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ userId: req.userId });
});

app.use("/api", buildChatRouter(router, tools, memory));
app.use("/api", buildMemoryRouter(memory));

// Section 26: never leak raw errors to the client.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our end. Try again." });
});

app.listen(config.port, () => {
  console.log(`NOVA backend listening on :${config.port}`);
});
