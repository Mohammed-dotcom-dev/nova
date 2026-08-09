import { Router, Response } from "express";
import { z } from "zod";
import { ModelRouter } from "../providers/router.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryService } from "../memory/memoryService.js";
import { runAgentLoop } from "../agent/loop.js";
import { AuthedRequest, requireAuth } from "../auth/middleware.js";
import { chatRateLimiter } from "../security/middleware.js";

const chatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().uuid().optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

export function buildChatRouter(router: ModelRouter, tools: ToolRegistry, memory: MemoryService) {
  const r = Router();

  r.post("/chat/stream", requireAuth, chatRateLimiter, async (req: AuthedRequest, res: Response) => {
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }
    const db = req.db!;
    const userId = req.userId!;

    // Ensure a conversation row exists — create one if this is a fresh thread.
    let conversationId = parsed.data.conversationId;
    if (!conversationId) {
      const { data, error } = await db
        .from("conversations")
        .insert({ user_id: userId, title: parsed.data.message.slice(0, 60) })
        .select("id")
        .single();
      if (error || !data) {
        res.status(500).json({ error: "Could not create conversation" });
        return;
      }
      conversationId = data.id;
    }

    await db.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: parsed.data.message,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("conversation", { conversationId });

    const history = parsed.data.history.map((h) => ({ role: h.role, content: h.content }));

    try {
      let finalContent = "";
      for await (const ev of runAgentLoop({
        router,
        tools,
        memory,
        db,
        userId,
        conversationId: conversationId!,
        userMessage: parsed.data.message,
        history,
      })) {
        send(ev.type, { detail: ev.detail, data: ev.data });
        if (ev.type === "final") {
          finalContent = (ev.data as { content?: string })?.content ?? "";
          break;
        }
      }
      if (finalContent) {
        await db.from("messages").insert({
          conversation_id: conversationId,
          user_id: userId,
          role: "assistant",
          content: finalContent,
        });
      }
    } catch (err) {
      send("error", { detail: (err as Error).message });
    } finally {
      res.end();
    }
  });

  r.get("/conversations", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { data, error } = await req.db!
      .from("conversations")
      .select("id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ conversations: data });
  });

  r.get("/conversations/:id/messages", requireAuth, async (req: AuthedRequest, res: Response) => {
    const { data, error } = await req.db!
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", req.params.id)
      .order("created_at", { ascending: true });
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ messages: data });
  });

  return r;
}
