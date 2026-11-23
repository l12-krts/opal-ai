"use client";

import { useState } from "react";
import { Button, Separator, TextField } from "krts.ui";
import { IconBrandGoogleFilled } from "@tabler/icons-react";
import { OpalWordmark } from "@/components/brand";
import { signIn, signUp } from "@/lib/auth-client";
import { t } from "@/lib/i18n";

export function LoginForm({ next, google, devEmail, desktop }: { next: string; google: boolean; devEmail: boolean; desktop?: boolean }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onGoogle() {
    setPending(true);
    setError(undefined);
    const res = await signIn.social({ provider: "google", callbackURL: next });
    if (res?.error) {
      setError(res.error.message ?? "Sign-in failed");
      setPending(false);
    }
  }

  async function onEmail(form: FormData) {
    setPending(true);
    setError(undefined);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const res =
      mode === "in"
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: String(form.get("name") ?? "") || email.split("@")[0] });
    if (res.error) {
      setError(res.error.message ?? "Sign-in failed");
      setPending(false);
      return;
    }
    window.location.assign(next);
  }

  return (
    <div className="w-full max-w-[340px]">
      <OpalWordmark height={26} className="mb-8 text-fg" />
      <h1 className="text-[17px] font-medium">{t("login.title")}</h1>

      {desktop ? (
        <>
          {/* Google blocks sign-in inside embedded windows; the desktop app opens this link in the system browser. */}
          <a
            href="/desktop/login"
            className="btn-accent pressable mt-6 inline-flex h-9 w-full items-center justify-center rounded-[8px] text-sm font-medium"
          >
            Continue in your browser
          </a>
          <p className="mt-2 text-[12.5px] text-fg-subtle">You&apos;ll come back here signed in.</p>
        </>
      ) : google ? (
        <Button size="sm" variant="secondary" className="mt-6 w-full" animateWidth={false} onPress={onGoogle} isDisabled={pending}
          startContent={<IconBrandGoogleFilled size={16} stroke={1.5} />}>
          {t("login.google")}
        </Button>
      ) : (
        <p className="mt-4 rounded-[10px] border border-line-subtle bg-surface px-3 py-2.5 text-[13px] text-fg-muted">
          {t("login.noProviders")}
        </p>
      )}

      {devEmail && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-fg-subtle">
            <Separator className="flex-1" />
            <span>{t("login.devTitle")}</span>
            <Separator className="flex-1" />
          </div>
          <form action={onEmail} className="flex flex-col gap-3">
            {mode === "up" && <TextField name="name" size="sm" label={t("login.name")} autoComplete="name" />}
            <TextField name="email" type="email" size="sm" label={t("login.email")} autoComplete="email" isRequired />
            <TextField
              name="password"
              type="password"
              size="sm"
              label={t("login.password")}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              isRequired
              minLength={10}
            />
            <Button type="submit" size="sm" variant="primary" className="mt-1 w-full" animateWidth={false} isPending={pending}>
              {mode === "in" ? t("login.signIn") : t("login.signUp")}
            </Button>
            <button
              type="button"
              className="pressable self-start text-[13px] text-fg-muted hover:text-fg"
              onClick={() => setMode(mode === "in" ? "up" : "in")}
            >
              {mode === "in" ? t("login.switchToSignUp") : t("login.switchToSignIn")}
            </button>
            <p className="text-xs text-fg-subtle">{t("login.devHint")}</p>
          </form>
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
