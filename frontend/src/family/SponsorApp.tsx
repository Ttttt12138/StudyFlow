import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ServiceShell, ServiceSection } from "../services/ServiceShell";
import { formatDate, formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import { WalletApiError } from "../wallet/client";
import { sponsorClient } from "./client";
import { extractToken } from "./logic";
import { sponsorPreviewClient } from "./previewAdapter";
import type { SponsorDecision, SponsorPreview, SponsorResult } from "./types";
import "../wallet/wallet.css";
import "./family.css";

const CODES = ["INVALID_SPONSOR_TOKEN", "SPONSOR_TOKEN_EXPIRED", "SPONSOR_TOKEN_REVOKED", "SPONSOR_TOKEN_USED", "SPONSOR_TERMS_CHANGED", "IDEMPOTENCY_KEY_REQUIRED"];
const hashToken = () => extractToken(window.location.hash);

/** Anonymous page where a family member answers a support request through the link an operator sent. */
export function SponsorApp({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { lang, t } = useI18n();
  const api = useMemo(() => preview ? sponsorPreviewClient : sponsorClient, [preview]);
  // The token lives only in React state: never in storage, and it is removed from the address bar on load.
  const [token, setToken] = useState<string | null>(() => preview ? null : hashToken());
  const [pasted, setPasted] = useState("");
  const [request, setRequest] = useState<SponsorPreview | null>(null);
  const [result, setResult] = useState<SponsorResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<SponsorDecision | "">("");
  const [check, setCheck] = useState(false);
  const keys = useRef(new Map<string, string>());

  const when = (value: string) => new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" });
  const explain = useCallback((reason: unknown) => {
    if (reason instanceof WalletApiError) {
      if (reason.status === 429 || reason.code === "throttled") return t("family.sponsor.err.throttled");
      if (CODES.includes(reason.code)) return t(`family.sponsor.err.${reason.code}` as MessageKey);
      if (reason.status === 0) return t("family.sponsor.err.network");
    }
    return reason instanceof Error ? reason.message : t("shell.err.generic");
  }, [t]);

  useEffect(() => {
    if (preview) return;
    const strip = () => {
      const found = hashToken();
      if (/token=/.test(window.location.hash)) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      if (found) { setToken(found); setResult(null); }
    };
    strip();
    window.addEventListener("hashchange", strip);
    return () => window.removeEventListener("hashchange", strip);
  }, [preview]);

  const load = useCallback(async () => {
    if (!preview && !token) return;
    setLoading(true); setError(""); setRequest(null);
    try { setRequest(await api.preview(token ?? "")); }
    catch (reason) { setError(explain(reason)); }
    finally { setLoading(false); }
  }, [api, explain, preview, token]);

  useEffect(() => { void load(); }, [load]);

  function open() {
    const found = extractToken(pasted);
    if (!found) { setError(t("family.sponsor.err.paste")); return; }
    setPasted(""); setResult(null); setChoice(""); setCheck(false);
    if (found === token) void load(); else setToken(found);
  }

  async function decide() {
    if (preview || !token || !request || !choice) return;
    const body = { terms_version: request.terms_version, decision: choice };
    // The same answer to the same terms reuses its key, so a retry after a lost response cannot record twice.
    const identity = `${request.request_id}:${request.terms_version}:${choice}`;
    const key = keys.current.get(identity) ?? crypto.randomUUID();
    keys.current.set(identity, key);
    setBusy(true); setError("");
    try {
      setResult(await api.decide(token, body, key));
      setRequest(null); setChoice(""); setCheck(false);
    } catch (reason) {
      if (reason instanceof WalletApiError && (reason.status === 0 || reason.status >= 500)) setError(t("family.sponsor.err.lost"));
      else setError(explain(reason));
    } finally { setBusy(false); }
  }

  const sections = [{ id: "sponsor-request", label: t("family.sponsor.request.title") }, { id: "sponsor-link", label: t("family.sponsor.link.title") }];

  return (
    <ServiceShell className="family-app sponsor-app" eyebrow={t("family.sponsor.eyebrow")} title={t("family.sponsor.title")} intro={t("family.sponsor.intro")}
      sideLabel={t("family.sponsor.side.label")} sections={sections} noteTitle={t("family.sponsor.side.noteTitle")} noteText={t("family.sponsor.side.noteText")}
      preview={preview} previewTitle={t("family.preview.title")} previewText={t("family.sponsor.preview.text")} bannerText={t("family.sponsor.banner.text")}
      signedOut={false} signInUrl="/" signedOutText="" onExit={onExit} publicPage onRefresh={token && !result ? () => void load() : undefined} refreshing={loading || busy}>
      {loading && <div className="activity" role="status"><span className="activity-dot" aria-hidden="true" />{t("common.loading")}</div>}
      {error && <div className="stale-banner" role="alert">{error}</div>}

      <ServiceSection id="sponsor-request" title={t("family.sponsor.request.title")} text={t("family.sponsor.request.text")}>
        {result ? <p className="service-notice" role="status">{t(result.status === "CONFIRMED" ? "family.sponsor.done.CONFIRMED" : "family.sponsor.done.REJECTED")}</p>
          : !request ? <p>{token || preview ? (loading ? t("common.loading") : t("family.sponsor.request.unavailable")) : t("family.sponsor.request.noLink")}</p> : <>
          <dl className="comparison-facts">
            <div><dt>{t("family.req.amount")}</dt><dd>{formatMoney(request.amount, request.currency, lang)}</dd></div>
            <div><dt>{t("family.req.availableOn")}</dt><dd>{formatDate(request.available_on, lang)}</dd></div>
            <div><dt>{t("family.sponsor.purpose")}</dt><dd>{request.purpose}</dd></div>
            <div><dt>{t("family.sponsor.expires")}</dt><dd>{when(request.expires_at)}</dd></div>
          </dl>
          <div className="service-policy">
            <h3>{t("family.sponsor.means.title")}</h3>
            <ul className="family-how">
              <li>{t("family.sponsor.means.simulated")}</li><li>{t("family.sponsor.means.confirm")}</li>
              <li>{t("family.sponsor.means.reject")}</li><li>{t("family.sponsor.means.once")}</li>
            </ul>
          </div>
          {!choice ? <div className="service-actions">
            <button className="primary" disabled={preview || busy} onClick={() => { setChoice("confirm"); setCheck(false); }}>{t("family.sponsor.confirm")}</button>
            <button className="secondary" disabled={preview || busy} onClick={() => { setChoice("reject"); setCheck(false); }}>{t("family.sponsor.reject")}</button>
          </div> : <div className="service-policy" role="group" aria-label={t("family.sponsor.step.label")}>
            <p>{t(choice === "confirm" ? "family.sponsor.step.confirm" : "family.sponsor.step.reject",
              { amount: formatMoney(request.amount, request.currency, lang), date: formatDate(request.available_on, lang) })}</p>
            <label className="wallet-confirm"><input type="checkbox" checked={check} onChange={(e) => setCheck(e.target.checked)} />
              {t(choice === "confirm" ? "family.sponsor.check.confirm" : "family.sponsor.check.reject")}</label>
            <div className="service-actions">
              <button className="primary" disabled={preview || busy || !check} onClick={() => void decide()}>
                {t(choice === "confirm" ? "family.sponsor.send.confirm" : "family.sponsor.send.reject")}</button>
              <button className="secondary" disabled={busy} onClick={() => { setChoice(""); setCheck(false); }}>{t("family.sponsor.back")}</button>
            </div>
          </div>}
        </>}
      </ServiceSection>

      <ServiceSection id="sponsor-link" title={t("family.sponsor.link.title")} text={t("family.sponsor.link.text")}>
        <form className="wallet-form-row family-paste" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <label>{t("family.sponsor.link.field")}<input value={pasted} autoComplete="off" spellCheck={false} disabled={preview} onChange={(e) => setPasted(e.target.value)} /></label>
          <button type="submit" className="secondary" disabled={preview || !pasted.trim()}>{t("family.sponsor.link.open")}</button>
        </form>
      </ServiceSection>
    </ServiceShell>
  );
}
