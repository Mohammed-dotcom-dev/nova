# NOVA — Phases 1, 3, 6, 7 (real infra, not a mockup)

Personal AI agent, formerly called JARVIS during development — renamed to
NOVA per your request. Real Supabase Auth, a real Postgres schema with RLS,
real pgvector memory, a real DB-backed task state machine, and security
hardening — not stubs pretending to be those things.

## Important naming note — please read

You already have two other things called Nova:
1. An existing single-file HTML assistant, also called NOVA.
2. A separate, older Supabase project literally named **"Nova"**.

Per your instruction, this codebase now uses "NOVA" as its name too, but I
deliberately kept it on its **own, separate Supabase project** — the one
created last session (ref `wjucggpvzihvnmowsvlm`), not your existing "Nova"
project. I renamed the Postgres *schema* inside that project from `jarvis`
to `nova`, but **the Supabase project's own label is still "jarvis"** in
your dashboard/org — I did not rename the project itself since you only
asked to rename the codebase. If you want the project label changed too
(so your dashboard doesn't show a project called "jarvis" next to one
called "Nova" while both serve something called NOVA), say the word and
I'll do that too — didn't want to make that call unprompted.

## What's genuinely production-grade right now

**Auth (Phase 1, hardened):** Supabase Auth. Every backend route requires a
valid JWT (`requireAuth` middleware) — no hardcoded user, no anonymous chat.
Verified: hitting `/api/chat/stream`, `/api/memory`, `/api/me` without a
token returns 401 (tested, not assumed).

**Database (Phase 3):** Live schema in your Supabase project (ref
`wjucggpvzihvnmowsvlm`), schema name `nova`, 16 tables — profiles,
conversations, messages, memories, memory_embeddings, tasks, task_steps,
tool_definitions, tool_permissions, tool_runs, integrations,
oauth_connections, agent_runs, agent_events, usage_records, settings,
audit_log. Every table has row-level security — Postgres itself refuses
cross-user reads, not just application code. Ran Supabase's own security
advisor after every migration, including after the schema rename; the only
flag is a pre-existing project-level setting (leaked-password protection),
unrelated to anything built here.

**Memory (Phase 3):** pgvector-backed semantic recall via a `match_memories`
RPC (cosine similarity, top-k, minimum-similarity floor — never dumps the
whole table into the prompt). Classification system from section 11:
`sensitive`-classified content is refused at the service layer before an
embedding call is even made. If the embedding write fails, the memory row is
rolled back rather than left as an orphaned, unsearchable row — tested.

**Tasks (Phase 6, state machine only):** `nova.tasks` / `nova.task_steps`
with an enforced status state machine (`queued → planning → running →
completed/failed/cancelled`, etc.) — illegal transitions throw, tested.
Background *workers* that pick up queued tasks and run them unattended are
not built yet (see below).

**Security (Phase 7, partial):** helmet headers, per-IP rate limiting on
chat, Zod input validation on every route, an SSRF guard on `web_fetch`
(blocks localhost/private ranges/cloud metadata IP), audit logging for every
tool call and every memory deletion, no service-role key anywhere in the
backend (every DB client is scoped to the caller's JWT, so RLS is the actual
enforcement boundary, not application-layer trust).

**Tests:** 8/8 passing — agent loop (tool-call path + provider-failure path),
memory service (sensitive-content refusal, rollback-on-failure, graceful
degradation), task state machine (legal + illegal transitions). Re-ran after
the rename to confirm nothing broke.

## What is explicitly NOT done — don't deploy this to real users without them

- **Voice (Phase 5):** not built. No STT/TTS wiring.
- **Google integrations (Gmail/Calendar/Drive/Sheets):** not built — needs
  OAuth app credentials only you can create in Google Cloud Console.
- **Background task workers:** the task table/state machine is real, but
  nothing currently picks a `queued` task and runs it without an open HTTP
  request. That's a queue (e.g. a Postgres-polling worker or a proper job
  queue) — a real addition, not a config flag.
- **MCP tool support:** the tool registry is real and extensible, but no MCP
  client is wired in yet.
- **Full permission/confirmation gating (section 16):** only one `safe`-risk
  tool (`web_fetch`) is registered, so there's nothing dangerous to gate yet.
  **Before you register any tool that sends, deletes, or modifies anything,
  add the confirmation gate first** — right now a `dangerous`-risk tool would
  execute the same as a safe one.
- **Load testing, external pentest, provider fallback beyond one provider:**
  none of this has been exercised under real traffic.
- **This sandbox cannot reach `integrate.api.nvidia.com`** (its own egress
  proxy blocks it — confirmed via a direct curl showing `403
  host_not_allowed`, not an NVIDIA-side rejection). You must run one live
  chat request locally to confirm your NVIDIA key + model name actually work
  end-to-end — that's the one thing I could not verify from here.

Calling this "production ready" without addressing the list above would be
the "fake placeholder functionality pretending to work" the original spec
explicitly said not to build. It isn't done. It's real, tested infrastructure
for four of nine phases, now consistently branded NOVA throughout.

## Setup

### 1. Supabase (already provisioned)

Project ref `wjucggpvzihvnmowsvlm` (ap-southeast-1), separate from your
existing "Nova" project. Schema `nova` already has all 16 tables + RLS + the
`match_memories` function applied.

**You must do this manually — no available tool can do it:** in the
Supabase dashboard, go to **Project Settings → API → Data API Settings →
Exposed schemas**, and add `nova` to the list (it only exposes `public` by
default). Nothing will work until you do this.

Also worth doing while you're in the dashboard: **Authentication → Policies
→ enable leaked-password protection** (the one advisor warning).

### 2. Backend

```bash
cd backend
cp .env.example .env
# fill in NVIDIA_API_KEY and SUPABASE_ANON_KEY (get the anon/publishable
# key from Project Settings > API — SUPABASE_URL is already filled in)
npm install
npm run dev              # http://localhost:8787
npm test                 # 8 tests, no live network needed
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env     # same Supabase URL + anon key as backend
npm install
npm run dev               # http://localhost:5173
```

Sign up with an email/password on first load — Supabase Auth sends a
confirmation email (check your project's Auth settings if it doesn't arrive;
by default Supabase's shared SMTP has rate limits).

## About your NVIDIA key

Never stored anywhere persistent — not in memory, not in any tracked file.
It only ever lived in `backend/.env`, which is gitignored. Check `git
status` before your first push to confirm `.env` isn't staged.

## Suggested next session

Pick one: (a) background task worker so tasks actually run without a held-
open request, (b) the permission/confirmation gate before adding your first
non-safe tool, (c) Google OAuth once you've created credentials in Google
Cloud Console, or (d) rename the Supabase project label itself if the
"jarvis" ref name bugs you. Voice and MCP are bigger lifts — good candidates
for their own dedicated sessions.
