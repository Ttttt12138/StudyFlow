import { formatMoney } from "../backend/presenters";
import { useI18n } from "../i18n";
import type { ExecQuote } from "./extras/logic";

export function ConversionQuotePicker({ quotes, selected, onSelect, disabled }: {
  quotes: ExecQuote[]; selected: string; onSelect: (id: string) => void; disabled: boolean;
}) {
  const { t, lang } = useI18n();
  return <label className="fx-quote-picker">{t("walletx.review.quote")}
    <select aria-label={t("walletx.review.quote")} value={selected} disabled={disabled} onChange={event => onSelect(event.target.value)}>
      {quotes.map(quote => <option key={quote.id} value={quote.id}>
        {quote.route_name} · {formatMoney(quote.net_received, quote.target_currency, lang)}
      </option>)}
    </select>
  </label>;
}
