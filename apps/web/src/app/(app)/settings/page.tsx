"use client";

import { Avatar, Badge, Segment, SegmentedControl, Select, SelectItem, Skeleton, Switch } from "krts.ui";
import { IconLogout } from "@tabler/icons-react";
import { Radio, RadioGroup } from "react-aria-components";
import { ACCENTS, isAccent } from "@/lib/accents";
import { updateSettings, useSettings } from "@/lib/hooks";
import { signOut } from "@/lib/auth-client";
import { t } from "@/lib/i18n";
import { Group, Row, SettingsPage, Status } from "@/components/settings-ui";
import { useTheme, type ThemePref } from "@/components/providers";

export default function GeneralSettingsPage() {
  const { data } = useSettings();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const nerd = data?.settings.nerdMode ?? false;
  const model = data?.models.find((m) => m.id === data.defaultModel);

  return (
    <SettingsPage title={t("settings.general")}>
      <Group title={t("settings.account")}>
        {data ? (
          <Row
            icon={<Avatar name={data.user.name} src={data.user.image ?? undefined} size={32} />}
            label={data.user.name}
            sub={data.user.email}
          >
            <Badge tone="neutral">{data.user.role}</Badge>
          </Row>
        ) : (
          <div className="p-3">
            <Skeleton className="h-9" />
          </div>
        )}
        <button
          type="button"
          onClick={async () => {
            await signOut();
            window.location.assign("/login");
          }}
          className="pressable flex min-h-12 w-full items-center gap-3 px-4 text-left text-[13.5px] text-danger hover:bg-surface/60"
        >
          <IconLogout size={16} stroke={1.5} />
          {t("nav.signOut")}
        </button>
      </Group>

      <Group title="Appearance">
        <Row label={t("settings.theme")}>
          <SegmentedControl
            size="sm"
            aria-label={t("settings.theme")}
            selectedKeys={[theme]}
            onSelectionChange={(k) => {
              const v = [...k][0] as ThemePref;
              if (!v) return;
              setTheme(v);
              void updateSettings({ theme: v });
            }}
          >
            <Segment id="system">System</Segment>
            <Segment id="light">Light</Segment>
            <Segment id="dark">Dark</Segment>
          </SegmentedControl>
        </Row>
        <Row label="Accent">
          <RadioGroup
            aria-label="Accent"
            orientation="horizontal"
            value={accent}
            onChange={(v) => {
              if (!isAccent(v)) return;
              setAccent(v);
              void updateSettings({ accent: v });
            }}
            className="flex flex-wrap justify-end gap-1"
          >
            {ACCENTS.map((a) => (
              <Radio
                key={a.id}
                value={a.id}
                aria-label={a.label}
                className="pressable grid size-7 cursor-default place-items-center rounded-full outline-none transition-shadow duration-150 data-[selected]:shadow-[0_0_0_2px_var(--color-fg)] data-[focus-visible]:shadow-[0_0_0_2px_var(--color-accent-line)]"
              >
                <span data-accent={a.id} className="size-5 rounded-full bg-accent shadow-[inset_0_0_0_1.5px_var(--opal-accent-line)]" />
              </Radio>
            ))}
          </RadioGroup>
        </Row>
      </Group>

      <Group title="Advanced">
        <Row label={t("settings.nerd")} info="Shows reasoning, raw tool calls and token counts.">
          <Switch size="sm" isSelected={nerd} onChange={(v) => void updateSettings({ nerdMode: v })} aria-label={t("settings.nerd")} />
        </Row>
        {nerd && data && data.models.length > 0 && (
          <Row label="Default model">
            <Select
              aria-label="Default model"
              size="sm"
              className="w-[220px]"
              selectedKey={data.settings.model ?? "default"}
              onSelectionChange={(k) => void updateSettings({ model: k === "default" ? null : String(k) })}
              items={[{ id: "default", label: "Server default" }, ...data.models.map((m) => ({ id: m.id, label: m.tier ? m.label : `${m.label} (${m.providerLabel})` }))]}
            >
              {(item: { id: string; label: string }) => (
                <SelectItem id={item.id} textValue={item.label}>
                  {item.label}
                </SelectItem>
              )}
            </Select>
          </Row>
        )}
      </Group>

      {data && (
        <Group title="Status">
          <Row label="AI">
            <Status ok={data.status.ai}>{data.status.ai ? (model?.label ?? data.defaultModel) : "Off"}</Status>
          </Row>
          <Row label="Web search" info={data.status.search ? undefined : "Start the search service: docker compose up -d search"}>
            <Status ok={data.status.search}>{data.status.search ? "Ready" : "Limited"}</Status>
          </Row>
          <Row label={t("nav.connectors")} info={data.status.connectors ? undefined : "Add COMPOSIO_API_KEY to .env.local."}>
            <Status ok={data.status.connectors}>{data.status.connectors ? "Ready" : "Off"}</Status>
          </Row>
          <Row label="Agent computers" info={data.status.sandbox ? undefined : "Start Docker to give agents their computers."}>
            <Status ok={data.status.sandbox}>{data.status.sandbox ? "Ready" : "Off"}</Status>
          </Row>
        </Group>
      )}
    </SettingsPage>
  );
}
