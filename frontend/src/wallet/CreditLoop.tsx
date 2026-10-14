import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { formatMoney } from "../backend/presenters";
import type { WalletClient } from "./client";

export type CreditLine = { currency: string; limit: string; used: string; available: string;
  /** The fixed limit as granted (2,000 CNY); `limit` is the same in THB at the reference rate. */
  fixed?: { amount: string; currency: string }; basis_known: boolean; term_days: number; is_simulated: true };

/** What the recorded preview shows: a line of 10,500 THB with 3,000 of it in use. */
const EMPTY: CreditLine = { currency: "THB", limit: "0.00", used: "0.00", available: "0.00",
  basis_known: false, term_days: 30, is_simulated: true };
const PREVIEW: CreditLine = { currency: "THB", limit: "9090.90", used: "3000.00", available: "6090.90", fixed: { amount: "2000.00", currency: "CNY" },
  basis_known: true, term_days: 30, is_simulated: true };

// One closed band with a single twist: the left loop is the wallet, the right loop the credit line. At the crossing the
// strand rising from lower left to upper right is drawn again on top, with a background-coloured edge underneath, so
// the centre reads as one strand passing over the other.
const LEFT = "M160,70 C130,30 50,24 44,70 C50,116 130,110 160,70";
const RIGHT = "M160,70 C190,30 270,24 276,70 C270,116 190,110 160,70";
const OVER_WALLET = "M137,90 C146,86 154,79 160,70";
const OVER_CREDIT = "M160,70 C166,62 174,55 183,50";
const OVER = "M137,90 C146,86 154,79 160,70 C166,62 174,55 183,50";

/**
 * Wallet balance and credit line as one Möbius band: paying uses the wallet first and flows on into credit; repaying
 * flows back. The credit loop is drawn in proportion to what is still available.
 */
export function CreditLoop({ client, preview, walletAvailable, currency }: {
  client: WalletClient; preview: boolean; walletAvailable: string; currency: string;
}) {
  const [failed, setFailed] = useState(false);
  const { t, lang } = useI18n();
  const [line, setLine] = useState<CreditLine | null>(preview ? PREVIEW : null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (preview) return;
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("studyflow:write", refresh);
    return () => window.removeEventListener("studyflow:write", refresh);
  }, [preview]);
  useEffect(() => {
    if (preview) return;
    let alive = true;
    client.get<CreditLine>("planning/credit/").then(value => {
      if (!alive) return;
      if (value && typeof value.limit === "string") { setLine(value); setFailed(false); } else setFailed(true);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [client, preview, revision]);
  // The wallet side always shows; until the line has loaded (or if it cannot) the credit side is drawn empty.
  const shown = line ?? EMPTY;
  const money = (value: string | number, cur = shown.currency) => formatMoney(String(value), cur, lang);
  const limit = Number(shown.limit), available = Number(shown.available);
  const share = limit > 0 ? Math.max(0, Math.min(1, available / limit)) : 0;
  const sameCurrency = currency === shown.currency;
  const total = (sameCurrency ? Number(walletAvailable) : 0) + available;
  return <section className="credit-loop" aria-label={t("credit.title")}>
    <figure className="credit-loop-figure">
      <svg viewBox="0 0 320 140" role="img" aria-label={t("credit.figure", { wallet: money(walletAvailable, currency), credit: money(available) })}>
        <path d={RIGHT} className="credit-loop-track" />
        <path d={RIGHT} className="credit-loop-credit" pathLength={1} strokeDasharray={`${share} 1`} />
        <path d={LEFT} className="credit-loop-wallet" />
        <path d={OVER} className="credit-loop-gap" />
        <path d={OVER_WALLET} className="credit-loop-wallet credit-loop-over" />
        <path d={OVER_CREDIT} className={`${share > 0 ? "credit-loop-credit" : "credit-loop-track"} credit-loop-over`} />
      </svg>
      <figcaption className="credit-loop-legend">
        <span className="is-wallet"><small>{t("credit.wallet")}</small><strong>{money(walletAvailable, currency)}</strong></span>
        <span className="is-total"><small>{t("credit.total")}</small><strong>{sameCurrency ? money(total) : "—"}</strong></span>
        <span className="is-credit"><small>{t("credit.available")}</small><strong>{money(available)}</strong></span>
      </figcaption>
    </figure>
    {!line ? failed && <p className="panel-muted">{t("credit.unavailable")}</p> : <p className="panel-muted">{line.basis_known
      ? t("credit.basis", { fixed: line.fixed ? formatMoney(line.fixed.amount, line.fixed.currency, lang) : money(line.limit),
        limit: money(line.limit), used: money(line.used), days: line.term_days })
      : t("credit.noBasis")}</p>}
  </section>;
}
