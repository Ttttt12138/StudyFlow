import type { Admission, Evidence, Field, Scenario } from './types';
// Frontend-only model. Replace this adapter when C provides its actual v2 schema.
const letter: Evidence = { id: 'letter', title: 'Synthetic admission letter', location: 'Page 1 · Offer details', quote: 'Example International University, Riverside campus. MSc Data Science, Spring 2027. Tuition: USD 12,000, due 2027-01-10.' };
const schedule: Evidence = { id: 'schedule', title: 'Synthetic fee schedule', location: 'Page 2 · Required fees', quote: 'Spring 2027 student services fee: USD 450, due 2027-01-10.' };
export function loadAdmission(scenario: Scenario): Admission {
 const field = (id: string, label: string, original: string | null, required = true, kind?: Field['kind'], evidence: Evidence[] = [letter]): Field => ({ id, label, original, required, kind, evidence: [...evidence], status: original === null ? 'missing' : 'known' });
 const fields = [field('institution', 'Institution', 'Example International University'), field('program', 'Campus / program', 'Riverside · MSc Data Science', false), field('term', 'Academic term', 'Spring 2027'), field('tuition', 'Tuition amount', '12000', true, 'amount'), field('tuitionCurrency', 'Tuition currency', 'USD', true, 'currency'), field('tuitionDue', 'Tuition due date', '2027-01-10', true, 'date'), field('fee', 'Student services fee amount', scenario === 'missing' ? null : '450', true, 'amount', scenario === 'missing' ? [] : [schedule]), field('feeCurrency', 'Fee currency', 'USD', true, 'currency', [schedule]), field('feeDue', 'Fee due date', '2027-01-10', true, 'date', [schedule])];
 if (scenario === 'conflict') { fields.find(f => f.id === 'tuition')!.evidence.push({ id: 'revised', title: 'Synthetic revised invoice', location: 'Page 1 · Tuition', quote: 'Spring 2027 tuition: USD 12,500, due 2027-01-10. This synthetic invoice conflicts with the admission letter.' }); fields.find(f => f.id === 'tuition')!.alternatives = [{ value: '12000', source: 'Admission letter · page 1' }, { value: '12500', source: 'Synthetic revised invoice · page 1' }]; }
 return { id: `synthetic-${scenario}`, demo: true, fields };
}
export function problem(field: Field, corrections: Record<string, string>): string | null {
 const corrected = Object.hasOwn(corrections, field.id);
 const value = (corrected ? corrections[field.id] : field.original)?.trim() ?? '';
 if (!value) return field.required ? 'Required information is missing.' : null;
 if (field.kind === 'amount' && (!/^\d+(\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value)))) return 'Enter a valid non-negative amount.';
 if (field.kind === 'currency' && !/^[A-Z]{3}$/.test(value)) return 'Use a three-letter uppercase currency code.';
 if (field.kind === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)) return 'Enter a valid due date.';
 if (field.alternatives && !corrected) return 'Conflicting sources: enter the value you have verified.';
 return null;
}
