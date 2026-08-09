import { Request, Response, NextFunction } from "express";
import { NovaDb, anonClient, clientForUser } from "../db/supabaseClient.js";

export interface AuthedRequest extends Request {
  userId?: string;
  db?: NovaDb;
}

// Verifies the bearer token against Supabase Auth on every request. This is
// the real authorization boundary (section 17) — Phase 1's hardcoded
// "local-user" is gone. No token, no valid session -> 401, full stop.
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header" });
    return;
  }
  const token = header.slice(7);

  try {
    const { data, error } = await anonClient().auth.getUser(token);
    if (error || !data.user) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    req.userId = data.user.id;
    req.db = clientForUser(token);
    next();
  } catch {
    res.status(401).json({ error: "Could not verify session" });
  }
}
