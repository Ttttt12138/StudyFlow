export type ExpenseStatus = 'known' | 'estimated' | 'missing';
export type ExpenseOrigin = 'document extraction' | 'student entry' | 'demo fixture';
export type Schedule = 'once' | 'monthly' | 'term';
export type Expense = {
 id: string;
 label: string;
 amount: string;
 currency: string;
 dueDate: string;
 recurrence: Schedule;
 status: ExpenseStatus;
 missingAcknowledged?: boolean;
 origin: ExpenseOrigin;
 sourceLabel?: string;
 originalAmount?: string | null;
};
export type ExpenseReview = { expenses: Expense[]; confirmed: boolean };
