"use client";
// Main sidebar. Two states that morph into each other: full (264px) and a 60px icon rail.
// The rail keeps every tab as an icon, swaps the wordmark for the mark, hides the chat list,
// and moves the theme toggle above the profile picture. Positions are plain CSS transitions on
// the same curve as the width, so everything lands together.
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Focusable } from "react-aria-components";
import { Avatar, Button, Menu, MenuItem, MenuSeparator, MenuTrigger, WithTooltip, cn, toast } from "krts.ui";
import {
  IconDots,
  IconCode,
  IconEdit,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMoon,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconSettings,
  IconSparkles,
  IconSun,
  IconTrash,
  IconDeviceDesktop,
  IconChevronDown,
  IconFiles,
} from "@tabler/icons-react";
import { OpalMark, OpalWordmark } from "./brand";
import { IconAgent } from "./icons";
import { Confirm, IconButton } from "./ui";
import { apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { refreshConversations, updateSettings, useConversations, useSettings, type ConversationRow } from "@/lib/hooks";
import { t } from "@/lib/i18n";
import { useTheme, type ThemePref } from "./providers";

export const SIDEBAR_WIDTH = 264;
export const RAIL_WIDTH = 60;
/** Shared by the width and every position that moves with it. */
export const RAIL_EASE = "duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]";

type NavIcon = React.ComponentType<{ size?: number; stroke?: number; className?: string }>;

// Memory, skills and connectors live in Customization; study and handwriting in Settings.
const NAV: { href: string; label: string; icon: NavIcon }[] = [
  { href: "/code", label: "Code", icon: IconCode },
  { href: "/agents", label: t("nav.agents"), icon: IconAgent },
  { href: "/documents", label: t("nav.documents"), icon: IconFiles },
  { href: "/customization", label: t("nav.customization"), icon: IconSparkles },
  { href: "/settings", label: t("nav.settings"), icon: IconSettings },
];

function groupByDate(rows: ConversationRow[]) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups: { label: string; items: ConversationRow[] }[] = [
    { label: t("nav.pinned"), items: [] },
    { label: t("nav.today"), items: [] },
    { label: t("nav.yesterday"), items: [] },
    { label: t("nav.week"), items: [] },
    { label: t("nav.older"), items: [] },
  ];
  for (const r of rows) {
    const ts = new Date(r.updatedAt).getTime();
    const g = r.pinned ? 0 : ts >= startToday ? 1 : ts >= startToday - day ? 2 : ts >= startToday - 7 * day ? 3 : 4;
    groups[g].items.push(r);
  }
  return groups.filter((g) => g.items.length);
}

