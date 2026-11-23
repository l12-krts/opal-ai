import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { devEmailLoginEnabled, googleEnabled } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  const desktop = /OpalDesktop\//.test(h.get("user-agent") ?? "");
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (session) redirect(target);

  return (
    <main className="grid min-h-[100dvh] place-items-center px-4">
      <LoginForm next={target} google={googleEnabled()} devEmail={devEmailLoginEnabled()} desktop={desktop} />
    </main>
  );
}
