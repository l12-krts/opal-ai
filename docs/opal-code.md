# Opal Code

An agent manager inside Opal, modelled on T3 Code (MIT, https://github.com/pingdotgg/t3code).
Open it from the **Code** tab in the sidebar. Opal Code replaces the sidebar with an Inbox of coding
threads. The header shows the "Opal Code" wordmark and a chat button that goes back to regular Opal.

## Decisions (from the user)

- **Machines** connect through a runner app (`apps/runner`) that dials out to the Opal server with a pairing code.
- **Agents in v1:** Claude Code (Claude Agent SDK) and Codex (`codex app-server`, JSON-RPC over stdio). OpenCode and Cursor come later behind the same adapter interface.
- **Git:** worktree per thread (optional), diff view, commit / push / open PR (`gh`) from the thread.
- **Approvals:** default "Auto": safe actions pass on their own and risky ones wait in the Inbox ("Needs you").
  - Claude: `permissionMode: "auto"` plus `canUseTool`, with a local safe list.
  - Codex: `approvalPolicy: "on-request"`, `sandbox: "workspace-write"`.
  - The other modes are "Ask" (everything asks) and "Full access".
- **Extras:** Opal chat can hand work to threads. Each thread gets a terminal (node-pty and xterm). One prompt can go to several agents (one thread and worktree each). Threads can be snoozed, and settle automatically.
- **Projects:** a project is a folder on one machine at `<machine.projectsRoot>/<name>`, created by the runner. An existing folder can also be added.
- **Design:** existing Opal (krts.ui, Allo, monotone, rows like "Ran command"), with T3 Code's layout.

## Architecture

```
browser ──SSE /api/code/events, REST /api/code/*──▶ Opal (Next.js + Postgres)
runner  ──SSE /api/code/runner/connect (commands)──▶ Opal
runner  ──POST /api/code/runner/{events,reply,tool,hello}──▶ Opal
agent (Claude/Codex) ──HTTP MCP 127.0.0.1:<port>/mcp──▶ runner ──POST /tool──▶ Opal
```

- `/api/code/runner/*` skips the site gate and authenticates with the machine token (`Bearer`). The token is hashed in the database.
- The hub is an in-memory singleton on `globalThis` (`src/server/code/hub.ts`). It holds:
  - the connected runners and their SSE writers;
  - pending command replies;
  - each user's browser SSE subscribers;
  - waiters for a thread to go idle.
- **Tables:**
  - `code_machine`: name, os, hostname, `projectsRoot`, `tokenHash`, agents (jsonb), `lastSeenAt`.
  - `code_pairing`: code, `userId`, `expiresAt`.
  - `code_project`: `machineId`, name, path, `isGit`.
  - `code_thread`: project or machine, agent, model, mode, status, title, worktree, branch, `baseBranch`, `providerSessionId`, `parentThreadId`, `groupId`, `pinnedAt`, `snoozedUntil`, `settledAt`, `lastReadAt`, `lastActivityAt`, `prUrl`.
  - `code_item`: `threadId`, id, seq, kind, data (jsonb), timestamps.
- **Items** have stable ids and are upserted whole, so the runner throttles text updates. Kinds:
  - `user` (optional `from`: another thread or Opal), `assistant`, `reasoning`
  - `command`, `edit`, `tool`
  - `approval` (`pending`, `approved`, `denied` or `expired`)
  - `error`, `notice`

### Runner commands (server → runner, answered with POST `/reply`)

- **Projects:** `project.create`, `project.check`
- **Turns:**
  - `turn.start`: the runner queues messages while a turn is running.
  - `turn.interrupt`, `approval.respond`, `thread.close`
- **Git:** `git.worktree`, `git.status`, `git.diff`, `git.commit`, `git.push`, `git.pr`, `git.prState`, `git.branches`
- **Terminal:** `terminal.open`, `terminal.input`, `terminal.resize`, `terminal.close`

### Runner events (runner → server)

`item`, `status` (`working`, `waiting`, `idle` or `error`), `session` (provider session id for resume), `terminal`, `terminal-exit`.

### MCP tools for agents (server name `opal-code`)

`list_threads`, `read_thread`, `send_message` (optional wait), `start_thread` (delegate: child thread, optional worktree, optional wait), `wait_thread`.

### Opal chat tools

`code_overview`, `code_start`, `code_message`, `code_read`.

## Inbox

- **Sections:**
  - Pinned
  - Needs you: approval waiting, or error
  - Working
  - Done: unread first
  - Snoozed: collapsed
  - Settled: collapsed
- **Snooze:** 1 hour, this evening, tomorrow 09:00 or next Monday 09:00. A snoozed thread wakes on new activity.
- **Auto-settle:** a thread settles when it has been idle and read for 3 days, or when its PR is merged (a periodic `git.prState` check).
- **Row menu:** pin, snooze, settle, rename, delete.

## UI routes

- `/code`: new thread. Pick the project (and machine), one or more agents with a model each, the mode, worktree and base branch.
- `/code/t/[id]`: the thread. Timeline and composer, with a right panel for the diff or the terminal, and git actions in the header.
- `/code/projects`, `/code/machines`: pair a machine (shows the runner command and code), and set each machine's projects root.

## Running the runner

```
cd apps/runner && npm install
npm run pair -- <opal-url> <code>     # once per machine
npm start                             # keep running
```

## Status

Built and tested end to end (2026-11-22) with a runner on the dev PC:
- pairing, machine detection, project creation, new thread → runner → Claude Code → reply streamed into the Inbox,
  terminal, diff, commit with an Opal-written message, worktree threads, Inbox pin/snooze shelves, the agent MCP
  relay (initialize, tools/list, list_threads, bad token rejected), and Opal chat's `code_overview`.

Not tested yet:
- A real Claude Code turn: the CLI on the dev PC isn't signed in (`claude auth login`), so the approval cards and
  the MCP tools from inside a real agent turn are untested.
- Codex: the real CLI isn't installed on the dev PC.
- Push / pull request: they need a repository with a remote and `gh`.
- Multi-agent send: it needs two working agents.

Gotcha: the user's home folder is itself a Git repository, so a new project must check that it is the top of its
own repo (`isRepoRoot`), not only that it sits inside one.

## Mentions, skills and settings (added 2026-11-22)

- **Composer `@`:**
  - Files come from the runner's `fs.search` (it runs `git ls-files` or walks the folder, then ranks by name).
  - It also lists other threads and Opal agents.
  - Mentions are sent as `{kind, id, label}` and stored on the user item for chips.
  - The coding agent receives notes listing them. It reaches Opal agents through the MCP tool `ask_opal_agent`, which runs the agent headless via `server/code/opal-agents.ts`.
- **Composer `/`:**
  - Lists Code skills (table `code_skill`, separate from chat skills) and the built-ins `/diff`, `/terminal`, `/stop`, `/new`.
  - A leading `/Skill name` is expanded server-side (`store.agentText`).
- **Code settings** (`/code/settings/*`, stored in `user_settings.code_settings`):
  - default agent, default approval mode, worktree by default, settle-after days;
  - Skills, Projects and Machines pages live in this area too.
- **Opal chat:**
  - Picking a skill now inserts `/Skill name`, which `expandSkillCommands` in `server/ai/personal.ts` expands for the model.
  - Bubbles draw chips for `@Agent` and `/skill`, and so do Opal Code bubbles (`components/rich-text.tsx`).
