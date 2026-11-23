"use client";
// The "+" menu (files, study, agents, handwriting, model, connectors) and the model picker that
// appears next to it once the composer grows past one line.
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button, Menu, MenuItem, MenuSection, MenuSeparator, MenuTrigger, SubmenuTrigger, cn } from "krts.ui";
import { MenuItem as AriaMenuItem, Text } from "react-aria-components";
import {
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconCpu,
  IconPaperclip,
  IconPlugConnected,
  IconPlus,
  IconSignature,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { ModelInfoView } from "@/lib/client-types";
import { t } from "@/lib/i18n";

export type ToggleId = "study" | "agents" | "handwriting";

export const TOGGLES: { id: ToggleId; label: () => string; hint: () => string; icon: typeof IconBook2 }[] = [
  { id: "study", label: () => t("composer.study"), hint: () => t("composer.studyHint"), icon: IconBook2 },
  { id: "agents", label: () => t("composer.useAgents"), hint: () => t("composer.useAgentsHint"), icon: IconUsersGroup },
  { id: "handwriting", label: () => t("composer.handwriting"), hint: () => t("composer.handwritingHint"), icon: IconSignature },
];

function ToggleItem({ id, icon, label, hint }: { id: string; icon: ReactNode; label: string; hint: string }) {
  return (
    <AriaMenuItem
      id={id}
      textValue={label}
      className="group relative flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-control px-2.5 py-1.5 text-[14.5px] text-fg outline-none focus:bg-surface-hover pressed:bg-surface-pressed"
    >
      {({ isSelected }) => (
        <>
          <span className="grid size-4 shrink-0 place-items-center text-fg-muted group-focus:text-current">{icon}</span>
          <span className="flex min-w-0 flex-1 flex-col">
            <Text slot="label" className="truncate">
              {label}
            </Text>
            <Text slot="description" className="truncate text-[12.5px] text-fg-muted">
              {hint}
            </Text>
          </span>
          <span className={cn("grid size-4 shrink-0 place-items-center transition-opacity duration-100", isSelected ? "opacity-100" : "opacity-0")}>
            <IconCheck size={15} stroke={1.75} />
          </span>
        </>
      )}
    </AriaMenuItem>
  );
}

// Opal's own models first, with a line on what each is for. Raw provider models (nerd mode
// only) follow, grouped by provider.
function ModelSections({ models }: { models: ModelInfoView[] }) {
  const tiers = models.filter((m) => m.tier);
  const groups = models
    .filter((m) => !m.tier)
    .reduce<Record<string, ModelInfoView[]>>((acc, m) => {
      (acc[m.providerLabel] ??= []).push(m);
      return acc;
    }, {});
  return (
    <>
      {tiers.length > 0 && (
        <MenuSection>
          {tiers.map((m) => (
            <MenuItem key={m.id} id={m.id} description={m.description}>
              {m.label}
            </MenuItem>
          ))}
        </MenuSection>
      )}
      {Object.entries(groups).map(([provider, list]) => (
        <MenuSection key={provider} title={provider}>
          {list.map((m) => (
            <MenuItem key={m.id} id={m.id}>
              {m.label}
            </MenuItem>
          ))}
        </MenuSection>
      ))}
    </>
  );
}

export function PlusMenu({
  isOpen,
  onOpenChange,
  toggles,
  onToggle,
  onAddFiles,
  models,
  currentModel,
  onModelChange,
  showModels,
  modelLocked,
  disabled,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  toggles: Set<ToggleId>;
  onToggle: (id: ToggleId) => void;
  onAddFiles: () => void;
  models: ModelInfoView[];
  currentModel?: ModelInfoView;
  onModelChange: (id: string) => void;
  showModels: boolean;
  /** Auto picked this chat's model: shown, not changeable. */
  modelLocked?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  return (
    <MenuTrigger isOpen={isOpen} onOpenChange={onOpenChange}>
      <Button
        variant="ghost"
        size="xs"
        isIconOnly
        isDisabled={disabled}
        aria-label={t("composer.more")}
        className="size-8 rounded-full text-fg-muted hover:text-fg data-[pressed]:scale-[0.94]"
      >
        <IconPlus size={18} stroke={1.5} className={cn("transition-transform duration-200 ease-out", isOpen && "rotate-45")} />
      </Button>
      <Menu
        placement="top start"
        animation="scale"
        className="w-[272px]"
        shouldCloseOnSelect
        onAction={(key) => {
          if (key === "files") onAddFiles();
          if (key === "connectors") router.push("/customization/connectors");
        }}
      >
        <MenuSection>
          <MenuItem id="files" icon={<IconPaperclip size={16} stroke={1.5} />}>
            {t("composer.addFiles")}
          </MenuItem>
        </MenuSection>
        <MenuSeparator />
        <MenuSection
          selectionMode="multiple"
          selectedKeys={toggles}
          onSelectionChange={(keys) => {
            const next = keys === "all" ? new Set(TOGGLES.map((x) => x.id)) : (keys as Set<ToggleId>);
            for (const x of TOGGLES) if (next.has(x.id) !== toggles.has(x.id)) onToggle(x.id);
          }}
        >
          {TOGGLES.map((x) => (
            <ToggleItem key={x.id} id={x.id} icon={<x.icon size={16} stroke={1.5} />} label={x.label()} hint={x.hint()} />
          ))}
        </MenuSection>
        <MenuSeparator />
        <MenuSection>
          {showModels && models.length > 0 && modelLocked ? (
            <MenuItem id="model" isDisabled icon={<IconCpu size={16} stroke={1.5} />} description={currentModel?.label}>
              {t("composer.model")}
            </MenuItem>
          ) : showModels && models.length > 0 ? (
            <SubmenuTrigger>
              <MenuItem id="model" icon={<IconCpu size={16} stroke={1.5} />} description={currentModel?.label}>
                {t("composer.model")}
              </MenuItem>
              <Menu
                placement="end top"
                className="max-h-[380px] w-[264px]"
                selectionMode="single"
                selectedKeys={currentModel ? [currentModel.id] : []}
                onAction={(k) => onModelChange(String(k))}
              >
                <ModelSections models={models} />
              </Menu>
            </SubmenuTrigger>
          ) : null}
          <MenuItem id="connectors" icon={<IconPlugConnected size={16} stroke={1.5} />}>
            {t("composer.connectors")}
          </MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

export function ModelPicker({
  models,
  currentModel,
  onModelChange,
  locked,
}: {
  models: ModelInfoView[];
  currentModel?: ModelInfoView;
  onModelChange: (id: string) => void;
  locked?: boolean;
}) {
  if (locked) {
    const label = currentModel?.label ?? t("composer.model");
    return (
      <Button variant="ghost" size="xs" isDisabled aria-label={`${t("composer.model")}: ${label}`} className="h-8 rounded-full px-2.5 text-[13px] text-fg-muted">
        <span className="max-w-[200px] truncate">{label}</span>
      </Button>
    );
  }
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="xs"
        aria-label={`${t("composer.model")}: ${currentModel?.label ?? ""}`}
        className="h-8 gap-1 rounded-full px-2.5 text-[13px] text-fg-muted hover:text-fg"
        endContent={<IconChevronDown size={13} stroke={1.5} />}
      >
        <span className="max-w-[160px] truncate">{currentModel?.label ?? t("composer.model")}</span>
      </Button>
      <Menu
        placement="top start"
        animation="scale"
        className="max-h-[380px] w-[264px]"
        selectionMode="single"
        selectedKeys={currentModel ? [currentModel.id] : []}
        onAction={(k) => onModelChange(String(k))}
      >
        <ModelSections models={models} />
      </Menu>
    </MenuTrigger>
  );
}
