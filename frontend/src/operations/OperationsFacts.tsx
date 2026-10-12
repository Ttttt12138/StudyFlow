import type { ReactNode } from "react";
import { formatDate } from "../backend/presenters";
import { useOpsPresentation } from "./presenters";
import type { OpsApproval, OpsItem } from "./types";

export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="ops-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>;
}

export function OperationsFacts({ item, operatorId }: { item: OpsItem; operatorId: number }) {
  const p = useOpsPresentation();
  switch (item.kind) {
    case "approval": return <><blockquote className="ops-reason">{item.record.reason}</blockquote>
      <ApprovalTarget approval={item.record} operatorId={operatorId}/>
      <Facts rows={[[p.t("ops.w.expiry"), p.when(item.record.expires_at)]]}/>
      <p className="ops-caption">{p.t("ops.approvals.text")}</p>
      {!item.record.can_decide && item.record.blocked_reason && <p className="service-alert">{p.t(`ops.blocked.${item.record.blocked_reason}`)}</p>}</>;
    case "payment": return <Facts rows={[[p.t("ops.target.bill"), item.record.event_id], [p.t("ops.target.payee"), item.record.beneficiary_name],
      [p.t("ops.target.invoice"), item.record.invoice_snapshot.invoice_id], [p.t("ops.target.due"), formatDate(item.record.due_on, p.lang)]]}/>;
    case "order": return <Facts rows={[[p.t("ops.target.payee"), item.record.recipient === "SELF" ? p.t("ops.target.self") : item.record.beneficiary_name],
      [p.t("ops.target.purpose"), item.record.purpose.replaceAll("_", " ")], [p.t("ops.adapter.expected", { date: "" }), formatDate(item.record.expected_latest, p.lang)]]}/>;
    case "payee": return <><Facts rows={[[p.t("ops.target.payee"), item.record.name], [p.t("ops.w.subject"), item.record.destination_label]]}/><p className="ops-caption">{p.t("ops.payees.text")}</p></>;
    case "loan": return <><Facts rows={[[p.t("ops.loans.net", { amount: "" }), p.money(item.record.quote.net_proceeds, item.record.quote.currency)],
      [p.t("ops.loans.installment", { amount: "" }), p.money(item.record.quote.maximum_installment, item.record.quote.currency)],
      [p.t("ops.loans.reason"), item.record.decision_reason]]}/>
      {item.record.status === "UNDER_REVIEW" && <p className="service-alert">{p.t("ops.loans.assessment", { status: item.record.assessment.status ?? "—" })}
        {!!item.record.assessment.missing_inputs?.length && <span> · {p.t("ops.loans.missing", { items: item.record.assessment.missing_inputs.join(", ") })}</span>}</p>}</>;
    case "sponsor": return <Facts rows={[[p.t("ops.target.purpose"), item.record.purpose], [p.t("ops.sponsors.availableOn", { date: "" }), formatDate(item.record.source.available_on, p.lang)],
      [p.t("ops.sponsors.linkExpires", { time: "" }), p.when(item.record.token_expires_at)]]}/>;
  }
}

function ApprovalTarget({ approval, operatorId }: { approval: OpsApproval; operatorId: number }) {
  const p = useOpsPresentation(), target = approval.target;
  if (!target) return <p className="ops-caption">{p.t("ops.target.missing")}</p>;
  const verifier = target.payee_verified_by == null ? p.t("ops.target.notVerified")
    : target.payee_verified_by === operatorId ? p.t("ops.target.verifiedByYou") : p.t("ops.target.verifiedBy", { id: target.payee_verified_by });
  const rows: [string, ReactNode][] = target.kind === "payment" ? [
    [p.t("ops.target.bill"), target.event_id], [p.t("ops.target.payee"), target.beneficiary_name],
    [p.t("ops.target.invoice"), [target.invoice_snapshot.invoice_id, target.invoice_snapshot.issuer].filter(Boolean).join(" · ")],
    [p.t("ops.target.due"), formatDate(target.due_on, p.lang)],
  ] : [[p.t("ops.target.send"), `${p.money(target.send_amount, target.send_currency)} → ${p.money(target.receive_amount, target.receive_currency)}`],
    [p.t("ops.target.payee"), target.recipient === "SELF" ? p.t("ops.target.self") : target.beneficiary_name],
    [p.t("ops.target.purpose"), target.purpose.replaceAll("_", " ")]];
  return <Facts rows={[...rows, [p.t("ops.target.payeeCheck"), verifier], [p.t("ops.target.status"), target.status]]}/>;
}
