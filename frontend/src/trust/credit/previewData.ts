import type { CreditSnapshot, IssuedStatement, ValidStatement, Verification } from "./logic";

// Fixed synthetic records for the previews; the statement string is illustrative and is not signed by any server.
export const previewSnapshots: CreditSnapshot[] = [
  { id: "00000000-0000-4000-8000-0000000c5002", created_at: "2026-10-11T03:20:00Z", level: "FAIR", on_time: 4, late: 0, overdue: 0, as_of: "2026-10-11" },
  { id: "00000000-0000-4000-8000-0000000c5001", created_at: "2026-09-02T08:00:00Z", level: "BUILDING", on_time: 2, late: 0, overdue: 0, as_of: "2026-09-02" },
];

export const previewStatement: IssuedStatement = {
  statement: "eyJzbmFwc2hvdF9pZCI6IjAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDBjNTAwMiIsImhvbGRlciI6InByZXZpZXctc3R1ZGVudCIsImxldmVsIjoiRkFJUiJ9:1tPreview:EXAMPLE-not-a-real-signature",
  expires_in_days: 90, snapshot_id: previewSnapshots[0].id, level: "FAIR", is_simulated: true,
};

export const previewValid: ValidStatement = {
  valid: true, snapshot_id: previewSnapshots[0].id, holder: "preview-student", level: "FAIR", on_time: 4, late: 0, overdue: 0,
  as_of: "2026-10-11", issued_at: "2026-10-11T03:25:00Z", is_simulated: true,
  disclaimer: "Simulated on-time record inside StudyFlow. Not a credit score and not reported to or obtained from any credit bureau.",
};

export const previewInvalid: Verification = { valid: false, reason: "EXPIRED" };
