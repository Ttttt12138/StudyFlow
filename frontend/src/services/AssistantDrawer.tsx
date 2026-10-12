import { useEffect, useRef } from "react";
import { AgentApp } from "../agent/AgentApp";
import { useI18n } from "../i18n";

/** Floating button that opens the AI assistant over the current page. */
export function AssistantLauncher({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return <button type="button" className="assistant-launcher" onClick={onOpen}><i aria-hidden="true" />{t("assist.open")}</button>;
}

/**
 * The assistant as a side drawer: the same AgentApp as the full page, in the same preview or
 * signed-in mode, without its sidebar. Escape or the scrim closes it.
 */
export function AssistantDrawer({ preview, onClose, onFullPage }: { preview: boolean; onClose: () => void; onFullPage: () => void }) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); opener?.focus?.(); };
  }, [onClose]);
  return <>
    <div className="assistant-scrim" onClick={onClose} aria-hidden="true" />
    <div className="assistant-drawer" role="dialog" aria-modal="true" aria-labelledby="assistant-drawer-title">
      <div className="assistant-drawer-head">
        <h2 id="assistant-drawer-title"><i aria-hidden="true" />{t("assist.open")}</h2>
        <button type="button" className="secondary" onClick={onFullPage}>{t("assist.full")}</button>
        <button type="button" className="secondary" ref={closeRef} onClick={onClose} aria-label={t("assist.close")}>✕</button>
      </div>
      <div className="assistant-drawer-body"><AgentApp preview={preview} onExit={onClose} /></div>
    </div>
  </>;
}
