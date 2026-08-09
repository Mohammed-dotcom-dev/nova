import { useState } from "react";
import { supabase } from "../lib/supabaseClient.js";

export function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
      } else {
        const { error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        setCheckEmail(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink text-text-primary font-body flex items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="font-display text-signal text-lg tracking-wide text-center">NOVA</div>

        {checkEmail ? (
          <p className="text-sm text-text-muted text-center">
            Check your email to confirm your account, then sign in.
          </p>
        ) : (
          <>
            <div className="space-y-3">
              <input
                className="w-full bg-panel border border-line rounded-md px-4 py-3 text-sm outline-none focus:border-signal"
                placeholder="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                className="w-full bg-panel border border-line rounded-md px-4 py-3 text-sm outline-none focus:border-signal"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              className="w-full py-3 rounded-md bg-signal text-ink font-display text-sm disabled:opacity-40"
              onClick={submit}
              disabled={busy || !email || !password}
            >
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>

            <button
              className="w-full text-center text-xs text-text-muted"
              onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            >
              {mode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
