import * as status from "./status";
import * as workspace from "./workspace";
import * as agent from "./agent";
import * as common from "./common";
import * as auth from "./auth";
import * as dashboard from "./dashboard";
import * as demo from "./demo";
import * as funding from "./funding";
import * as intro from "./intro";
import * as journey from "./journey";
import * as operations from "./operations";
import * as payments from "./payments";
import * as shell from "./shell";
import * as copilot from "./copilot";
import * as flow from "./flow";
import * as credit from "./credit";
import * as family from "./family";
import * as insights from "./insights";
import * as loans from "./loans";
import * as panel from "./panel";
import * as walletx from "./walletx";
import * as presenters from "./presenters";
import * as trust from "./trust";
import * as wallet from "./wallet";
import * as nav from "./nav";
import * as plan from "./plan";

// Each feature keeps its own dictionary; the zh side is typed against en, so a missing
// translation fails `tsc`.
const en = { ...status.en, ...common.en, ...auth.en, ...presenters.en, ...journey.en, ...funding.en, ...dashboard.en, ...wallet.en, ...demo.en, ...agent.en, ...trust.en, ...payments.en, ...operations.en, ...shell.en, ...copilot.en, ...flow.en,...credit.en, ...family.en, ...insights.en, ...loans.en, ...panel.en, ...walletx.en, ...intro.en, ...nav.en, ...plan.en, ...workspace.en };
export type MessageKey = keyof typeof en;
const zh: Record<MessageKey, string> = { ...status.zh, ...common.zh, ...auth.zh, ...presenters.zh, ...journey.zh, ...funding.zh, ...dashboard.zh, ...wallet.zh, ...demo.zh, ...agent.zh, ...trust.zh, ...payments.zh, ...operations.zh, ...shell.zh, ...copilot.zh, ...flow.zh,...credit.zh, ...family.zh, ...insights.zh, ...loans.zh, ...panel.zh, ...walletx.zh, ...intro.zh, ...nav.zh, ...plan.zh, ...workspace.zh };

export const messages: Record<"en" | "zh", Record<MessageKey, string>> = { en, zh };
