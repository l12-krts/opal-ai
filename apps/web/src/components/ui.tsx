"use client";
// Small wrappers so buttons default to compact sizes everywhere.
import { forwardRef } from "react";
import { AlertDialog, Button, Modal, WithTooltip, cn, type AlertDialogProps, type ButtonProps } from "krts.ui";

export const SmallButton = forwardRef<HTMLButtonElement, ButtonProps>(function SmallButton({ size = "sm", ...props }, ref) {
  return <Button ref={ref} size={size} {...props} />;
});

export function IconButton({
  label,
  children,
  className,
  shortcut,
  tooltip = true,
  ...props
}: Omit<ButtonProps, "isIconOnly" | "aria-label"> & { label: string; shortcut?: string; tooltip?: boolean }) {
  const btn = (
    <Button
      variant="ghost"
      size="xs"
      isIconOnly
      aria-label={label}
      className={cn("text-fg-muted hover:text-fg", className as string)}
      {...props}
    >
      {children}
    </Button>
  );
  return tooltip ? (
    <WithTooltip content={label} shortcut={shortcut} delay={500}>
      {btn}
    </WithTooltip>
  ) : (
    btn
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[20px] font-medium">{title}</h1>
        {description && <p className="mt-1 max-w-[60ch] text-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[12px] border border-dashed border-line px-5 py-6">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-[56ch] text-[13px] text-fg-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Confirmation dialog: krts.ui AlertDialog inside a Modal. */
export function Confirm({ isOpen, onOpenChange, ...props }: AlertDialogProps & { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <AlertDialog {...props} />
    </Modal>
  );
}
