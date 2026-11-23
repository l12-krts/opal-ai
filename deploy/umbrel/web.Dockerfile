# Opal web (Next.js, production build) for the Umbrel stack.
# Build context: apps/web, plus the named context "deploy" (this folder).
# Built for linux/arm64 by deploy/umbrel/build.ps1.
#
# Next compiles on the build machine's own architecture (fast, no emulation): its output is
# plain JavaScript. Only the few native packages are installed for the target (arm64).

FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS deps
WORKDIR /app
# allo-gr is a public GitHub dependency pinned over ssh in the lockfile; fetch it over https.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
# Placeholder values so `next build` can import server modules. They are not secrets and are
# not used at runtime: the server reads the real environment when it starts.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    OPAL_STANDALONE=1 \
    NODE_OPTIONS=--max-old-space-size=4096 \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=build-only-placeholder-not-a-secret-000000 \
    OPAL_GATE_PASSWORD_HASH=scrypt:build-only \
    OPAL_GATE_SECRET=build-only-placeholder-not-a-secret-000000 \
    OPAL_SECRETS_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=
RUN npm run build

# Target-architecture packages, at the app's exact versions: sharp's native binaries, plus
# drizzle-orm and pg for the migrator that runs at container start (drizzle-kit stays out).
FROM node:22-bookworm-slim AS native
WORKDIR /native
COPY --from=deps /app/node_modules/sharp/package.json /tmp/v/sharp.json
COPY --from=deps /app/node_modules/drizzle-orm/package.json /tmp/v/drizzle-orm.json
COPY --from=deps /app/node_modules/pg/package.json /tmp/v/pg.json
RUN npm init -y >/dev/null \
 && npm install --no-audit --no-fund --omit=dev \
      $(for p in sharp drizzle-orm pg; do echo "$p@$(node -p "require('/tmp/v/$p.json').version")"; done)

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    OPAL_RUNNER_DIST=/opt/opal-runner
WORKDIR /app
# The runner AppImages that Code → Machines hands out (/api/code/runner/download). "runner" is a
# named build context: --build-context runnerdist=apps/runner/dist. First, so the big layer stays
# cached when only the app changes.
COPY --from=runnerdist opal-runner-*.AppImage /opt/opal-runner/
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
# Swap the build machine's sharp binaries for the target's.
RUN rm -rf node_modules/sharp node_modules/@img
COPY --from=native --chown=node:node /native/node_modules ./node_modules
# "deploy" is a named build context: --build-context deploy=deploy/umbrel
COPY --from=deploy --chown=node:node migrate.mjs ./migrate.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/unlock').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node migrate.mjs && exec node server.js"]
