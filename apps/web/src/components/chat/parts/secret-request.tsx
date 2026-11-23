"use client";
// The value goes straight to /api/secrets (encrypted at rest). Only "saved" goes back to the
// chat; the model receives a {{secret:NAME}} placeholder from the server, never the value.
import { useState } from "react";
import { Button, TextField } from "krts.ui";
import { IconCheck, IconLock } from "@tabler/icons-react";
import { apiFetch } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useChatActions } from "../chat-context";

export function SecretRequest({ part }: { part: any }) {
  const { answerTool } = useChatActions();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const input = part.input ?? {};
  const done = part.state === "output-available";

  if (part.state === "input-streaming") return null;

  if (done) {
    return (
      <div className="flex items-center gap-2 text-[13.5px] text-fg-muted">
        {part.output?.status === "saved" ? <IconCheck size={15} stroke={1.75} className="text-success" /> : <IconLock size={15} stroke={1.5} />}
        {part.output?.status === "saved" ? `${input.label ?? input.name} ${t("secret.saved").toLowerCase()}` : `${input.label ?? input.name} not provided`}
      </div>
    );
  }

  async function save() {
    if (!value) return;
    setPending(true);
    setError(undefined);
    try {
      await apiFetch("/api/secrets", {
        method: "POST",
        json: { name: input.name, label: input.label ?? input.name, description: input.reason ?? "", value },
      });
      setValue("");
      answerTool("request_secret", part.toolCallId, { status: "saved" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="rounded-card border border-line bg-overlay px-3.5 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      autoComplete="off"
    >
      <div className="flex items-center gap-2">
        <IconLock size={16} stroke={1.5} className="text-fg-muted" />
        <span className="text-[13.5px] font-medium">{t("secret.title")}</span>
      </div>
      {input.reason && <p className="mt-1 text-[13px] text-fg-muted">{input.reason}</p>}
      <TextField
        className="mt-3"
        size="sm"
        type="password"
        label={input.label ?? input.name}
        value={value}
        onChange={setValue}
        autoComplete="new-password"
        isInvalid={Boolean(error)}
        errorMessage={error}
      />
      <p className="mt-2 text-[12px] text-fg-subtle">{t("secret.hint")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <Button size="xs" variant="ghost" onPress={() => answerTool("request_secret", part.toolCallId, { status: "declined" })}>
          {t("common.cancel")}
        </Button>
        <Button size="xs" type="submit" className="btn-accent" isPending={pending} isDisabled={!value}>
          {t("secret.save")}
        </Button>
      </div>
    </form>
  );
}
