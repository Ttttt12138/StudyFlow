import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useToolActive } from "./context";

export function FocusDialog({ title, onClose, busy = false, children, className = "", initialFocusSelector }: {
  title: string; onClose: () => void; busy?: boolean; children: ReactNode; className?: string; initialFocusSelector?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const active = useToolActive();
  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    if (active && dialog && !dialog.open) dialog.showModal();
    if (initialFocusSelector) dialog?.querySelector<HTMLElement>(initialFocusSelector)?.focus();
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus(); };
  }, [active, initialFocusSelector]);
  return createPortal(<dialog ref={ref} className={`workspace-confirm ${className}`} aria-label={title}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    {active && children}
  </dialog>, document.body);
}
