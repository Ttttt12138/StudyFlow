import { useState } from "react";
import { formatMoney } from "../backend/presenters";
import { useI18n } from "../i18n";
import type { WalletClient } from "./client";

export type TopUpResult = { id: string; currency: string; amount: string; balance: string; is_simulated: boolean };

/**
 * Adds simulated money to the student's own wallet in one currency (POST demo/wallets/top-up/). No real card or bank
 * is charged. One form opening is one idempotency key, so a double click does not top up twice.
 */
export function TopUpForm({ client, preview, currencies, currency: initialCurrency, amount: initialAmount = "", onDone, onCancel }: {
  client: WalletClient; preview: boolean; currencies: string[]; currency?: string; amount?: string;
  onDone: (result: TopUpResult) => void; onCancel?: () => void }) {
  const { t, lang } = useI18n();
  const [currency, setCurrency] = useState(initialCurrency ?? currencies[0] ?? "");
  const [amount, setAmount] = useState(initialAmount);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [key, setKey] = useState(() => `top-up:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
  const valid = /^\d+(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;
  async function submit() {
    setBusy(true); setError("");
    try {
      const result = await client.post<TopUpResult>("demo/wallets/top-up/", { currency, amount: amount.trim() }, `${key}:${currency}:${amount.trim()}`);
      setKey(`top-up:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`);
      onDone(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <form className="panel-form top-up-form" onSubmit={event => { event.preventDefault(); if (valid) void submit(); }}>
    <label>{t("topup.currency")}<select value={currency} disabled={busy} onChange={event => setCurrency(event.target.value)}>
      {currencies.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
    <label>{t("topup.amount", { currency })}<input inputMode="decimal" value={amount} disabled={busy} placeholder="1000.00"
      onChange={event => setAmount(event.target.value)} /></label>
    <small className="panel-muted" style={{ gridColumn: "1 / -1" }}>{t("topup.note")}</small>
    {error && <p className="error" role="alert" style={{ gridColumn: "1 / -1" }}>{error}</p>}
    <div className="top-up-actions" style={{ gridColumn: "1 / -1" }}>
      {onCancel && <button type="button" className="secondary" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>}
      <button type="submit" className="primary" disabled={preview || busy || !valid || !currency}>
        {busy ? t("topup.busy") : valid ? t("topup.submitAmount", { amount: formatMoney(Number(amount).toFixed(2), currency, lang) }) : t("topup.submit")}</button>
    </div>
  </form>;
}
