/** Presentation only: preserve B's decimal strings and status codes unchanged. */
export function formatAmount(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const match = /^(-?)(\d+)(\.\d+)?$/.exec(raw);
  if (!match) return raw;
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}`;
}

export function formatMoney(value: unknown, currency = "THB"): string {
  const amount = formatAmount(value);
  return amount == null ? "Amount not supplied" : `${currency} ${amount}`;
}

export function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value) return "Date not supplied";
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(parsed);
}

const label = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ").toLowerCase();

export function explainCode(code: string): string {
  const [kind, detail] = code.split(":", 2);
  const item = detail ? label(detail) : "this item";
  switch (kind) {
    case "MISSING": return `${item} needs an amount or an explicit missing status.`;
    case "MISSING_PROFILE": return `${item} is missing from the student profile.`;
    case "CONFLICT": return `Review conflicting source values for ${item}.`;
    case "RESERVE_NOT_CONFIRMED": return "Confirm the minimum reserve you want to keep.";
    case "RECEIPT_UNCONFIRMED": return `Funding from ${item} has not been confirmed as received.`;
    case "INSUFFICIENT_DATA": return "More information is needed before affordability can be assessed.";
    case "CONDITIONAL": return "This plan has conditions that still need attention.";
    case "INVALID": return "B could not validate this plan as submitted.";
    case "VALID": return "B validated this plan under its current inputs.";
    case "AFFORDABLE": return "B's assessment reports affordable repayments.";
    case "UNAFFORDABLE": return "B's assessment reports that repayments are not affordable.";
    case "UNDER_REVIEW": return "Your simulated application is under review.";
    case "DRAFT": return "Your simulated application is still a draft.";
    case "APPROVED": return "B reports this simulated application as approved. This does not mean money has arrived.";
    case "REJECTED": return "B reports this simulated application as rejected.";
    default: return label(code).replace(/^\w/, (letter) => letter.toUpperCase());
  }
}
