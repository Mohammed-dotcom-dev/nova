import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabaseClient.js";
import { streamChat } from "./lib/streamClient.js";
import { ActivityTrail, ActivityStep } from "./components/ActivityTrail.js";
import { AuthScreen } from "./components/AuthScreen.js";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="min-h-screen bg-ink" />; // avoid a flash of the auth screen while session loads
  }
  if (session === null) {
    return <AuthScreen />;
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setInput("");
    setBusy(true);
    setSteps([{ label: "Understanding task", state: "active" }]);

    let finalContent = "";

    for await (const ev of streamChat(message, history, conversationId)) {
      if (ev.type === "conversation") {
        const id = (ev.data as { conversationId?: string })?.conversationId;
        if (id) setConversationId(id);
      } else if (ev.type === "status") {
        setSteps((prev) => [
          ...prev.map((s) => ({ ...s, state: "done" as const })),
          { label: ev.detail ?? "Working", state: "active" },
        ]);
      } else if (ev.type === "tool_call") {
        setSteps((prev) => [
          ...prev.map((s) => ({ ...s, state: "done" as const })),
          { label: `Using tool: ${ev.detail}`, state: "active" },
        ]);
      } else if (ev.type === "tool_result") {
        const ok = (ev.data as { ok?: boolean })?.ok;
        setSteps((prev) =>
          prev.map((s, i) => (i === prev.length - 1 ? { ...s, state: ok ? "done" : "error" } : s))
        );
      } else if (ev.type === "error") {
        setSteps((prev) => [
          ...prev.map((s) => ({ ...s, state: "done" as const })),
          { label: ev.detail ?? "Error", state: "error" },
        ]);
      } else if (ev.type === "final") {
        finalContent = (ev.data as { content?: string })?.content ?? "";
      }
    }

    setTurns((prev) => [...prev, { role: "assistant", content: finalContent }]);
    setSteps([]);
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-ink text-text-primary font-body flex flex-col">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between">
        <span className="font-display text-signal tracking-wide">NOVA</span>
        <button
          className="text-xs text-text-muted hover:text-text-primary"
          onClick={() => supabase.auth.signOut()}
        >
          Sign out
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-8 max-w-2xl w-full mx-auto space-y-6">
        {turns.length === 0 && (
          <p className="text-text-muted font-display text-sm">
            Ask NOVA something. It'll tell you what it's actually doing while it works.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : "text-left"}>
            <div
              className={`inline-block max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed ${
                t.role === "user" ? "bg-panel text-text-primary" : "bg-transparent text-text-primary"
              }`}
            >
              {t.content}
            </div>
          </div>
        ))}
        {busy && <ActivityTrail steps={steps} />}
      </main>

      <footer className="border-t border-line px-6 py-4">
        <div className="max-w-2xl mx-auto flex gap-3">
          <input
            className="flex-1 bg-panel border border-line rounded-md px-4 py-3 text-sm outline-none focus:border-signal"
            placeholder="Message NOVA"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            className="px-4 py-3 rounded-md bg-signal text-ink font-display text-sm disabled:opacity-40"
            onClick={send}
            disabled={busy}
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
