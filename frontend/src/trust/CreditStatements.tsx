import { useToolRefresh } from "../workspace/context";
import { useCallback, useEffect, useRef, useState } from "react";
import { getAll } from "../backend/client";
import { formatDate } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { WalletApiError, type WalletClient } from "../wallet/client";
import { PanelSheet } from "../workspace/ToolPanel";
import { isLevel, newSnapshots, type CreditSnapshot, type IssuedStatement } from "./credit/logic";
import { previewSnapshots, previewStatement } from "./credit/previewData";
import "./credit/credit.css";

const lost = (reason: unknown) => reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500);

/**
 * Snapshots of the on-time record and signed statements a student can hand to a landlord or school.
 * Stays mounted while the trust panel is open so an issued statement survives closing the sheet;
 * it renders only while `open`.
 */
export function CreditStatements({ client, preview, open, onClose }: { client: WalletClient; preview: boolean; open: boolean; onClose: () => void }) {
  const { lang, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const message = useCallback((reason: unknown) => reason instanceof Error ? reason.message : tRef.current("shell.err.generic"), []);
  const [snapshots, setSnapshots] = useState<CreditSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The statement stays in memory only; it is never written to storage or the URL.
  const [issued, setIssued] = useState<IssuedStatement | null>(null);
  const [copied, setCopied] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // Each new snapshot/statement gets its own retry identity; a retry after a lost response reuses it.
  const round = useRef(0);

  const level = (value: string) => isLevel(value) ? t(`trust.level.${value}` as MessageKey) : value;
  const stamp = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });

  const load = useCallback(async () => {
    if (preview) return null;
    try {
      const rows = await getAll<CreditSnapshot>(client, "credit/snapshots/");
      setSnapshots(rows); setListError(""); setSignedOut(false);
      return rows;
    } catch (reason) {
      if (reason instanceof WalletApiError && [401, 403].includes(reason.status)) setSignedOut(true);
      else setListError(message(reason));
      return null;
    } finally { setLoaded(true); }
  }, [client, preview, message]);

  useEffect(() => {
    setIssued(preview ? previewStatement : null); setError(""); setNotice(""); setCopied("");
    if (preview) { setSnapshots(previewSnapshots); setLoaded(true); setListError(""); setSignedOut(false); return; }
    void load();
  }, [preview, load]);

  const stale = useToolRefresh(async () => {
    if (!preview && await load() === null) throw new Error("Snapshot refresh failed");
  });

  async function snapshot() {
    if (preview) return;
    const before = snapshots;
    setBusy(true); setError(""); setNotice("");
    try {
      const created = await client.post<CreditSnapshot>("credit/snapshots/", {}, `credit-snapshot:${round.current}`);
      round.current += 1;
      setSnapshots((prior) => [created, ...prior.filter((item) => item.id !== created.id)]);
      setNotice(t("credit.notice.snapshot", { level: level(created.level) }));
    } catch (reason) {
      if (lost(reason)) {
        const after = await load();
        if (after && newSnapshots(before, after).length) { round.current += 1; setNotice(t("credit.notice.recovered")); }
        else setError(t("shell.err.lost"));
      } else setError(message(reason));
    } finally { setBusy(false); }
  }

  async function issue(item: CreditSnapshot) {
    if (preview) return;
    setBusy(true); setError(""); setNotice(""); setCopied("");
    try {
      const result = await client.post<IssuedStatement>("credit/statements/", { snapshot_id: item.id }, `credit-statement:${item.id}:${round.current}`);
      round.current += 1;
      setIssued(result);
      setNotice(t("credit.notice.issued", { days: result.expires_in_days }));
    } catch (reason) {
      if (reason instanceof WalletApiError && reason.status === 409) { await load(); setError(t("shell.err.changed")); }
      else setError(lost(reason) ? t("shell.err.lost") : message(reason));
    } finally { setBusy(false); }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.statement);
      setCopied(t("credit.copy.done"));
    } catch {
      if (!area.current?.getClientRects().length) return;
      area.current.focus(); area.current.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      setCopied(ok ? t("credit.copy.done") : t("credit.copy.manual"));
    }
  }

  if (signedOut || !open) return null;
  return (
    <PanelSheet title={t("credit.share.title")} onClose={onClose}
      footer={<button className={issued ? "secondary" : "primary"} disabled={preview || busy} onClick={() => void snapshot()}>{t("credit.snapshot.take")}</button>}>
      <div className="panel-sheet-stack credit-statement" id="trust-statements">
        {stale}
        <p className="panel-muted">{t("credit.share.text")}</p>
        {error && <p className="panel-note is-warn" role="alert">{error}</p>}
        {notice && <p className="panel-note" role="status">{notice}</p>}
        {issued && <div className="credit-issued">
          <h4>{t("credit.statement.title")}</h4>
          <p className="panel-muted">{t("credit.statement.text", { level: level(issued.level), days: issued.expires_in_days })}</p>
          <label htmlFor="credit-statement-text">{t("credit.statement.field")}</label>
          <textarea id="credit-statement-text" ref={area} readOnly value={issued.statement} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          <div className="panel-row">
            <a className="panel-link" href={preview ? "/?verify=preview" : "/?verify=1"}>{t("credit.verify.link")}</a>
            <button className="primary" onClick={() => void copy()}>{t("credit.copy")}</button>
          </div>
          {copied && <p className="panel-note" role="status">{copied}</p>}
        </div>}
        <h4 className="panel-section-title">{t("credit.snapshots.title")}</h4>
        {listError ? <p className="panel-note is-warn" role="alert">{listError}</p> : !loaded ? <p className="panel-muted">{t("common.loading")}</p>
          : snapshots.length === 0 ? <p className="panel-muted">{t("credit.snapshots.none")}</p>
          : <ul className="panel-rows credit-snapshots" aria-label={t("credit.snapshots.title")}>{snapshots.map((item) => <li key={item.id}>
            <span><strong>{level(item.level)} · {formatDate(item.as_of, lang)}</strong>
              <small>{t("credit.counts", { onTime: item.on_time, late: item.late, overdue: item.overdue })} · {t("credit.col.taken", { time: stamp(item.created_at) })}</small></span>
            <button className="secondary" disabled={preview || busy} aria-label={t("credit.issue.for", { date: formatDate(item.as_of, lang) })}
              onClick={() => void issue(item)}>{t("credit.issue")}</button>
          </li>)}</ul>}
        <h4 className="panel-section-title">{t("credit.reveals.title")}</h4>
        <ul className="credit-reveals panel-muted">
          <li>{t("credit.reveals.fields")}</li>
          <li>{t("credit.reveals.not")}</li>
          <li>{t("credit.reveals.expiry")}</li>
        </ul>
        <p className="panel-muted">{t("credit.disclaimer")}</p>
      </div>
    </PanelSheet>
  );
}
