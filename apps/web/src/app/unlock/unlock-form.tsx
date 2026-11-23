"use client";

import { useActionState } from "react";
import { Button, TextField } from "krts.ui";
import { OpalMark } from "@/components/brand";
import { unlockAction, type UnlockState } from "@/server/gate-actions";
import { t } from "@/lib/i18n";

export function UnlockForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlockAction, undefined);
  const error = state?.error === "wrong" ? t("unlock.wrong") : state?.error === "limited" ? t("unlock.limited") : undefined;

  return (
    <form action={action} className="w-full max-w-[340px]">
      <OpalMark size={28} className="mb-6 text-fg" />
      <h1 className="text-[17px] font-medium">{t("unlock.title")}</h1>
      <p className="mt-1 text-sm text-fg-muted">{t("unlock.body")}</p>
      <input type="hidden" name="next" value={next} />
      <TextField
        className="mt-6"
        name="password"
        type="password"
        size="sm"
        label={t("unlock.password")}
        autoComplete="current-password"
        autoFocus
        isRequired
        isInvalid={Boolean(error)}
        errorMessage={error}
      />
      <Button type="submit" size="sm" className="btn-accent mt-4 w-full" animateWidth={false} isPending={pending}>
        {t("unlock.submit")}
      </Button>
    </form>
  );
}
