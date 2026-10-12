import { formatMoney } from "../backend/presenters";
import { intlLocale, useI18n, type MessageKey } from "../i18n";
import type { OpsItem } from "./types";
import { itemGroups } from "./workbench";

const actions = ["payment.submit", "remittance.submit", "wallet.convert", "loan.repay"];
export function useOpsPresentation() {
  const { t, lang } = useI18n();
  const money = (value: unknown, currency?: string) => formatMoney(value, currency, lang);
  const when = (value?: string | null) => value ? new Date(value).toLocaleString(intlLocale(lang), { dateStyle: "medium", timeStyle: "short" }) : "—";
  const actionName = (action: string) => actions.includes(action) ? t(`trust.action.${action}` as MessageKey) : action;
  const typeName = (item: OpsItem) => t(`ops.w.${["payment", "order"].includes(item.kind) ? item.kind : itemGroups[item.kind]}` as MessageKey);
  function subject(item: OpsItem) {
    switch (item.kind) {
      case "approval": return `${actionName(item.record.action)} · ${money(item.record.amount, item.record.currency)}`;
      case "payment": return `${money(item.record.amount, item.record.currency)} → ${item.record.beneficiary_name}`;
      case "order": return `${money(item.record.send_amount, item.record.send_currency)} → ${money(item.record.receive_amount, item.record.receive_currency)}`;
      case "payee": return item.record.name;
      case "loan": return `${money(item.record.quote.principal, item.record.quote.currency)} · ${t("ops.loans.months", { months: item.record.quote.months })}`;
      case "sponsor": return `${money(item.record.source.amount, item.record.source.currency)} · ${item.record.purpose}`;
    }
  }
  function status(item: OpsItem) {
    if (item.kind === "payee") return t("ops.w.payeeStatus");
    const prefix = { approval: "approval", payment: "pay.status", order: "ops.orderStatus", loan: "ops.loanStatus", sponsor: "ops.sponsorStatus" }[item.kind];
    return t(`${prefix}.${item.record.status}` as MessageKey);
  }
  return { t, lang, money, when, actionName, typeName, subject, status };
}
