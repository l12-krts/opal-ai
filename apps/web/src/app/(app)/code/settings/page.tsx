"use client";

// Opal Code → Settings → General. Separate from Opal chat's settings.
import { Segment, SegmentedControl, Select, SelectItem, Skeleton, Switch } from "krts.ui";
import { updateCodeSettings, useCodeSettings } from "@/lib/code-client";
import { CODE_AGENTS, type CodeAgentId, type CodeMode } from "@/lib/code-types";
import { Group, Row, SettingsPage } from "@/components/settings-ui";
import { AgentGlyph } from "@/components/code/agent-glyph";

const SETTLE = [
  { id: "1", label: "After 1 day" },
  { id: "3", label: "After 3 days" },
  { id: "7", label: "After a week" },
  { id: "30", label: "After a month" },
  { id: "0", label: "Never" },
];

export default function CodeGeneralSettings() {
  const { data } = useCodeSettings();
  const s = data?.settings;

  return (
    <SettingsPage title="General">
      {!s ? (
        <Skeleton className="h-40 rounded-[14px]" />
      ) : (
        <>
          <Group title="New threads">
            <Row label="Agent">
              <SegmentedControl
                size="sm"
                aria-label="Default agent"
                selectedKeys={[s.defaultAgent]}
                onSelectionChange={(k) => {
                  const v = [...k][0] as CodeAgentId | undefined;
                  if (v) void updateCodeSettings({ defaultAgent: v });
                }}
              >
                {CODE_AGENTS.map((a) => (
                  <Segment key={a.id} id={a.id}>
                    <span className="flex items-center gap-1.5">
                      <AgentGlyph agent={a.id} size={13} />
                      {a.label}
                    </span>
                  </Segment>
                ))}
              </SegmentedControl>
            </Row>
            <Row label="Approvals" info="Auto: safe steps run on their own and risky ones wait for you. Ask: everything waits. Full access: nothing waits.">
              <SegmentedControl
                size="sm"
                aria-label="Default approvals"
                selectedKeys={[s.defaultMode]}
                onSelectionChange={(k) => {
                  const v = [...k][0] as CodeMode | undefined;
                  if (v) void updateCodeSettings({ defaultMode: v });
                }}
              >
                <Segment id="auto">Auto</Segment>
                <Segment id="ask">Ask</Segment>
                <Segment id="full">Full access</Segment>
              </SegmentedControl>
            </Row>
            <Row label="New worktree" info="Start threads in Git projects on their own branch and folder.">
              <Switch size="sm" isSelected={s.worktreeByDefault} onChange={(v) => void updateCodeSettings({ worktreeByDefault: v })} aria-label="New worktree by default" />
            </Row>
          </Group>

          <Group title="Inbox">
            <Row label="Settle finished threads" info="A finished thread you've read moves out of the Inbox after this long. Threads with a merged pull request settle right away.">
              <Select
                aria-label="Settle finished threads"
                size="sm"
                className="w-[160px]"
                selectedKey={String(s.settleDays)}
                onSelectionChange={(k) => void updateCodeSettings({ settleDays: Number(k) })}
                items={SETTLE.some((o) => o.id === String(s.settleDays)) ? SETTLE : [...SETTLE, { id: String(s.settleDays), label: `After ${s.settleDays} days` }]}
              >
                {(item: { id: string; label: string }) => (
                  <SelectItem id={item.id} textValue={item.label}>
                    {item.label}
                  </SelectItem>
                )}
              </Select>
            </Row>
          </Group>
        </>
      )}
    </SettingsPage>
  );
}
