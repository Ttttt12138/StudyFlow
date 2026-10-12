export type CreditLevel = "BUILDING" | "FAIR" | "GOOD" | "AT_RISK";
export const LEVELS: readonly CreditLevel[] = ["BUILDING", "FAIR", "GOOD", "AT_RISK"];
export const REASONS = ["INVALID_SIGNATURE", "EXPIRED", "SNAPSHOT_MISMATCH"] as const;
export type InvalidReason = (typeof REASONS)[number];
/** The backend rejects anything longer as INVALID_SIGNATURE without decoding it. */
export const STATEMENT_MAX = 4000;
export const STATEMENT_DAYS = 90;

export interface CreditSnapshot {
  id: string; created_at: string; level: string; on_time: number; late: number; overdue: number; as_of: string;
  limit_multiplier?: string; disclaimer?: string;
}
export interface IssuedStatement { statement: string; expires_in_days: number; snapshot_id: string; level: string; is_simulated: boolean }
export interface ValidStatement {
  valid: true; snapshot_id: string; holder: string; level: string; on_time: number; late: number; overdue: number;
  as_of: string; issued_at: string; is_simulated: boolean; disclaimer: string;
}
export type Verification = ValidStatement | { valid: false; reason: string };

/** Signed statements never contain whitespace, so line breaks and spaces added by email or chat are dropped. */
export function cleanStatement(raw: string): string {
  return raw.replace(/\s+/g, "");
}

export function statementProblem(statement: string): "empty" | "tooLong" | null {
  if (!statement) return "empty";
  return statement.length > STATEMENT_MAX ? "tooLong" : null;
}

export function reasonKey(reason: string): InvalidReason | "UNKNOWN" {
  return (REASONS as readonly string[]).includes(reason) ? reason as InvalidReason : "UNKNOWN";
}

export function isLevel(level: string): level is CreditLevel {
  return (LEVELS as readonly string[]).includes(level);
}

/** When a statement issued at `issuedAt` stops verifying; null when the timestamp is unreadable. */
export function expiresAt(issuedAt: string, days = STATEMENT_DAYS): Date | null {
  const start = Date.parse(issuedAt);
  return Number.isNaN(start) ? null : new Date(start + days * 86_400_000);
}

/** Snapshots the student did not have before a create whose response was lost. */
export function newSnapshots(before: CreditSnapshot[], after: CreditSnapshot[]): CreditSnapshot[] {
  const known = new Set(before.map((item) => item.id));
  return after.filter((item) => !known.has(item.id));
}
