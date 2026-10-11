import type { Admission, Evidence, Field, Scenario } from './types';
import { translate, type Lang, type MessageKey } from '../i18n';
// Frontend-only model. Replace this adapter when C provides its actual v2 schema.
// Field ids and values stay language-independent (they feed the budget input version); labels and synthetic evidence follow `lang`.
const evidence = (lang: Lang, id: 'letter' | 'schedule' | 'revised'): Evidence => ({ id, title: translate(lang, `demo.evidence.${id}.title`), location: translate(lang, `demo.evidence.${id}.location`), quote: translate(lang, `demo.evidence.${id}.quote`) });
export function loadAdmission(scenario: Scenario, lang: Lang = 'en'): Admission {
 const letter = evidence(lang, 'letter'), schedule = evidence(lang, 'schedule');
 const field = (id: string, original: string | null, required = true, kind?: Field['kind'], evidence: Evidence[] = [letter]): Field => ({ id, label: translate(lang, `demo.field.${id}` as MessageKey), original, required, kind, evidence: [...evidence], status: original === null ? 'missing' : 'known' });
 const fields = [field('institution', 'Example International University'), field('program', 'Riverside · MSc Data Science', false), field('term', 'Spring 2027'), field('tuition', '12000', true, 'amount'), field('tuitionCurrency', 'USD', true, 'currency'), field('tuitionDue', '2027-01-10', true, 'date'), field('fee', scenario === 'missing' ? null : '450', true, 'amount', scenario === 'missing' ? [] : [schedule]), field('feeCurrency', 'USD', true, 'currency', [schedule]), field('feeDue', '2027-01-10', true, 'date', [schedule])];
 if (scenario === 'conflict') { fields.find(f => f.id === 'tuition')!.evidence.push(evidence(lang, 'revised')); fields.find(f => f.id === 'tuition')!.alternatives = [{ value: '12000', source: translate(lang, 'demo.alt.letter') }, { value: '12500', source: translate(lang, 'demo.alt.revised') }]; }
 return { id: `synthetic-${scenario}`, demo: true, fields };
}
export function problem(field: Field, corrections: Record<string, string>, lang: Lang = 'en'): string | null {
 const corrected = Object.hasOwn(corrections, field.id);
 const value = (corrected ? corrections[field.id] : field.original)?.trim() ?? '';
 if (!value) return field.required ? translate(lang, 'demo.error.required') : null;
 if (field.kind === 'amount' && (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)))) return translate(lang, 'demo.error.amount');
 if (field.kind === 'currency' && !/^[A-Z]{3}$/.test(value)) return translate(lang, 'demo.error.currency');
 if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) return translate(lang, 'demo.error.date');
 if (field.alternatives && !corrected) return translate(lang, 'demo.error.conflict');
 return null;
}
