import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { X } from "@phosphor-icons/react/dist/csr/X";
import type { WalletClient } from "../wallet/client";
import { useOpsPresentation } from "./presenters";
import { OperationsFacts } from "./OperationsFacts";
import { useOperationsCommands, type OpsCommand } from "./useOperationsCommands";
import { operationOptions } from "./operationOptions";
import type { IssuedLink, OpsItem } from "./types";

type Props = { item: OpsItem; operatorId: number; client: WalletClient; locked: boolean; busy: boolean;
  notice: string; error: string; refreshError: string; issued: IssuedLink | null; setIssued: (link: IssuedLink) => void;
  onClose: () => void; onRun: (command: OpsCommand) => Promise<void>; onRetry: () => void };

export function OperationsDetail(props: Props) {
  const p = useOpsPresentation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<OpsCommand | null>(null);
  const [note, setNote] = useState("");
  const commands = useOperationsCommands(props.client, props.setIssued);
  const version = JSON.stringify(props.item.record);
  useEffect(() => { setPending(null); }, [version, props.locked]);
  useEffect(() => {
    const element = dialog.current!, opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal(); element.querySelector<HTMLElement>("h2")?.focus();
    return () => { element.close(); document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus(); else document.getElementById("ops-page-title")?.focus(); };
  }, []);
  const changeNote = (value: string) => { setNote(value); commands.setNote(value); };
  const options = operationOptions(props.item, commands);
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select:not(:disabled),[tabindex="0"]'));
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (!controls.length || event.shiftKey && index <= 0 || !event.shiftKey && index === controls.length - 1) {
      event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  };
  return <dialog ref={dialog} className="ops-detail" aria-labelledby="ops-detail-title" onKeyDown={trapFocus} onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <div className="ops-detail-head"><h2 id="ops-detail-title" tabIndex={-1}>{p.t("ops.w.detail")}</h2>
      <button className="ops-icon" aria-label={p.t("ops.w.close")} disabled={props.busy} onClick={props.onClose}><X size={20}/></button></div>
    <div className="ops-detail-body">
      <div className="ops-detail-meta"><span>{p.typeName(props.item)}</span><span>{p.status(props.item)}</span></div>
      <h3>{p.subject(props.item)}</h3><p className="ops-caption">{props.item.record.owner_username} · {p.when(props.item.queued_at)}</p>
      {props.notice && <p className="ops-notice" role="status">{props.notice}</p>}
      {props.error && <p className="ops-error" role="alert">{props.error}</p>}
      {props.refreshError && <div className="ops-error" role="alert">{props.refreshError} <button className="ops-view" disabled={props.busy} onClick={props.onRetry}>{p.t("ops.w.retry")}</button></div>}
      <OperationsFacts item={props.item} operatorId={props.operatorId}/>
      {props.issued?.id === props.item.record.id && <SponsorLink link={props.issued}/>}
      {props.item.kind === "approval" && props.item.record.can_decide && <label className="service-field">{p.t("ops.approvals.note")}
        <input value={note} disabled={props.locked || props.busy} maxLength={500} onChange={event => changeNote(event.target.value)} placeholder={p.t("ops.approvals.notePlaceholder")}/></label>}
    </div>
    <div className="ops-detail-actions">
      {pending ? <div className="ops-confirm" role="group" aria-label={p.t("ops.confirm.label")}><p>{pending.text}</p>
        {pending.noteFor && <label className="service-field">{p.t(props.item.kind === "loan" ? "ops.loans.reason" : "ops.adapter.note")}
          <input value={note} maxLength={500} disabled={props.busy || props.locked} onChange={event => changeNote(event.target.value)}/></label>}
        <div className="service-actions"><button className={pending.danger ? "secondary danger" : "primary"} disabled={props.locked || props.busy}
          onClick={() => { const command = pending; setPending(null); void props.onRun(command); }}>{p.t("ops.confirm.yes")}</button>
          <button className="secondary" disabled={props.busy} onClick={() => setPending(null)}>{p.t("ops.confirm.no")}</button></div>
      </div> : <div className="service-actions">{options.map(option => <button key={option.label} className={option.primary ? "primary" : "secondary"}
        disabled={props.locked || props.busy} onClick={() => setPending(option.command())}>{p.t(option.label)}</button>)}</div>}
    </div>
  </dialog>;
}

function SponsorLink({ link }: { link: IssuedLink }) {
  const { t, when } = useOpsPresentation();
  const [message, setMessage] = useState("");
  const copy = async () => {
    try { await navigator.clipboard.writeText(link.url); setMessage(t("ops.w.copied")); }
    catch { setMessage(t("ops.w.copyFailed")); }
  };
  return <div className="ops-link-box"><p>{t("ops.sponsors.linkReady", { time: when(link.expires) })}</p>
    <input className="ops-link" readOnly value={link.url} aria-label={t("ops.sponsors.link")} onFocus={event => event.currentTarget.select()}/>
    <button className="ops-view" onClick={() => void copy()}>{t("ops.sponsors.copy")}</button>{message && <p role="status">{message}</p>}
  </div>;
}
