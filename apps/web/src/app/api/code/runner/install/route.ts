// GET ?code=XXXX-XXXX: a shell script that installs the runner AppImage on a Linux machine,
// pairs it with this Opal and starts it as a user service. Shown in Code → Machines as:
//   curl -fsSL '<opal>/api/code/runner/install?code=XXXX-XXXX' | sh
import type { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/server/http";
import { checkPairingCode, publicOrigin } from "@/server/code/runner-dist";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("code");
    await checkPairingCode(req, raw);
    const code = (raw ?? "").trim().toUpperCase();
    const origin = publicOrigin(req);
    if (!/^https?:\/\/[\w.\-:[\]]+$/.test(origin)) throw new ApiError(400, "bad_host", "Unusual host header.");
    return new Response(script(origin, code), {
      headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Shown by `sh` if someone pipes an error page into it.
    const msg = e instanceof ApiError ? e.message : "Couldn't make the install script.";
    return new Response(`echo ${JSON.stringify(`Opal: ${msg}`)} >&2; exit 1\n`, {
      status: e instanceof ApiError ? e.status : 500,
      headers: { "Content-Type": "text/x-shellscript; charset=utf-8" },
    });
  }
}

function script(opal: string, code: string) {
  return `#!/bin/sh
# Installs the Opal runner: downloads it, pairs this machine with Opal and starts it as a service.
set -eu
OPAL='${opal}'
CODE='${code}'
NAME="\${OPAL_RUNNER_NAME:-$(hostname)}"
ROOT="\${OPAL_RUNNER_ROOT:-$HOME/Projects}"
BIN_DIR="$HOME/.local/bin"
BIN="$BIN_DIR/opal-runner"

say() { printf '\\033[1m%s\\033[0m\\n' "$*"; }

case "$(uname -s)" in Linux) ;; *) echo "The Opal runner AppImage is for Linux." >&2; exit 1 ;; esac
case "$(uname -m)" in
  aarch64|arm64) ARCH=aarch64 ;;
  x86_64|amd64) ARCH=x86_64 ;;
  *) echo "Unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
command -v curl >/dev/null 2>&1 || { echo "curl is needed." >&2; exit 1; }

say "Downloading the Opal runner ($ARCH)..."
mkdir -p "$BIN_DIR"
curl -fL --progress-bar "$OPAL/api/code/runner/download?code=$CODE&arch=$ARCH" -o "$BIN.part"
chmod +x "$BIN.part"
rm -f "$BIN"
mv -f "$BIN.part" "$BIN"

# AppImages mount themselves with FUSE. Without it, unpack the runner once and run it from there
# (unpacking on every start would fill /tmp, which is in memory on many systems).
APP_DIR="$HOME/.local/share/opal-runner"
if ! command -v fusermount3 >/dev/null 2>&1 && ! command -v fusermount >/dev/null 2>&1; then
  say "FUSE isn't installed, so the runner is unpacked to $APP_DIR..."
  rm -rf "$APP_DIR.new"
  mkdir -p "$APP_DIR.new"
  (cd "$APP_DIR.new" && "$BIN" --appimage-extract >/dev/null)
  rm -rf "$APP_DIR"
  mv "$APP_DIR.new/squashfs-root" "$APP_DIR"
  rm -rf "$APP_DIR.new" "$BIN"
  ln -s "$APP_DIR/AppRun" "$BIN"
else
  rm -rf "$APP_DIR"
fi
command -v git >/dev/null 2>&1 || say "Git isn't installed, and projects need it: sudo apt install git"

say "Pairing this machine as \\"$NAME\\"..."
"$BIN" pair "$OPAL" "$CODE" --name "$NAME" --root "$ROOT"

if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/opal-runner.service" <<UNIT
[Unit]
Description=Opal runner
After=network-online.target

[Service]
ExecStart=$BIN start
# Tools installed for this user only (git, claude, codex) live in ~/.local/bin.
Environment=PATH=$BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable opal-runner.service >/dev/null 2>&1
  systemctl --user restart opal-runner.service
  say "The runner is running as a service. Check it with: systemctl --user status opal-runner"
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != "yes" ]; then
    if loginctl enable-linger "$(id -un)" 2>/dev/null; then
      say "It will keep running after you log out, and start at boot."
    else
      say "To keep it running after you log out and start it at boot, run once: sudo loginctl enable-linger $(id -un)"
    fi
  fi
else
  say "Start it with: $BIN start"
fi
`;
}
