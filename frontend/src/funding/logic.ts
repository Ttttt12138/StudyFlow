import type { ApplicationInputs, Decision, FundingPlan, FundingResponse, LenderQuote, QuoteRow } from './types';

/** "USD 1,556.64": whole numbers as integers, quoted decimals with two places, both with separators. */
export function money(currency: string, amount: number | string) {
 const value = Number(amount);
 const decimals = typeof amount === 'string' && amount.includes('.') ? 2 : 0;
 return `${currency} ${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

/** "3,450" → 3450; anything else (blank, decimals, negative) → null. */
export function wholeAmount(value: string | null | undefined): number | null {
 const text = (value ?? '').replace(/,/g, '').trim();
 return /^\d+$/.test(text) ? Number(text) : null;
}

export type PlanSummary = {
 gap: number;
 onTime: number;
 lateAmount: number;
 loanNeeded: number;
 lender: LenderQuote;
 row: QuoteRow | null;
 overMax: string[];
 covered: boolean;
};

/**
 * Money that arrives after the due date cannot pay tuition on time, so only on-time sources count
 * toward the gap; the loan covers the rest at the smallest quoted tier that is large enough.
 */
export function summarize(gap: number, plan: FundingPlan, response: FundingResponse): PlanSummary {
 const lender = response.lenders.find(item => item.id === plan.lenderId) ?? response.lenders[0];
 let onTime = 0, lateAmount = 0;
 const overMax: string[] = [];
 for (const source of response.sources) {
  const amount = plan.allocations[source.id] ?? 0;
  if (amount > source.max) overMax.push(source.id);
  if (source.late) lateAmount += amount; else onTime += Math.min(amount, source.max);
 }
 const loanNeeded = Math.max(gap - onTime, 0);
 const row = loanNeeded > 0 ? lender.rows.find(item => item.principal >= loanNeeded) ?? null : null;
 return { gap, onTime, lateAmount, loanNeeded, lender, row, overMax, covered: overMax.length === 0 && (loanNeeded === 0 || row !== null) };
}

/** Cents from a quoted "129.72". */
const cents = (value: string) => Math.round(Number(value) * 100);

/**
 * Simulated assessment for the offline demo: the installment must fit within half of what is left
 * each month after living costs and other repayments; a blank input means the lender needs more data.
 */
export function assess(inputs: ApplicationInputs, row: QuoteRow): { decision: Decision; disposable: number | null } {
 const [income, living, other] = [inputs.income, inputs.living, inputs.other].map(wholeAmount);
 if (income === null || living === null || other === null) return { decision: 'UNDER_REVIEW', disposable: null };
 const disposable = income - living - other;
 return { decision: disposable > 0 && cents(row.monthly) * 2 <= disposable * 100 ? 'APPROVED' : 'REJECTED', disposable };
}
