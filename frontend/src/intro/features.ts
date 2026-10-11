import type { MessageKey } from "../i18n";

export type FeatureId = "wallet" | "remit" | "tiers" | "credit" | "agent" | "budget" | "calendar";

/** The seven product features shown on /intro and where each one opens in the app. */
export const features: readonly { id: FeatureId; href: string; color: string }[] = [
  { id: "wallet", href: "/?wallet=preview", color: "#6fe3c8" },
  { id: "remit", href: "/?wallet=preview", color: "#8fb4f2" },
  { id: "tiers", href: "/?trust=preview", color: "#f2b98a" },
  { id: "credit", href: "/?trust=preview", color: "#b7e07e" },
  { id: "agent", href: "/?agent=preview", color: "#c6a6f6" },
  { id: "budget", href: "/?journey=preview&step=budget", color: "#f3d77a" },
  { id: "calendar", href: "/?journey=preview&step=calendar", color: "#7fd0f0" },
];

export const featureKey = (id: FeatureId, field: "title" | "tags" | "body") => `intro.feature.${id}.${field}` as MessageKey;
