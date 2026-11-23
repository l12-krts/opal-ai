"use client";

import { useState } from "react";
import useSWR from "swr";
import { Skeleton } from "krts.ui";
import { IconKey, IconTrash } from "@tabler/icons-react";
import { apiFetch, fetcher } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Confirm, IconButton } from "@/components/ui";
import { EmptyRow, Group, Row, SettingsPage } from "@/components/settings-ui";

type SecretRow = { name: string; label: string; description: string; updatedAt: string; lastUsedAt: string | null };

export default function SecretsSettingsPage() {
  const secrets = useSWR<{ secrets: SecretRow[] }>("/api/secrets", fetcher);
  const [deleting, setDeleting] = useState<SecretRow | null>(null);
  const list = secrets.data?.secrets ?? [];

  return (
    <SettingsPage title={t("settings.vault")} info="Passwords and keys your agents asked for. Encrypted; never shown to you or the AI.">
      <Group>
        {!secrets.data && (
          <div className="p-3">
            <Skeleton className="h-9" />
          </div>
        )}
        {secrets.data && !list.length && <EmptyRow>No secrets yet</EmptyRow>}
        {list.map((s) => (
          <Row
            key={s.name}
            icon={<IconKey size={16} stroke={1.5} />}
            label={s.label}
            sub={
              <>
                <span className="font-mono">{s.name}</span>
                {s.lastUsedAt ? ` · used ${new Date(s.lastUsedAt).toLocaleDateString()}` : ""}
              </>
            }
          >
            <IconButton label={`Delete ${s.label}`} onPress={() => setDeleting(s)}>
              <IconTrash size={15} stroke={1.5} />
            </IconButton>
          </Row>
        ))}
      </Group>

      <Confirm
        isOpen={Boolean(deleting)}
        onOpenChange={(o: boolean) => !o && setDeleting(null)}
        title={`Delete ${deleting?.label ?? "secret"}?`}
        description="Agents that use it will ask for it again."
        confirmLabel={t("common.delete")}
        variant="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await apiFetch(`/api/secrets?name=${encodeURIComponent(deleting.name)}`, { method: "DELETE" });
          await secrets.mutate();
          setDeleting(null);
        }}
      />
    </SettingsPage>
  );
}