export function Sidebar({ rail = false, onToggle }: { rail?: boolean; onToggle: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useConversations();
  const groups = useMemo(() => groupByDate(data?.conversations ?? []), [data]);

  return (
    <nav className="flex h-full w-full min-w-0 flex-col" aria-label="Main">
      <div className="relative h-12 shrink-0 mt-0.75">
        {/* Full: wordmark links home. Rail: the mark, which turns into "open sidebar" on hover. */}
        <Link
          href="/"
          aria-label="Opal home"
          tabIndex={rail ? -1 : 0}
          aria-hidden={rail}
          className={cn(
            "pressable absolute left-[16px] top-[10px] flex h-7 items-center rounded-[6px] px-1 text-fg transition-opacity",
            RAIL_EASE,
            rail ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <OpalWordmark height={20} />
        </Link>
        <RailTip label={t("nav.expand")} enabled={rail}>
          <button
            type="button"
            onClick={onToggle}
            aria-label={t("nav.expand")}
            tabIndex={rail ? 0 : -1}
            aria-hidden={!rail}
            className={cn(
              "group/logo pressable absolute left-[10px] top-1 grid size-10 place-items-center rounded-[10px] text-fg transition-opacity hover:bg-surface",
              RAIL_EASE,
              rail ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <OpalMark size={20} className="transition-opacity duration-150 group-hover/logo:opacity-0" />
            <IconLayoutSidebarLeftExpand
              size={19}
              stroke={1.5}
              className="absolute text-fg-muted opacity-0 transition-opacity duration-150 group-hover/logo:opacity-100"
            />
          </button>
        </RailTip>
        <div className={cn("absolute right-2 top-[10px] transition-opacity duration-150", rail ? "pointer-events-none opacity-0" : "opacity-100")}>
          <IconButton label={t("nav.collapse")} shortcut="Ctrl Shift S" onPress={onToggle} excludeFromTabOrder={rail}>
            <IconLayoutSidebarLeftCollapse size={18} stroke={1.5} />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 px-2.5">
        <NavRow
          href="/"
          icon={IconEdit}
          label={t("nav.newChat")}
          active={false}
          rail={rail}
          onClick={(e) => {
            e.preventDefault();
            router.push(`/?new=${Date.now().toString(36)}`);
          }}
        />
        {NAV.map((n) => (
          <NavRow key={n.href} href={n.href} icon={n.icon} label={n.label} active={pathname.startsWith(n.href)} rail={rail} />
        ))}
      </div>

      <div
        aria-hidden={rail}
        className={cn(
          "mt-4 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 transition-[opacity,visibility]",
          rail ? "invisible opacity-0 duration-100" : "visible opacity-100 delay-100 duration-200",
        )}
      >
        <div className="w-[244px]">
          {!data && (
            <div className="flex flex-col gap-1.5 px-2 pt-2">
              {[70, 55, 80, 62].map((w, i) => (
                <div key={i} className="h-4 rounded bg-surface" style={{ width: `${w}%` }} />
              ))}
            </div>
          )}
          {groups.map((g) => (
            <section key={g.label} className="mb-3">
              <h2 className="px-2 pb-1 pt-2 text-[12px] font-medium text-fg-subtle">{g.label}</h2>
              <ul className="flex flex-col gap-px">
                {g.items.map((c) => (
                  <ConversationItem key={c.id} c={c} active={pathname === `/c/${c.id}`} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <UserArea rail={rail} />
    </nav>
  );
}

/** Tooltip to the right, only while the sidebar is a rail (labels are hidden then). */
function RailTip({ label, enabled, children }: { label: string; enabled: boolean; children: React.ReactElement<React.DOMAttributes<Element>, string> }) {
  if (!enabled) return children;
  return (
    <WithTooltip content={label} placement="right" delay={300}>
      <Focusable>{children}</Focusable>
    </WithTooltip>
  );
}

function NavRow({
  href,
  icon: Icon,
  label,
  active,
  rail,
  onClick,
}: {
  href: string;
  icon: NavIcon;
  label: string;
  active: boolean;
  rail: boolean;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <RailTip label={label} enabled={rail}>
      <Link
        href={href}
        onClick={onClick}
        aria-label={rail ? label : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "pressable flex h-9 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-[10px] pl-[11.5px] pr-2 text-[13.5px]",
          active ? "bg-surface-hover text-fg" : "text-fg/80 hover:bg-surface hover:text-fg",
        )}
      >
        <Icon size={17} stroke={1.5} className="shrink-0" />
        <span className={cn("transition-opacity", RAIL_EASE, rail ? "opacity-0" : "opacity-100")}>{label}</span>
      </Link>
    </RailTip>
  );
}

function ConversationItem({ c, active }: { c: ConversationRow; active: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(c.title);

  async function rename() {
    setEditing(false);
    const next = title.trim();
    if (!next || next === c.title) return setTitle(c.title);
    await apiFetch(`/api/conversations/${c.id}`, { method: "PATCH", json: { title: next } }).catch(() => toast.error("Couldn't rename"));
    refreshConversations();
  }

  return (
    <li className="group relative">
      {editing ? (
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename();
            if (e.key === "Escape") {
              setTitle(c.title);
              setEditing(false);
            }
          }}
          className="h-8 w-full rounded-[8px] border border-line bg-bg px-2 text-[13.5px] outline-none focus:border-accent-line"
          maxLength={120}
        />
      ) : (
        <Link
          href={`/c/${c.id}`}
          className={cn(
            "flex h-8 items-center rounded-[8px] pl-2 pr-8 text-[13.5px]",
            active ? "bg-surface-hover text-fg" : "text-fg/80 hover:bg-surface hover:text-fg",
          )}
          title={c.title}
        >
          <span className="truncate">{c.title}</span>
        </Link>
      )}
      {!editing && (
        <div className={cn("absolute right-1 top-1/2 -translate-y-1/2", active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
          <MenuTrigger>
            <Button variant="ghost" size="xs" isIconOnly aria-label="Chat options" className="size-6 text-fg-muted">
              <IconDots size={15} stroke={1.5} />
            </Button>
            <Menu
              placement="bottom start"
              onAction={async (key) => {
                if (key === "rename") setEditing(true);
                if (key === "pin") {
                  await apiFetch(`/api/conversations/${c.id}`, { method: "PATCH", json: { pinned: !c.pinned } });
                  refreshConversations();
                }
                if (key === "delete") setConfirm(true);
              }}
            >
              <MenuItem id="rename" icon={<IconPencil size={15} stroke={1.5} />}>
                {t("chat.rename")}
              </MenuItem>
              <MenuItem id="pin" icon={c.pinned ? <IconPinnedOff size={15} stroke={1.5} /> : <IconPin size={15} stroke={1.5} />}>
                {c.pinned ? t("chat.unpin") : t("chat.pin")}
              </MenuItem>
              <MenuSeparator />
              <MenuItem id="delete" variant="danger" icon={<IconTrash size={15} stroke={1.5} />}>
                {t("chat.delete")}
              </MenuItem>
            </Menu>
          </MenuTrigger>
        </div>
      )}
      <Confirm
        isOpen={confirm}
        onOpenChange={setConfirm}
        title={t("chat.delete")}
        description={t("chat.deleteConfirm")}
        confirmLabel={t("common.delete")}
        variant="danger"
        onConfirm={async () => {
          await apiFetch(`/api/conversations/${c.id}`, { method: "DELETE" });
          refreshConversations();
          if (active) router.push("/");
        }}
      />
    </li>
  );
}

/**
 * Profile and theme. Full: one row, theme on the right. Rail: theme above the profile picture.
 * Both are positioned absolutely so they glide between the two spots.
 */
function UserArea({ rail }: { rail: boolean }) {
  const { data } = useSettings();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const user = data?.user;

  const nextTheme: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };
  const ThemeIcon = theme === "dark" ? IconMoon : theme === "light" ? IconSun : IconDeviceDesktop;

  return (
    <div className={cn("relative shrink-0 border-t border-line-subtle transition-[height]", RAIL_EASE)} style={{ height: rail ? 96 : 56 }}>
      <div
        className={cn("absolute bottom-2 left-2.5 transition-[width]", RAIL_EASE)}
        style={{ width: rail ? 40 : "calc(100% - 52px)" }}
      >
        <MenuTrigger>
          <Button
            variant="ghost"
            size="sm"
            aria-label={rail ? (user?.name ?? "Account") : undefined}
            className="h-10 w-full min-w-0 justify-start gap-2.5 overflow-hidden px-2"
            animateWidth={false}
          >
            <Avatar name={user?.name ?? "?"} src={user?.image ?? undefined} size={24} />
            <span className={cn("min-w-0 flex-1 truncate whitespace-nowrap text-left text-[13.5px] transition-opacity", RAIL_EASE, rail && "opacity-0")}>
              {user?.name ?? " "}
            </span>
            <IconChevronDown size={15} stroke={1.5} className={cn("shrink-0 transition-opacity", RAIL_EASE, rail && "opacity-0")} />
          </Button>
          <Menu
            placement={rail ? "right bottom" : "top start"}
            onAction={async (key) => {
              if (key === "settings") router.push("/settings");
              if (key === "signout") {
                await signOut();
                window.location.assign("/login");
              }
            }}
          >
            <MenuItem id="settings" icon={<IconSettings size={15} stroke={1.5} />}>
              {t("nav.settings")}
            </MenuItem>
            <MenuSeparator />
            <MenuItem id="signout" icon={<IconLogout size={15} stroke={1.5} />}>
              {t("nav.signOut")}
            </MenuItem>
          </Menu>
        </MenuTrigger>
      </div>
      <div
        className={cn("absolute transition-[left,bottom]", RAIL_EASE)}
        style={{ left: rail ? 16 : "calc(100% - 38px)", bottom: rail ? 56 : 14 }}
      >
        <IconButton
          label={`${t("nav.theme")}: ${theme}`}
          onPress={() => {
            const n = nextTheme[theme];
            setTheme(n);
            void updateSettings({ theme: n });
          }}
        >
          <ThemeIcon size={17} stroke={1.5} />
        </IconButton>
      </div>
    </div>
  );
}
