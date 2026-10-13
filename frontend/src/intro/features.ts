import type { MessageKey } from "../i18n";

export type FeatureId = "wallet" | "remit" | "tiers" | "credit" | "agent" | "budget" | "calendar";

/** The seven product features shown on /intro, price lookup first, and where each one opens in the app. */
export const features: readonly { id: FeatureId; href: string; color: string }[] = [
  { id: "budget", href: "/?plan=preview", color: "#1677ff" },
  { id: "agent", href: "/?plan=preview&tool=funding", color: "#c6a6f6" },
  { id: "calendar", href: "/?plan=preview&stage=school", color: "#7fd0f0" },
  { id: "wallet", href: "/?plan=preview&stage=school&tool=wallet", color: "#6fe3c8" },
  { id: "remit", href: "/?plan=preview&stage=school&tool=wallet&section=quote", color: "#8fb4f2" },
  { id: "tiers", href: "/?plan=preview&stage=school&tool=trust", color: "#f2b98a" },
  { id: "credit", href: "/?plan=preview&stage=school&tool=trust", color: "#b7e07e" },
];

export const featureKey = (id: FeatureId, field: "title" | "tags" | "body") => `intro.feature.${id}.${field}` as MessageKey;
