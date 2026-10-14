import { useEffect, useId, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { PlanBillsPay } from "./PlanBillsPay";
import { useToolActive, useWorkspace } from "../workspace/context";
import { WalletApp, type WalletTab } from "./WalletApp";

type Tab = "balances" | "convert" | "remit" | "pay" | "history";
type Records = "orders" | "ledger" | "payments";
// Exchange and transfers are opened from the balance view, so they are not tabs of their own.
const TABS: { key: Tab; label: MessageKey }[] = [
  { key: "balances", label: "wp.tab.balances" }, { key: "pay", label: "money.tab.pay" }, { key: "history", label: "wp.tab.history" },
];
/** The tab that stays highlighted: exchange and transfers belong to the balance view. */
const tabOf = (tab: Tab): Tab => tab === "convert" || tab === "remit" ? "balances" : tab;
const RECORDS: { key: Records; label: MessageKey }[] = [
  { key: "orders", label: "wp.orders" }, { key: "payments", label: "money.records.payments" }, { key: "ledger", label: "wp.ledger" },
];

/** Where a workspace link lands: ?section=convert|quote|pay|history, or the tool it used to be (payments). */
function tabFor(kind: string | undefined, section: string | undefined): Tab {
  if (kind === "payments" || section === "pay") return "pay";
  if (section === "convert") return "convert";
  if (section === "quote") return "remit";
  if (section === "history") return "history";
  return "balances";
}

/**
 * One money tool after enrollment: balances, exchange, transfers, paying bills and every record, under a single
 * row of tabs. The wallet and payments panels stay mounted underneath (drafts and quotes survive tab switches);
 * the hub owns the tabs, so neither shows its own copy of "records".
 */
export function MoneyHub({ preview, onExit }: { preview: boolean; onExit: () => void }) {
  const { t } = useI18n();
  const id = useId();
  const workspace = useWorkspace();
  const active = useToolActive();
  const target = workspace?.target;
  const [tab, setTab] = useState<Tab>(() => tabFor(target?.kind, target?.section));
  const [records, setRecords] = useState<Records>("orders");
  useEffect(() => {
    if (active && target && (target.kind === "wallet" || target.kind === "payments")) setTab(tabFor(target.kind, target.section));
  }, [active, target?.kind, target?.section]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pay tab pays the study plan's bills, and its records list what was paid.
  const paymentsShown = tab === "history" && records === "payments";
  const walletTab: WalletTab = tab === "pay" ? "balances" : tab;
  return <div className="money-hub">
    <div className="panel-bar">
      <div className="panel-steps is-segments" role="tablist" aria-label={t("money.title")}>
        {TABS.map(item => <button key={item.key} type="button" role="tab" id={`${id}-${item.key}`} aria-selected={tabOf(tab) === item.key}
          aria-controls={`${id}-body`} onClick={() => setTab(item.key)}>{t(item.label)}</button>)}
      </div>
    </div>
    {tab === "history" && <div className="money-records panel-chips" role="group" aria-label={t("wp.tab.history")}>
      {RECORDS.map(item => <button key={item.key} type="button" aria-pressed={records === item.key} onClick={() => setRecords(item.key)}>{t(item.label)}</button>)}
    </div>}
    <div className="money-body" id={`${id}-body`} role="tabpanel" aria-labelledby={`${id}-${tabOf(tab)}`}>
      <div className="money-part" hidden={tab !== "pay"}>
        <PlanBillsPay preview={preview} />
      </div>
      <div className="money-part" hidden={paymentsShown || tab === "pay"}>
        <WalletApp preview={preview} onExit={onExit} bare tab={walletTab} historyView={records === "ledger" ? "ledger" : "orders"}
          onTab={next => setTab(next)} />
      </div>
      <div className="money-part" hidden={!paymentsShown}>
        <PlanBillsPay preview={preview} mode="history" />
      </div>
    </div>
  </div>;
}
