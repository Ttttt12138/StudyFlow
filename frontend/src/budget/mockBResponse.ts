import { loadAdmission } from '../confirmation/adapter';
import type { Admission, Review } from '../confirmation/types';
import type { ExpenseReview } from '../expenses/types';
import { documentedExpenses } from '../expenses/adapter';
import type { BudgetResponse } from './types';

// Mock B response for layout and state handling only. Values below are returned data, not calculated here.
export function inputVersion(admission: Admission, review: Review, expenseReview: ExpenseReview): string {
 return JSON.stringify({ admissionId: admission.id, fields: admission.fields.map(f => [f.id, review.corrections[f.id] ?? f.original]), documented: documentedExpenses(admission, review).map(e => [e.id, e.amount, e.currency, e.dueDate, e.status]), expenses: expenseReview.expenses.map(e => [e.id, e.label, e.amount, e.currency, e.dueDate, e.recurrence, e.status]) });
}
const base = loadAdmission('complete');
const baseReview: Review = { corrections: {}, confirmed: true };
const baseExpenses: ExpenseReview = { expenses: [], confirmed: true };
export const mockBResponse: BudgetResponse = {
 responseId: 'demo-budget-response-v1',
 inputVersion: inputVersion(base, baseReview, baseExpenses),
 scenarios: [
  { id: 'standard', name: 'Standard arrival', assumptions: ['One academic term', 'Sample family funds supplied to B', 'Housing and living costs are illustrative estimates'], currency: 'USD', reportedCosts: '18,450', availableFunds: '15,000', remainingBalance: null, fundingGap: '3,450', calculationStatus: 'calculated', completenessStatus: 'complete', lines: [{ label: 'Tuition and school fees', value: '12,450', currency: 'USD', status: 'known' }, { label: 'Housing and daily expenses', value: '6,000', currency: 'USD', status: 'estimated' }] },
  { id: 'lower', name: 'Lower living estimate', assumptions: ['One academic term', 'Sample family funds supplied to B', 'Lower illustrative living estimate'], currency: 'USD', reportedCosts: '16,950', availableFunds: '15,000', remainingBalance: null, fundingGap: '1,950', calculationStatus: 'calculated', completenessStatus: 'complete', lines: [{ label: 'Tuition and school fees', value: '12,450', currency: 'USD', status: 'known' }, { label: 'Housing and daily expenses', value: '4,500', currency: 'USD', status: 'estimated' }] },
  { id: 'unknown', name: 'Unpriced arrival', assumptions: ['One academic term', 'Sample family funds supplied to B', 'Insurance remains unknown'], currency: 'USD', reportedCosts: '12,450', availableFunds: '15,000', remainingBalance: null, fundingGap: null, calculationStatus: 'partial', completenessStatus: 'incomplete', lines: [{ label: 'Tuition and school fees', value: '12,450', currency: 'USD', status: 'known' }, { label: 'Insurance', value: null, currency: null, status: 'missing' }] },
 ],
};
