"use client";

import { IconBolt, IconUsersGroup } from "@tabler/icons-react";
import type { OpalDataParts } from "@/lib/types";
import { t } from "@/lib/i18n";
import { useChatActions } from "../chat-context";

/**
 * "Delegated to agents" only once a subagent was actually used in this reply. The router's
 * "agents" route just unlocks the delegation tools (always on when you chat with an agent), so
 * it isn't shown on its own. Nerd mode always shows the outcome plus the router's guess.
 */
export function RouteChip({ data, delegated }: { data: OpalDataParts["route"]; delegated: boolean }) {
  const { nerd } = useChatActions();
  if (!delegated && !nerd) return null;
  const Icon = delegated ? IconUsersGroup : IconBolt;
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-fg-subtle">
      <Icon size={14} stroke={1.5} />
      <span>{delegated ? t("chat.delegated") : t("chat.direct")}</span>
      {nerd && (
        <span className="font-mono text-[11.5px]">
          {"  "}
          route {data.route}: {data.reason} · {data.ms}ms · {data.model.split(":").slice(1).join(":")}
          {data.auto ? ` · auto: ${data.auto}` : ""}
        </span>
      )}
    </div>
  );
}
