import type { FundingResponse } from './types';

// Mock planner response for the offline demo, in the style of budget/mockBResponse.ts: the values are
// returned data, not calculated here. Quote rows are standard monthly amortisation at the stated rate,
// precomputed per principal tier; the demo picks the smallest tier that covers what is left.
export const mockCResponse: FundingResponse = {
 responseId: 'demo-funding-response-v1',
 currency: 'USD',
 dueDate: '2026-08-25',
 sources: [
  { id: 'family', max: 2000, certainty: 'needs_confirmation', availableOn: '2026-08-15', late: false },
  { id: 'scholarship', max: 1000, certainty: 'pending_decision', availableOn: '2026-09-30', late: true },
  { id: 'work', max: 600, certainty: 'estimated', availableOn: '2026-10-31', late: true },
 ],
 lenders: [
  { id: 'union', lender: 'Demo Credit Union', annualRate: '6.9%', months: 12, rows: [
   { principal: 500, monthly: '43.24', totalRepayment: '518.88', fees: '0.00', totalCost: '18.88' },
   { principal: 1000, monthly: '86.48', totalRepayment: '1037.76', fees: '0.00', totalCost: '37.76' },
   { principal: 1500, monthly: '129.72', totalRepayment: '1556.64', fees: '0.00', totalCost: '56.64' },
   { principal: 2000, monthly: '172.96', totalRepayment: '2075.52', fees: '0.00', totalCost: '75.52' },
   { principal: 2500, monthly: '216.20', totalRepayment: '2594.40', fees: '0.00', totalCost: '94.40' },
   { principal: 3000, monthly: '259.44', totalRepayment: '3113.28', fees: '0.00', totalCost: '113.28' },
   { principal: 3500, monthly: '302.68', totalRepayment: '3632.16', fees: '0.00', totalCost: '132.16' },
  ] },
  { id: 'bank', lender: 'Demo Bank', annualRate: '8.5%', months: 12, rows: [
   { principal: 500, monthly: '43.61', totalRepayment: '523.32', fees: '20.00', totalCost: '43.32' },
   { principal: 1000, monthly: '87.22', totalRepayment: '1046.64', fees: '20.00', totalCost: '66.64' },
   { principal: 1500, monthly: '130.83', totalRepayment: '1569.96', fees: '20.00', totalCost: '89.96' },
   { principal: 2000, monthly: '174.44', totalRepayment: '2093.28', fees: '20.00', totalCost: '113.28' },
   { principal: 2500, monthly: '218.05', totalRepayment: '2616.60', fees: '25.00', totalCost: '141.60' },
   { principal: 3000, monthly: '261.66', totalRepayment: '3139.92', fees: '30.00', totalCost: '169.92' },
   { principal: 3500, monthly: '305.27', totalRepayment: '3663.24', fees: '35.00', totalCost: '198.24' },
  ] },
  { id: 'student', lender: 'Demo Student Lender', annualRate: '11.9%', months: 24, rows: [
   { principal: 500, monthly: '23.51', totalRepayment: '564.24', fees: '0.00', totalCost: '64.24' },
   { principal: 1000, monthly: '47.03', totalRepayment: '1128.72', fees: '0.00', totalCost: '128.72' },
   { principal: 1500, monthly: '70.54', totalRepayment: '1692.96', fees: '0.00', totalCost: '192.96' },
   { principal: 2000, monthly: '94.05', totalRepayment: '2257.20', fees: '0.00', totalCost: '257.20' },
   { principal: 2500, monthly: '117.57', totalRepayment: '2821.68', fees: '0.00', totalCost: '321.68' },
   { principal: 3000, monthly: '141.08', totalRepayment: '3385.92', fees: '0.00', totalCost: '385.92' },
   { principal: 3500, monthly: '164.59', totalRepayment: '3950.16', fees: '0.00', totalCost: '450.16' },
  ] },
 ],
 // Non-loan money first; the scholarship and work income arrive after tuition is due, so they are left out.
 suggestion: { allocations: { family: 2000, scholarship: 0, work: 0 }, lenderId: 'union' },
};
