import type { Admission, Review } from '../confirmation/types';
import type { Expense } from './types';
import { translate, type Lang } from '../i18n';

// Frontend view model. Replace mapping when C supplies a v2 extraction example.
// Labels follow `lang`; ids, amounts, dates, statuses and origin codes stay language-independent.
export function documentedExpenses(admission: Admission, review: Review, lang: Lang = 'en'): Expense[] {
 const value = (id: string) => review.corrections[id] ?? admission.fields.find(f => f.id === id)?.original ?? '';
 const original = (id: string) => admission.fields.find(f => f.id === id)?.original ?? null;
 return [
  { id: 'tuition', label: translate(lang, 'demo.expenses.tuition'), amount: value('tuition'), currency: value('tuitionCurrency'), dueDate: value('tuitionDue'), recurrence: 'once', status: 'known', origin: ['tuition', 'tuitionCurrency', 'tuitionDue'].some(id => Object.hasOwn(review.corrections, id)) ? 'student entry' : 'document extraction', sourceLabel: translate(lang, 'demo.evidence.letter.title'), originalAmount: original('tuition') },
  { id: 'fee', label: translate(lang, 'demo.expenses.fee'), amount: value('fee'), currency: value('feeCurrency'), dueDate: value('feeDue'), recurrence: 'once', status: value('fee') ? 'known' : 'missing', origin: ['fee', 'feeCurrency', 'feeDue'].some(id => Object.hasOwn(review.corrections, id)) ? 'student entry' : original('fee') ? 'document extraction' : 'demo fixture', sourceLabel: original('fee') ? translate(lang, 'demo.evidence.schedule.title') : undefined, originalAmount: original('fee') },
 ] satisfies Expense[];
}
export function newExpense(label = '', once = label === 'One-time setup'): Expense {
 return { id: crypto.randomUUID(), label, amount: '', currency: '', dueDate: '', recurrence: once ? 'once' : 'monthly', status: 'missing', missingAcknowledged: false, origin: 'student entry' };
}
export function expenseProblems(expense: Expense, lang: Lang = 'en'): string[] {
 const issues: string[] = [];
 if (!expense.label.trim()) issues.push(translate(lang, 'demo.error.label'));
 if (expense.status === 'missing' && !expense.missingAcknowledged) issues.push(translate(lang, 'demo.error.missing'));
 else if (expense.status !== 'missing' && !/^\d+(\.\d{1,2})?$/.test(expense.amount.trim())) issues.push(translate(lang, 'demo.error.amountDecimals'));
 if (expense.status !== 'missing' && !/^[A-Z]{3}$/.test(expense.currency.trim())) issues.push(translate(lang, 'demo.error.currency'));
 if (expense.recurrence === 'once' && expense.status !== 'missing') {
  const date = expense.dueDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) issues.push(translate(lang, 'demo.error.date'));
 }
 return issues;
}
