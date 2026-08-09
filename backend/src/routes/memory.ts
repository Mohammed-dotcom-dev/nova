import { Router, Response } from "express";
import { z } from "zod";
import { MemoryService } from "../memory/memoryService.js";
import { AuthedRequest, requireAuth } from "../auth/middleware.js";
import { writeAuditLog } from "../security/middleware.js";

const rememberSchema = z.object({
  content: z.string().min(1).max(2000),
  memoryType: z.enum(["episodic", "semantic", "preference"]),
  classification: z.enum(["temporary", "useful", "important", "persistent"]).optional(),
});

export function buildMemoryRouter(memory: MemoryService) {
  const r = Router();

  r.get("/memory", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { data, error } = await req.db!
      .from("memories")
      .select("id, content, memory_type, classification, created_at, last_used_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ memories: data });
  });

  r.post("/memory", requireAuth, async (req: AuthedRequest, res: Response) => {
    const parsed = rememberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const result = await memory.remember(req.db!, req.userId!, parsed.data.content, {
      memoryType: parsed.data.memoryType,
      classification: parsed.data.classification,
    });
    if (!result.ok) {
      res.status(422).json({ error: result.error });
      return;
    }
    res.status(201).json({ ok: true });
  });

  r.delete("/memory/:id", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { error } = await req.db!.from("memories").delete().eq("id", req.params.id);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    await writeAuditLog(req.db!, req.userId!, "memory:delete", "moderate", "allowed", { memoryId: req.params.id });
    res.status(204).send();
  });

  // Clear-all is deliberately its own endpoint (not DELETE /memory with no id)
  // so it can never be triggered by a malformed or missing path parameter.
  r.post("/memory/clear-all", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { error } = await req.db!.from("memories").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    await writeAuditLog(req.db!, req.userId!, "memory:clear_all", "dangerous", "allowed");
    res.status(204).send();
  });

  return r;
}
