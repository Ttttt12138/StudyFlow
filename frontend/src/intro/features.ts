import type { MessageKey } from "../i18n";

export type FeatureId = "wallet" | "remit" | "tiers" | "repay" | "agent" | "budget" | "calendar";

/** The seven product features shown on /intro, in the order of the main flow, and where each one opens in the app. */
export const features: readonly { id: FeatureId; href: string; color: string }[] = [
  { id: "budget", href: "/?plan=preview", color: "#1677ff" },
  { id: "agent", href: "/?plan=preview&tool=funding", color: "#c6a6f6" },
  { id: "calendar", href: "/?plan=preview&stage=prepare&tool=life", color: "#7fd0f0" },
  { id: "wallet", href: "/?plan=preview&stage=prepare&tool=wallet", color: "#6fe3c8" },
  { id: "remit", href: "/?plan=preview&stage=prepare&tool=wallet&section=quote", color: "#8fb4f2" },
  { id: "tiers", href: "/?plan=preview&stage=prepare&tool=wallet&section=pay", color: "#f2b98a" },
  { id: "repay", href: "/?plan=preview&stage=prepare&tool=funding", color: "#b7e07e" },
];

export const featureKey = (id: FeatureId, field: "title" | "tags" | "body") => `intro.feature.${id}.${field}` as MessageKey;
