import type { MessageKey } from "../i18n";
import { orderOutcomes, paymentOutcomes } from "./logic";
import type { OpsItem } from "./types";
import type { OperationsCommands, OpsCommand } from "./useOperationsCommands";

export type OperationOption = { label: MessageKey; command: () => OpsCommand; primary?: boolean };
export function operationOptions(item: OpsItem, commands: OperationsCommands): OperationOption[] {
  switch (item.kind) {
    case "approval": return item.record.can_decide && Date.parse(item.record.expires_at) > Date.now() ? [
      { label: "ops.approvals.approve", primary: true, command: () => commands.decideAction(item.record, "approve") },
      { label: "ops.approvals.reject", command: () => commands.decideAction(item.record, "reject") },
    ] : [];
    case "payment": return paymentOutcomes(item.record).map(outcome => ({ label: `ops.outcome.${outcome}`, primary: outcome === "settled", command: () => commands.paymentAction(item.record, outcome) }));
    case "order": return orderOutcomes(item.record).map(outcome => ({ label: `ops.outcome.${outcome}`, primary: outcome === "delivered", command: () => commands.orderAction(item.record, outcome) }));
    case "payee": return [{ label: "ops.payees.verify", primary: true, command: () => commands.verifyAction(item.record.id, item.record.name) }];
    case "loan": return item.record.status === "UNDER_REVIEW"
      ? [{ label: "ops.loans.reassess", primary: true, command: () => commands.loanDecisionAction(item.record) }]
      : [{ label: "ops.loans.disburse", primary: true, command: () => commands.disburseAction(item.record) }];
  }
}
