# syntax=docker/dockerfile:1
# Builds the Opal runner as an AppImage for the target platform and exports only the file:
#   docker buildx build --platform linux/arm64 -f appimage/Dockerfile --output type=local,dest=dist .
# (run from apps/runner; `npm run appimage` does this).
#
# Everything runs natively on the build machine, with no emulation: npm installs the target's
# packages (`--cpu`), Node comes from nodejs.org for the target, and appimagetool runs on the host
# architecture. Install scripts are skipped, so node-pty is left out and the runner uses `script`
# for terminals instead.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
ARG TARGETARCH
ARG BUILDARCH
ARG NODE_MAJOR=22
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl file xz-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /AppDir/app
COPY package.json package-lock.json ./
RUN set -eux; \
    case "$TARGETARCH" in arm64) CPU=arm64 ;; amd64) CPU=x64 ;; *) echo "unsupported $TARGETARCH"; exit 1 ;; esac; \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund --os=linux --cpu=$CPU; \
    rm -rf node_modules/node-pty node_modules/@anthropic-ai/claude-agent-sdk-linux-*-musl; \
    test -x "node_modules/@anthropic-ai/claude-agent-sdk-linux-$CPU/claude"; \
    test -d "node_modules/@esbuild/linux-$CPU"
COPY tsconfig.json ./
COPY src ./src
COPY appimage/AppRun appimage/opal-runner.desktop appimage/opal-runner.png /AppDir/

RUN set -eux; \
    case "$TARGETARCH" in arm64) CPU=arm64; A=aarch64 ;; amd64) CPU=x64; A=x86_64 ;; esac; \
    case "$BUILDARCH" in arm64) H=aarch64 ;; amd64) H=x86_64 ;; esac; \
    mkdir -p /AppDir/usr/bin /out /tmp/node; \
    # Node for the target, checked against nodejs.org's published checksums.
    BASE="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"; \
    curl -fsSL "$BASE/SHASUMS256.txt" -o /tmp/SHASUMS256.txt; \
    TAR="$(grep -o "node-v[0-9.]*-linux-$CPU.tar.xz" /tmp/SHASUMS256.txt | head -n1)"; \
    curl -fsSL "$BASE/$TAR" -o "/tmp/$TAR"; \
    (cd /tmp && grep " $TAR\$" SHASUMS256.txt | sha256sum -c -); \
    tar -xJf "/tmp/$TAR" -C /tmp/node --strip-components=1; \
    cp /tmp/node/bin/node /AppDir/usr/bin/node; \
    file /AppDir/usr/bin/node; \
    ln -s "../../app/node_modules/@anthropic-ai/claude-agent-sdk-linux-$CPU/claude" /AppDir/usr/bin/claude; \
    printf '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/../../AppRun" "$@"\n' > /AppDir/usr/bin/opal-runner; \
    chmod +x /AppDir/AppRun /AppDir/usr/bin/opal-runner; \
    curl -fsSL -o /tmp/appimagetool "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$H.AppImage"; \
    chmod +x /tmp/appimagetool; \
    ARCH=$A /tmp/appimagetool --appimage-extract-and-run --no-appstream /AppDir "/out/opal-runner-$A.AppImage"; \
    ls -la /out

FROM scratch
COPY --from=build /out/ /
