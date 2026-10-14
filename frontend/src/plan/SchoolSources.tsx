import { createContext, useContext } from "react";
import { useI18n } from "../i18n";

export type SchoolSource = { url: string; title: string; accessed: string };
export type SourceInfo = { sources?: SchoolSource[]; observed_at?: string; website?: string };

/**
 * The catalog's sources by school key (from GET planning/schools/). Cards saved before sources were added to them
 * look their school up here, so older conversations show sources too.
 */
export const SchoolSourcesContext = createContext<Record<string, SourceInfo>>({});

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** "Data sources (N) · collected on …" with each public page the sample figures were taken from. */
export function SchoolSources({ schoolKey, info, compact = false }: { schoolKey: string; info?: SourceInfo; compact?: boolean }) {
  const { t } = useI18n();
  const known = useContext(SchoolSourcesContext)[schoolKey];
  const sources = info?.sources?.length ? info.sources : known?.sources ?? [];
  const observed = info?.observed_at ?? known?.observed_at;
  if (!sources.length) return null;
  const head = t("plan.sources.title", { n: sources.length }) + (observed ? ` · ${t("plan.sources.observed", { date: observed })}` : "");
  const list = <ul className="plan-sources-list">{sources.map(source => <li key={source.url}>
    <a href={source.url} target="_blank" rel="noreferrer" title={source.url}>{source.title}</a>
    <small>{host(source.url)} · {t("plan.sources.accessed", { date: source.accessed })}</small></li>)}</ul>;
  // In a grid of schools the list folds away; on a school's own card it is shown in full.
  return compact
    ? <details className="plan-sources"><summary>{head}</summary>{list}<p className="plan-sources-note">{t("plan.sources.note")}</p></details>
    : <section className="plan-sources is-open" aria-label={t("plan.sources.title", { n: sources.length })}>
      <h4>{head}</h4>{list}<p className="plan-sources-note">{t("plan.sources.note")}</p></section>;
}
