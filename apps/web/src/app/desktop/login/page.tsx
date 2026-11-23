// Opened in the system browser by the desktop/iOS app. The user is signed in here (the proxy
// sends them through /login first), so we mint a single-use, 2-minute token and hand it to the
// app through its opal:// link. The app exchanges it for a session.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { OpalMark } from "@/components/brand";
import { HandoffRedirect } from "./redirect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Open the app" };

export default async function DesktopLogin() {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session) redirect("/login?next=/desktop/login");
  const { token } = await auth.api.generateOneTimeToken({ headers: h });
  const href = `opal://auth?token=${encodeURIComponent(token)}`;
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <div className="w-full max-w-[340px]">
        <OpalMark size={28} className="mb-6 text-fg" />
        <h1 className="text-[17px] font-medium">Signed in as {session.user.name}</h1>
        <p className="mt-1 text-sm text-fg-muted">Return to the Opal app to continue. This link works once and expires in 2 minutes.</p>
        <a href={href} className="btn-accent pressable mt-6 inline-flex h-9 w-full items-center justify-center rounded-[8px] text-sm font-medium">
          Open Opal
        </a>
        <HandoffRedirect href={href} />
      </div>
    </main>
  );
}
