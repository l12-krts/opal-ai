"use client";
// Loaded inside the desktop app's window after it receives opal://auth?token=...
// Exchanges the one-time token for a session cookie in this webview.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { OpalMark } from "@/components/brand";
import { authClient } from "@/lib/auth-client";

function Callback() {
  const sp = useSearchParams();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const token = sp.get("token");
    if (!token || token.length > 512) {
      setError("This sign-in link is missing or invalid.");
      return;
    }
    authClient.oneTimeToken.verify({ token }).then((res) => {
      if (res.error) setError("This sign-in link has expired. Try again from the app.");
      else window.location.replace("/");
    });
  }, [sp]);

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <OpalMark size={28} className={error ? "text-fg-muted" : "status-pulse text-fg"} />
        <p className="text-sm text-fg-muted">{error ?? "Signing you in"}</p>
      </div>
    </main>
  );
}

export default function DesktopCallback() {
  return (
    <Suspense fallback={null}>
      <Callback />
    </Suspense>
  );
}
