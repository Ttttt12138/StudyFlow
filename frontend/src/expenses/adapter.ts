import type { Admission, Review } from '../confirmation/types';
import type { Expense } from './types';

// Frontend view model. Replace mapping when C supplies a v2 extraction example.
export function documentedExpenses(admission: Admission, review: Review): Expense[] {
 const value = (id: string) => review.corrections[id] ?? admission.fields.find(f => f.id === id)?.original ?? '';
 const original = (id: string) => admission.fields.find(f => f.id === id)?.original ?? null;
 return [
  { id: 'tuition', label: 'Tuition', amount: value('tuition'), currency: value('tuitionCurrency'), dueDate: value('tuitionDue'), recurrence: 'once', status: 'known', origin: ['tuition', 'tuitionCurrency', 'tuitionDue'].some(id => Object.hasOwn(review.corrections, id)) ? 'student entry' : 'document extraction', sourceLabel: 'Synthetic admission letter', originalAmount: original('tuition') },
  { id: 'fee', label: 'Student services fee', amount: value('fee'), currency: value('feeCurrency'), dueDate: value('feeDue'), recurrence: 'once', status: value('fee') ? 'known' : 'missing', origin: ['fee', 'feeCurrency', 'feeDue'].some(id => Object.hasOwn(review.corrections, id)) ? 'student entry' : original('fee') ? 'document extraction' : 'demo fixture', sourceLabel: original('fee') ? 'Synthetic fee schedule' : undefined, originalAmount: original('fee') },
 ] satisfies Expense[];
}
export function newExpense(label = ''): Expense {
 return { id: crypto.randomUUID(), label, amount: '', currency: '', dueDate: '', recurrence: label === 'One-time setup' ? 'once' : 'monthly', status: 'missing', missingAcknowledged: false, origin: 'student entry' };
}
export function expenseProblems(expense: Expense): string[] {
 const issues: string[] = [];
 if (!expense.label.trim()) issues.push('Add an expense label.');
 if (expense.status === 'missing' && !expense.missingAcknowledged) issues.push('Mark this expense as missing to continue, or enter an amount.');
 else if (expense.status !== 'missing' && !/^\d+(\.\d{1,2})?$/.test(expense.amount.trim())) issues.push('Enter a valid non-negative amount with up to two decimals.');
 if (expense.status !== 'missing' && !/^[A-Z]{3}$/.test(expense.currency.trim())) issues.push('Use a three-letter uppercase currency code.');
 if (expense.recurrence === 'once' && expense.status !== 'missing') {
  const date = expense.dueDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) issues.push('Enter a valid due date.');
 }
 return issues;
}
