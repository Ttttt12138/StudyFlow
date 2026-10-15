import { useI18n } from "../i18n";
import type { AssessmentInputs } from "./assessmentTypes";

type Props = { value: AssessmentInputs; onChange: (value: AssessmentInputs) => void; disabled: boolean };
export function AssessmentForm({ value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const change = (patch: Partial<AssessmentInputs["loan"]>) => onChange({ ...value, loan: { ...value.loan, ...patch } });
  return <fieldset className="assessment-form" disabled={disabled}>
    <label>{t("prequal.borrower")}<select value={value.borrower} onChange={e => onChange({ ...value, borrower: e.target.value as AssessmentInputs["borrower"] })}>
      <option value="student_with_parent">{t("prequal.borrower.student_with_parent")}</option><option value="parent">{t("prequal.borrower.parent")}</option></select></label>
    <label>{t("simple.rate")}<input type="number" min="0" max="100" step="0.01" value={Number(value.loan.annual_rate) * 100}
      onChange={e => change({ annual_rate: String(Number(e.target.value) / 100) })} /></label>
    <label>{t("simple.fees")} · THB<input type="number" min="0" step="0.01" value={value.loan.fees} onChange={e => change({ fees: e.target.value })} /></label>
    <label>{t("simple.firstDue")}<input type="date" value={value.loan.first_due_date} onChange={e => change({ first_due_date: e.target.value })} /></label>
  </fieldset>;
}
