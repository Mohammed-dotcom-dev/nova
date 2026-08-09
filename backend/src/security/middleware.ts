import rateLimit from "express-rate-limit";
import { NovaDb } from "../db/supabaseClient.js";

// Per-IP limit on the chat endpoint. Authenticated-user limits (fairer, since
// NAT/shared-IP users won't collide) are a Phase-2+ upgrade once a durable
// request log exists to key off user id instead of IP.
export const chatRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Slow down and try again shortly." },
});

export async function writeAuditLog(
  db: NovaDb,
  userId: string,
  action: string,
  riskLevel: "safe" | "moderate" | "dangerous",
  outcome: "allowed" | "blocked" | "error",
  detail?: Record<string, unknown>
) {
  // Audit logging must never throw and break the request it's logging —
  // best-effort only.
  try {
    await db.from("audit_log").insert({
      user_id: userId,
      action,
      risk_level: riskLevel,
      outcome,
      detail: detail ?? {},
    });
  } catch {
    // swallow — logging failure is not a request failure
  }
}
