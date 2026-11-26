# Opal on the Umbrel

Opal runs on the Umbrel (Raspberry Pi 5, arm64, umbrelOS 2.0, 192.168.1.101 / Tailscale
100.92.127.42) as a **Portainer stack**, and is reachable from anywhere at
**https://opal.tailefea70.ts.net** through **Tailscale Funnel**. Every request still goes through
Opal's site gate (`/unlock`) and then Google sign-in.

```
Internet ──HTTPS──▶ Tailscale Funnel ──▶ tunnel (tailscale node "opal")
                                              │ http://web:3000
                                              ▼
                     web (Next.js, production) ──▶ db (Postgres 17)
                              │                 ──▶ search (SearXNG)
                              └─ docker socket ─▶ sandbox containers (one per agent)
          all inside Portainer's own Docker daemon (docker-in-docker), apart from umbrelOS
```

## Where everything lives

| What | Where |
| --- | --- |
| Deploy files | `deploy/umbrel/` in this repo |
| Stack definition | `deploy/umbrel/docker-compose.yml`, deployed as Portainer stack `opal` |
| Images | built on the dev PC for linux/arm64: `opal-umbrel/web`, `opal-umbrel/search`, `opal-umbrel/tunnel`, `opal-umbrel/sandbox` (all `:latest`). Tarballs go to `deploy/umbrel/out/` (gitignored) |
| Server environment | `deploy/umbrel/.env.umbrel` on the dev PC (gitignored, made by `make-env.ps1`). Portainer keeps a copy as the stack's environment variables |
| Database | named volume `opal_opal-db` in Portainer's Docker |
| Tailscale node state | named volume `opal_opal-tailscale` |
| Agent workspaces | named volumes `opal-ws-*`, sandbox containers `opal-sbx-*`, network `opal-sandbox-net` |
| Portainer | http://umbrel.local:9000 (umbrelOS app `portainer`; its Docker data is under `/Apps/portainer/data/docker`) |
| Portainer's Docker socket | `/data/docker.sock` inside the docker-in-docker daemon (`/Apps/portainer/data/docker/docker.sock` on the Umbrel), group 2375. Mounted into `web` at `/var/run/docker.sock`. **`/var/run/docker.sock` inside that daemon is an empty directory, not the socket** |
| Other stacks in the same Portainer | `halo` and `searxng` (not Opal's; left untouched) |

No container publishes a port on the Umbrel. The only way in is the Funnel URL. From inside the
tailnet, the same URL works too.

Survives reboots: umbrelOS restarts the Portainer app, its Docker daemon restarts every container
with `restart: unless-stopped`, `web` waits for Postgres and applies any new migrations
(`deploy/umbrel/migrate.mjs`) before it starts, and the tunnel logs back in from its saved state.

## One-time setup (you do these)

1. **Portainer**: open http://umbrel.local:9000 and sign in. The umbrelOS default password is
   `changeme`, so change it right away (top right, **My account**). Then, on the same page, under
   **Access tokens**, choose **Add access token** and name it `opal-deploy`. Keep the `ptr_…` value
   somewhere safe, such as a password manager.
2. **Tailscale** (https://login.tailscale.com/admin):
   - **DNS** → make sure **MagicDNS** and **HTTPS Certificates** are enabled.
   - **Access controls** → the policy must allow Funnel for your devices. The default policy
     already has this; if yours doesn't, add
     `"nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]`.
   - **Settings → Keys → Generate auth key**: not reusable, not ephemeral. Copy the `tskey-auth-…` value.
   - After the first deploy, on **Machines → opal → … → Disable key expiry**, so the node doesn't
     drop off after 180 days.
3. **Google OAuth** (console.cloud.google.com → APIs & Services → Credentials → your OAuth client):
   - Authorized JavaScript origins: add `https://opal.tailefea70.ts.net`
   - Authorized redirect URIs: add `https://opal.tailefea70.ts.net/api/auth/callback/google`
   Email/password sign-in is off in production, so Google is the only way to sign in.
   `OPAL_ADMIN_EMAILS` (taken from `.env.local`) decides who becomes admin on first sign-in.

## Deploy

From the repo root in PowerShell, on the dev PC (Docker Desktop running):

Windows PowerShell may refuse to run scripts; prefix each with
`powershell -ExecutionPolicy Bypass -File` (as below) instead of changing the system policy.

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\umbrel\build.ps1
```
Builds the four arm64 images and saves them to `deploy\umbrel\out\`. Next compiles natively; only
the sandbox and a few native packages build under emulation. **Docker Desktop needs about 8 GB of
memory** (Settings → Resources): with the 2 GB default, `next build` is killed. Tarballs: web
≈560 MB, sandbox ≈1.2 GB, search ≈100 MB, tunnel ≈60 MB.

The web image also carries the Opal Code runner AppImages from `apps\runner\dist` (both arches,
≈210 MB each; `OPAL_RUNNER_DIST=/opt/opal-runner` in the image), which Code → Machines hands
out. Build them first with `npm run appimage` in `apps\runner`; `build.ps1` stops if they're
missing. Rebuild the web image whenever the runner changes.

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\umbrel\make-env.ps1
```
Writes `deploy\umbrel\.env.umbrel` from `apps\web\.env.local`. It keeps the gate password hash,
Google client, admin emails and model/API keys, generates fresh server secrets and the Postgres
password, and asks for the Tailscale auth key. It never prints values. It drops development-only
settings, such as email login, localhost URLs and Ollama/LM Studio.

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\umbrel\deploy.ps1
```
Asks for the Portainer token (or reads `$env:PORTAINER_API_KEY`), uploads the tarballs into
Portainer's Docker, and creates or updates the `opal` stack, then follows the containers until
they're up. Open https://opal.tailefea70.ts.net: you get the gate, then Google sign-in.

### Creating or updating the stack by hand (Portainer UI)

If the script's stack step fails (it used to hang there, which Windows PowerShell's own web
requests caused; the script now makes every call with `curl.exe` and stops with an error after
10 minutes at most), the images are already loaded, so do the stack step in Portainer:

1. Copy the stack file:
   `Get-Content -Raw .\deploy\umbrel\docker-compose.yml | Set-Clipboard`
2. Portainer → **primary** → **Stacks** → **+ Add stack** (or open `opal` → **Editor** to update).
3. Name `opal`, **Web editor**, paste.
4. **Environment variables** → **Load variables from .env file** → `deploy\umbrel\.env.umbrel`.
   (On an update, the existing variables stay; leave them.)
5. **Deploy the stack** / **Update the stack**.

### Updating

```powershell
.\deploy\umbrel\build.ps1 -Only web
```
```powershell
.\deploy\umbrel\deploy.ps1 -Only web
```
`deploy.ps1` loads the image and then updates the stack, which recreates `web` on the new image.
A plain **Restart** or **Stop/Start** in Portainer does *not* pick up a new image: it restarts the
existing container. To do the stack step by hand: Portainer → **Stacks** → `opal` → **Editor** →
**Update the stack** (leave *Re-pull image* off; the images are local).

New migrations in `apps/web/drizzle/` apply automatically when `web` starts. For environment-only
changes, edit `.env.umbrel` and run `deploy.ps1 -SkipImages`. After a sandbox rebuild
(`-Only sandbox`), Opal replaces each agent's container the next time it's used, and the
workspace volumes stay.

## Operating it

- **Logs and status**: Portainer → Stacks → `opal`, then a container → Logs. `web` logs
  `[migrate] database is up to date` on every start.
- **Backups** (Postgres): Portainer → Containers → `opal-db-1` → Console (`sh`), then
  `pg_dump -U opal opal > /tmp/opal.sql`. Or from a sibling container, run
  `pg_dump -h db -U opal opal`.
- **Space**: the SD card is 20 GB. Check umbrelOS → Settings, or Portainer → Images. Remove
  unused images with Portainer → Images → *Remove unused*. Idle sandboxes stop after 20 minutes,
  but their workspace volumes stay until the agent is deleted.
- **Memory**: the Pi has 8 GB. The stack is capped at about 2.5 GB, plus up to 1.5 GB for each
  running agent sandbox.

## Security notes

- Public traffic reaches Opal only through Funnel (HTTPS, Tailscale-issued certificate). Nothing
  listens on the LAN.
- Opal's site gate covers everything except `/unlock`, `/api/gate` and `/api/code/runner/*`, which
  checks its own machine tokens. After the gate, pages need a Google session. With
  `BETTER_AUTH_URL` on https, cookies are `__Secure-`, and HSTS and the production CSP are on.
- `web` has the Docker socket of **Portainer's** docker-in-docker daemon, not umbrelOS's, so it
  can't touch umbrelOS apps. That daemon is still privileged on the Pi, so anyone who takes over
  `web` controls the containers in Portainer. Sandboxes drop all capabilities and run unprivileged.
  The `DOCKER-USER` iptables rules suggested in `apps/web/src/server/sandbox/docker.ts` aren't set
  up inside docker-in-docker.
- Secrets exist only in `.env.umbrel` (dev PC, user-only ACL) and in Portainer's stack settings.
  Never commit `.env.umbrel`.
- The Tailscale auth key is used once. After that, the node logs in from its saved state in
  `opal_opal-tailscale`.

## Turning it off

Portainer → Stacks → `opal` → **Stop**, which takes Opal offline and closes the Funnel. **Delete**
also removes the containers but keeps the named volumes, unless you remove them under Volumes.
