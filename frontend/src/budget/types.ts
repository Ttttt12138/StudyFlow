import type { ExpenseStatus } from '../expenses/types';
export type BudgetLine = { label: string; value: string | null; currency: string | null; status: ExpenseStatus };
export type ScenarioResult = {
 id: string;
 name: string;
 assumptions: string[];
 currency: string;
 reportedCosts: string | null;
 availableFunds: string | null;
 remainingBalance: string | null;
 fundingGap: string | null;
 calculationStatus: 'calculated' | 'partial' | 'unavailable';
 completenessStatus: 'complete' | 'incomplete';
 lines: BudgetLine[];
};
export type BudgetResponse = { responseId: string; inputVersion: string; scenarios: ScenarioResult[] };
