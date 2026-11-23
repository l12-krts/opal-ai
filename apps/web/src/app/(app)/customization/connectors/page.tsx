"use client";

import { Suspense, useDeferredValue, useEffect, useState } from "react";
import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { Button, SearchField, Skeleton, toast } from "krts.ui";
import { apiFetch, fetcher } from "@/lib/api";
import { EmptyRow, Group, Row, SettingsPage } from "@/components/settings-ui";

type Toolkit = { slug: string; name: string; logo?: string; connected: boolean; connectedAccountId?: string; noAuth: boolean };

function Logo({ t }: { t: Toolkit }) {
  return t.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={t.logo} alt="" className="app-logo size-7 rounded-[7px] object-contain" loading="lazy" referrerPolicy="no-referrer" />
  ) : (
    <span className="grid size-7 place-items-center rounded-[7px] bg-surface text-[12px] font-medium">{t.name.slice(0, 1)}</span>
  );
}

function Connectors() {
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q);
  const sp = useSearchParams();
  const { data, isLoading, mutate, error } = useSWR<{ enabled: boolean; toolkits: Toolkit[] }>(`/api/connectors${dq ? `?q=${encodeURIComponent(dq)}` : ""}`, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const connected = (data?.toolkits ?? []).filter((t) => t.connected);
  const others = (data?.toolkits ?? []).filter((t) => !t.connected);

  useEffect(() => {
    const c = sp.get("connected");
    if (c && c !== "1") toast.success(`${c} connected`);
  }, [sp]);

  async function connect(t: Toolkit) {
    setBusy(t.slug);
    try {
      const { redirectUrl } = await apiFetch<{ redirectUrl: string }>("/api/connectors", { method: "POST", json: { toolkit: t.slug } });
      window.location.assign(redirectUrl);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  }

  async function disconnect(t: Toolkit) {
    if (!t.connectedAccountId) return;
    setBusy(t.slug);
    try {
      await apiFetch(`/api/connectors?account=${encodeURIComponent(t.connectedAccountId)}`, { method: "DELETE" });
      await mutate();
      toast(`${t.name} disconnected`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (data && !data.enabled) {
    return (
      <SettingsPage title="Connectors">
        <Group>
          <Row label="Not set up" info="Add COMPOSIO_API_KEY to apps/web/.env.local and restart the server." />
        </Group>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage
      title="Connectors"
      info="Apps Opal and your agents can use. They ask before changing anything. Sign-in goes through Composio; Opal never sees your passwords."
      wide
      action={<SearchField size="sm" aria-label="Search apps" placeholder="Search apps" value={q} onChange={setQ} className="w-[min(44vw,240px)]" />}
    >
      {error && <p className="text-[13px] text-danger">{(error as Error).message}</p>}

      {connected.length > 0 && (
        <Group title="Connected">
          {connected.map((t) => (
            <Row key={t.slug} icon={<Logo t={t} />} label={t.name}>
              <Button size="xs" variant="ghost" isPending={busy === t.slug} onPress={() => disconnect(t)}>
                Disconnect
              </Button>
            </Row>
          ))}
        </Group>
      )}

      <Group title={connected.length ? "More apps" : "Apps"} bare>
        {isLoading && !data && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-[52px] rounded-[12px]" />
            ))}
          </div>
        )}
        {data && !others.length && (
          <div className="rounded-[14px] border border-line-subtle bg-overlay">
            <EmptyRow>{q ? "No apps match" : "Every app is connected"}</EmptyRow>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {others.map((t) => (
            <div key={t.slug} className="flex h-[52px] items-center gap-3 rounded-[12px] border border-line-subtle bg-overlay px-3">
              <Logo t={t} />
              <span className="min-w-0 flex-1 truncate text-[13.5px]">{t.name}</span>
              {t.noAuth ? (
                <span className="text-[12px] text-fg-subtle">Ready</span>
              ) : (
                <Button size="xs" variant="secondary" isPending={busy === t.slug} onPress={() => connect(t)}>
                  Connect
                </Button>
              )}
            </div>
          ))}
        </div>
      </Group>
    </SettingsPage>
  );
}

export default function ConnectorsPage() {
  return (
    <Suspense fallback={null}>
      <Connectors />
    </Suspense>
  );
}
