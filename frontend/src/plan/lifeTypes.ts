import type { Spending, Text } from "./types";

export type LifeItem = { source_key: string; token: string; kind: "task" | "bill" | "loan" | "enrollment";
  title: string | Text; due_date: string | null; amount: string | null; currency: string; done: boolean;
  estimated: boolean; stage: "overdue" | "due" | "tomorrow" | "week" | "unknown" | "later";
  unread: boolean; snoozed: boolean; snoozed_until: string | null; source_text?: string; wallet_gap?: string | null;
  /** Checklist item seeded from the destination country's template. */
  template?: boolean;
  /** The plan estimate behind `amount`, and whether the student entered the actual amount instead. */
  catalog_amount?: string | null; amount_confirmed?: boolean;
  /** Whether the money is there when this falls due: the wallet in due-date order, or before it exists the plan forecast. */
  shortfall?: string | null; shortfall_basis?: "wallet" | "forecast" | null; at_risk?: boolean };
export type LifeBudget = Spending & { budget_known: boolean; budget_source: string; budget_version: number };
export type StudyLife = { today: string; is_simulated: boolean; in_app_only: boolean; items: LifeItem[]; upcoming: LifeItem[];
  attention_count: number; unread_count: number; budget: LifeBudget | null;
  funding: { current: boolean; as_of: string | null; end_date: string | null; gap: string | null; first_gap_date: string | null } };
