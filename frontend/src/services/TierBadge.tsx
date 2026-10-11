import { useI18n } from "../i18n";
import "./services.css";

export type Tier = "T0" | "T1" | "T2" | "T3";
const TIERS: Tier[] = ["T0", "T1", "T2", "T3"];

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as string[]).includes(value);
}

/** Permission tier from docs/permissions.md: T0 read, T1 reversible write, T2 step-up, T3 approval. */
export function TierBadge({ tier, withLabel = false }: { tier: Tier; withLabel?: boolean }) {
  const { t } = useI18n();
  const name = t(`tier.${tier}.name` as const);
  return (
    <span className={`tier-badge tier-${tier.toLowerCase()}`} title={`${tier} · ${name} — ${t(`tier.${tier}.needs` as const)}`}>
      <strong>{tier}</strong>
      {withLabel && <span>{name}</span>}
    </span>
  );
}

/** The four tiers with what each requires; shown on the agent and trust screens. */
export function TierLegend({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ul className={`tier-legend${compact ? " compact" : ""}`} aria-label={t("tier.legend")}>
      {TIERS.map((tier) => (
        <li key={tier}>
          <TierBadge tier={tier} />
          <div>
            <strong>{t(`tier.${tier}.name` as const)}</strong>
            {!compact && <span>{t(`tier.${tier}.scope` as const)}</span>}
            <small>{t(`tier.${tier}.needs` as const)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
