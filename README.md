# Opal

A self-hosted AI assistant: chat, agents, web search, connectors, sandboxes, and Opal Code, which runs Claude Code and Codex on your own machines.

## What's here

| Folder | What it is |
| --- | --- |
| `apps/web` | The Opal web app (Next.js). |
| `apps/runner` | The Opal Code runner. It connects a machine to Opal and runs coding agents on it. |
| `apps/desktop` | Desktop app (Tauri). |
| `apps/ios` | iPhone and iPad app (SwiftUI). |
| `sandbox` | Docker image the agents run code in. |
| `searxng` | Web search settings. |
| `deploy` | Deploying Opal on an Umbrel. |
| `docs` | Longer guides. |

## Run it locally

You need Node 22+ and Docker.

```sh
docker compose up -d                  # Postgres and web search
cd apps/web
cp .env.example .env.local            # then fill it in
npm install
npm run db:migrate
npm run dev                           # http://localhost:3000
```

`.env.example` explains each setting. To run agent sandboxes, also build the image: `npm run sandbox:build`.

## Connect a machine to Opal Code

In Opal Code, open **Machines → Connect a machine** and run the command it shows on that machine. Linux machines get a single `curl … | sh` line that installs the runner AppImage. To build the AppImages, run `npm run appimage` (ARM) or `npm run appimage:x64` (Intel) in `apps/runner`. More in [docs/opal-code.md](docs/opal-code.md).

## Deploy

[docs/deploy-umbrel.md](docs/deploy-umbrel.md) covers running Opal on an Umbrel behind Tailscale Funnel.
