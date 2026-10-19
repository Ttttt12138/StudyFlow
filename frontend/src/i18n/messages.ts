import * as life from "./life";
import * as assessment from "./assessment";
import * as status from "./status";
import * as workspace from "./workspace";
import * as agent from "./agent";
import * as common from "./common";
import * as auth from "./auth";
import * as intro from "./intro";
import * as operations from "./operations";
import * as payments from "./payments";
import * as shell from "./shell";
import * as loans from "./loans";
import * as panel from "./panel";
import * as walletx from "./walletx";
import * as presenters from "./presenters";
import * as trust from "./trust";
import * as wallet from "./wallet";
import * as nav from "./nav";
import * as plan from "./plan";
import * as price from "./price";
import * as loanAdvice from "./loanAdvice";
import * as legal from "./legal";

// Each feature keeps its own dictionary; the zh side is typed against en, so a missing
// translation fails `tsc`.
const en = { ...status.en, ...common.en, ...auth.en, ...presenters.en, ...wallet.en, ...agent.en, ...trust.en, ...payments.en, ...operations.en, ...shell.en, ...loans.en, ...panel.en, ...walletx.en, ...intro.en, ...nav.en, ...plan.en, ...workspace.en, ...price.en, ...assessment.en, ...life.en, ...loanAdvice.en, ...legal.en };
export type MessageKey = keyof typeof en;
const zh: Record<MessageKey, string> = { ...status.zh, ...common.zh, ...auth.zh, ...presenters.zh, ...wallet.zh, ...agent.zh, ...trust.zh, ...payments.zh, ...operations.zh, ...shell.zh, ...loans.zh, ...panel.zh, ...walletx.zh, ...intro.zh, ...nav.zh, ...plan.zh, ...workspace.zh, ...price.zh, ...assessment.zh, ...life.zh, ...loanAdvice.zh, ...legal.zh };

export const messages: Record<"en" | "zh", Record<MessageKey, string>> = { en, zh };
