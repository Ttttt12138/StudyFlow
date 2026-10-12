// Offline demo, steps 4–5: funding options and loan quotes returned by the (mock) planner, the
// student's plan, and the simulated application. Amounts are whole units of the scenario currency.
export type SourceCertainty = 'needs_confirmation' | 'pending_decision' | 'estimated';
export type FundingSourceOption = {
 id: 'family' | 'scholarship' | 'work';
 max: number;
 certainty: SourceCertainty;
 availableOn: string;
 // Arrives after the tuition due date, so it cannot cover the gap on time.
 late: boolean;
};
export type QuoteRow = { principal: number; monthly: string; totalRepayment: string; fees: string; totalCost: string };
export type LenderQuote = { id: 'union' | 'bank' | 'student'; lender: string; annualRate: string; months: number; rows: QuoteRow[] };
export type FundingResponse = {
 responseId: string;
 currency: string;
 dueDate: string;
 sources: FundingSourceOption[];
 lenders: LenderQuote[];
 suggestion: { allocations: Record<FundingSourceOption['id'], number>; lenderId: LenderQuote['id'] };
};
export type FundingPlan = {
 scenarioId: string;
 allocations: Record<FundingSourceOption['id'], number>;
 lenderId: LenderQuote['id'];
 confirmed: boolean;
};
export type ApplicationInputs = { income: string; living: string; other: string };
export type Decision = 'APPROVED' | 'UNDER_REVIEW' | 'REJECTED';
export type ApplicationState = { inputs: ApplicationInputs; consent: boolean; decision: Decision | null };
