import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Scales } from "@phosphor-icons/react/dist/csr/Scales";
import { useI18n } from "../i18n";
import { useWorkspace } from "../workspace/context";
import { PanelEmpty, ToolPanel } from "../workspace/ToolPanel";
import { convertAmount, useDisplay, useShow } from "./currency";
import { pick } from "./format";
import type { Card } from "./types";

type Row = { card: Card; id: string };

/** Every total and comparison asked in this conversation, newest first; each opens its full result. */
export function CompareHistory({ rows }: { rows: Row[] }) {
  const { lang, t } = useI18n();
  const show = useShow();
  const { rates } = useDisplay();
  const workspace = useWorkspace();
  const priced = rows.filter(row => row.card.type === "cost" || row.card.type === "comparison").reverse();
  return <ToolPanel label={t("side.compare")}>
    {priced.length === 0 ? <PanelEmpty icon={Scales} title={t("price.historyEmpty")} text={t("price.historyHint")} /> :
      <ul className="price-history">{priced.map(({ card, id }) => {
        let title = "", figure = "", detail = "";
        if (card.type === "cost") {
          title = t("price.totalOf", { name: pick(card.school.name, lang), years: card.estimate.years });
          figure = show(card.estimate.total, card.estimate.currency, lang).main;
        } else if (card.type === "comparison") {
          title = card.schools.map(s => pick(s.name, lang)).join(" / ");
          const totals = card.schools.map(s => ({ s, base: convertAmount(s.total ?? s.first_year_total, s.currency, "THB", rates) }))
            .filter(x => x.base !== null).sort((a, b) => a.base! - b.base!);
          if (totals[0]) {
            const best = totals[0].s;
            figure = show(best.total ?? best.first_year_total, best.currency, lang).main;
            detail = t("price.historyBest", { name: pick(best.name, lang) });
          }
        }
        return <li key={id}><button type="button" onClick={() => workspace?.open({ kind: "card", cardId: id, parent: "compare" })}>
          <span><strong>{title}</strong>{detail && <small>{detail}</small>}</span>
          <span className="price-history-figure">{figure}<ArrowRight size={14} aria-hidden="true" /></span>
        </button></li>;
      })}</ul>}
  </ToolPanel>;
}
