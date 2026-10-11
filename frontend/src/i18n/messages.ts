import * as agent from "./agent";
import * as common from "./common";
import * as dashboard from "./dashboard";
import * as demo from "./demo";
import * as funding from "./funding";
import * as intro from "./intro";
import * as journey from "./journey";
import * as presenters from "./presenters";
import * as trust from "./trust";
import * as wallet from "./wallet";

// Each feature keeps its own dictionary; the zh side is typed against en, so a missing
// translation fails `tsc`.
const en = { ...common.en, ...presenters.en, ...journey.en, ...funding.en, ...dashboard.en, ...wallet.en, ...demo.en, ...agent.en, ...trust.en, ...intro.en };
export type MessageKey = keyof typeof en;
const zh: Record<MessageKey, string> = { ...common.zh, ...presenters.zh, ...journey.zh, ...funding.zh, ...dashboard.zh, ...wallet.zh, ...demo.zh, ...agent.zh, ...trust.zh, ...intro.zh };

export const messages: Record<"en" | "zh", Record<MessageKey, string>> = { en, zh };
