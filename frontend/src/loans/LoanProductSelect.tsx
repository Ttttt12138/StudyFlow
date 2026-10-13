import { useI18n } from "../i18n";
import { loanProductLabel, type LoanProduct } from "./products";
import "./products.css";

export function LoanProductSelect({ value = "custom", onChange, disabled = false }: {
  value?: LoanProduct; onChange: (product: LoanProduct) => void; disabled?: boolean;
}) {
  const { t } = useI18n();
  return <div className="loan-product-field">
    <label>{t("loanProduct.label")}<select aria-label={t("loanProduct.label")} value={value} disabled={disabled}
      onChange={e => onChange(e.target.value as LoanProduct)}>
      <option value="custom">{t("loanProduct.custom")}</option>
      <option value="commercial_student_demo">{t("loanProduct.commercial")}</option>
    </select></label>
    {value === "commercial_student_demo" && <p className="panel-muted">{t("loanProduct.hint")}</p>}
  </div>;
}

export function LoanProductNotice({ product }: { product?: LoanProduct }) {
  const { t } = useI18n();
  return product === "commercial_student_demo" ? <p className="panel-note">
    <strong>{t(loanProductLabel(product))}</strong><br />{t("loanProduct.hint")}
  </p> : null;
}
