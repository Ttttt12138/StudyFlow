import { useRef } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { formatMoney } from "../backend/presenters";
import type { WalletClient } from "../wallet/client";
import type { IssuedLink, OpsApplication, OpsApproval, OpsOrder, OpsPayment, OpsSponsorRequest } from "./types";
import { sponsorLink } from "../family/link";

export type OpsCommand = { key: string; text: string; danger?: boolean; noteFor?: string; act: () => Promise<string> };

export function useOperationsCommands(client: WalletClient, setIssued: (link: IssuedLink) => void) {
  const { t, lang } = useI18n();
  const note = useRef("");
  const money = (value: unknown, currency?: string) => formatMoney(value, currency, lang);
  const home = "THB";
  // Builders for each kind of operator action; the Django route enforces the real rules.
  const decideAction = (approval: OpsApproval, decision: "approve" | "reject"): OpsCommand => ({
    key: `decide:${approval.id}`, danger: decision === "reject",
    text: t(decision === "approve" ? "ops.confirm.approve" : "ops.confirm.reject", { amount: money(approval.amount, approval.currency), student: approval.owner_username }),
    act: async () => {
      await client.post(`approvals/${approval.id}/decide/`, { decision, note: note.current, expected_version: approval.version },
        `decide:${approval.id}:${approval.version}:${decision}`);
      return t(decision === "approve" ? "ops.notice.approved" : "ops.notice.rejected", { student: approval.owner_username });
    },
  });
  const paymentAction = (payment: OpsPayment, outcome: string): OpsCommand => ({
    key: `payment:${payment.id}`, danger: outcome === "failed",
    text: t("ops.confirm.payment", { outcome: t(`ops.outcome.${outcome}` as MessageKey), amount: money(payment.amount, payment.currency) }),
    act: async () => {
      await client.post(`payments/${payment.id}/adapter-event/`, { outcome }, `payment-event:${payment.id}:${payment.status}:${outcome}`);
      return t("ops.notice.recorded", { outcome: t(`ops.outcome.${outcome}` as MessageKey) });
    },
  });
  const orderAction = (order: OpsOrder, outcome: string): OpsCommand => ({
    key: `order:${order.id}`, danger: outcome === "failed", noteFor: order.id,
    text: t("ops.confirm.order", { outcome: t(`ops.outcome.${outcome}` as MessageKey), amount: money(order.send_amount, order.send_currency) }),
    act: async () => {
      await client.post(`remittance-orders/${order.id}/adapter-event/`, { outcome, expected_version: order.version, note: note.current },
        `order-event:${order.id}:${order.version}:${outcome}`);
      return t("ops.notice.recorded", { outcome: t(`ops.outcome.${outcome}` as MessageKey) });
    },
  });
  const verifyAction = (id: string, name: string): OpsCommand => ({
    key: `verify:${id}`, text: t("ops.confirm.verify", { name }),
    act: async () => {
      await client.post(`beneficiaries/${id}/verify/`, { verified: true }, `verify:${id}`);
      return t("ops.notice.verified", { name });
    },
  });
  const loanDecisionAction = (application: OpsApplication): OpsCommand => ({
    key: `loan:${application.id}`, noteFor: application.id,
    text: t("ops.confirm.loanDecision", { student: application.owner_username }),
    act: async () => {
      const result = await client.post<{ status: string }>(`applications/${application.id}/decision/`,
        { expected_version: application.version, reason: note.current || t("ops.loans.defaultReason") }, `loan-decision:${application.id}:${application.version}`);
      return t("ops.notice.loanDecision", { status: t(`ops.loanStatus.${result.status}` as MessageKey) });
    },
  });
  const disburseAction = (application: OpsApplication): OpsCommand => ({
    key: `loan:${application.id}`,
    text: t("ops.confirm.disburse", { amount: money(application.quote.net_proceeds, application.quote.currency), student: application.owner_username }),
    act: async () => {
      const result = await client.post<{ account: unknown }>(`applications/${application.id}/disburse/`,
        { expected_version: application.version }, `loan-disburse:${application.id}:${application.version}`);
      return t(result.account ? "ops.notice.disbursed" : "ops.notice.backToReview");
    },
  });
  const issueLinkAction = (request: OpsSponsorRequest): OpsCommand => ({
    key: `sponsor:${request.id}`, text: t("ops.confirm.issueLink", { student: request.owner_username }),
    act: async () => {
      const link = await client.post<{ token: string; expires_at: string }>(`sponsor-requests/${request.id}/issue-link/`,
        { terms_version: request.terms_version }, `issue-link:${request.id}:${request.terms_version}`);
      // Shown once to pass on; StudyFlow keeps only a digest of the token.
      setIssued({ id: request.id, url: sponsorLink(window.location.origin, link.token), expires: link.expires_at });
      return t("ops.notice.linkIssued");
    },
  });
  const receiveAction = (request: OpsSponsorRequest): OpsCommand => ({
    key: `sponsor:${request.id}`,
    text: t("ops.confirm.receive", { amount: money(request.source.amount, request.source.currency), student: request.owner_username }),
    act: async () => {
      // Foreign-currency support stays in its own currency; converting is the student's choice in the wallet.
      await client.post(`funding-sources/${request.source.id}/receive/`, { hold_in_source_currency: request.source.currency !== home },
        `receive:${request.source.id}`);
      return t("ops.notice.received", { amount: money(request.source.amount, request.source.currency) });
    },
  });

  return { decideAction, paymentAction, orderAction, verifyAction, loanDecisionAction, disburseAction,
    issueLinkAction, receiveAction, setNote: (value: string) => { note.current = value; } };
}
export type OperationsCommands = ReturnType<typeof useOperationsCommands>;
