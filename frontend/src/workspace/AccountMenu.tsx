import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { User } from "@phosphor-icons/react/dist/csr/User";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";

/** Signed-in account in the top bar: the name opens a small menu with sign-out (also in the sidebar settings). */
export function AccountMenu({ account, signingOut, onSignOut }: { account: string; signingOut: boolean; onSignOut: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("keydown", key, true); document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("pointerdown", outside); };
  }, [open]);
  return <div className="workspace-account-menu" ref={root}>
    <button ref={button} type="button" className="workspace-account" aria-haspopup="menu" aria-expanded={open}
      aria-controls="workspace-account-panel" aria-label={account} title={account} onClick={() => setOpen(!open)}>
      <User className="workspace-account-icon" size={18} aria-hidden="true" />
      <span className="workspace-account-name">{account}</span><CaretDown className="workspace-account-caret" size={14} aria-hidden="true" />
    </button>
    {open && <div id="workspace-account-panel" className="workspace-account-panel" role="menu" aria-label={t("ws.account")}>
      <p className="workspace-account-who"><small>{t("ws.account")}</small><strong>{account}</strong></p>
      <button type="button" role="menuitem" className="workspace-account-item" disabled={signingOut} onClick={onSignOut}>
        <SignOut size={18} aria-hidden="true" />{t(signingOut ? "ws.signingOut" : "ws.signOut")}</button>
    </div>}
  </div>;
}
