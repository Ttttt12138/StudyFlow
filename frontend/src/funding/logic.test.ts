import { describe, expect, it } from 'vitest';
import { assess, money, summarize, wholeAmount } from './logic';
import { mockCResponse } from './mockCResponse';
import type { FundingPlan } from './types';

const plan = (allocations: Partial<FundingPlan['allocations']>, lenderId: FundingPlan['lenderId'] = 'union'): FundingPlan =>
 ({ scenarioId: 'standard', allocations: { family: 0, scholarship: 0, work: 0, ...allocations }, lenderId, confirmed: false });

describe('money', () => {
 it('adds separators; quoted decimals keep two places', () => {
  expect(money('USD', 3450)).toBe('USD 3,450');
  expect(money('USD', '1556.64')).toBe('USD 1,556.64');
  expect(money('USD', '0.00')).toBe('USD 0.00');
 });
});

describe('wholeAmount', () => {
 it('reads whole numbers with thousands separators and rejects the rest', () => {
  expect(wholeAmount('3,450')).toBe(3450);
  expect(wholeAmount(' 0 ')).toBe(0);
  for (const bad of ['', '12.5', '-3', 'abc', null]) expect(wholeAmount(bad)).toBeNull();
 });
});

describe('summarize', () => {
 it('covers the rest with the smallest loan tier that is large enough', () => {
  const summary = summarize(3450, plan({ family: 2000 }), mockCResponse);
  expect([summary.onTime, summary.loanNeeded, summary.row?.principal, summary.covered]).toEqual([2000, 1450, 1500, true]);
 });
 it('does not count money that arrives after tuition is due', () => {
  const summary = summarize(1950, plan({ family: 1000, scholarship: 1000 }), mockCResponse);
  expect([summary.onTime, summary.lateAmount, summary.loanNeeded]).toEqual([1000, 1000, 950]);
 });
 it('needs no loan when on-time sources cover the gap', () => {
  const summary = summarize(1950, plan({ family: 2000 }), mockCResponse);
  expect([summary.loanNeeded, summary.row, summary.covered]).toEqual([0, null, true]);
 });
 it('flags amounts above what a source can give and gaps beyond the largest quote', () => {
  expect(summarize(3450, plan({ family: 2500 }), mockCResponse).overMax).toEqual(['family']);
  expect(summarize(9000, plan({}), mockCResponse).covered).toBe(false);
 });
 it('uses the chosen lender', () => {
  expect(summarize(3450, plan({ family: 2000 }, 'student'), mockCResponse).row?.monthly).toBe('70.54');
 });
});

describe('assess', () => {
 const row = mockCResponse.lenders[0].rows[2]; // 1,500 at 129.72 / month
 it('approves when the installment fits within half of what is left each month', () => {
  expect(assess({ income: '900', living: '600', other: '0' }, row)).toEqual({ decision: 'APPROVED', disposable: 300 });
 });
 it('rejects when it does not fit, and asks for data when an input is blank', () => {
  expect(assess({ income: '800', living: '600', other: '0' }, row).decision).toBe('REJECTED');
  expect(assess({ income: '900', living: '', other: '0' }, row)).toEqual({ decision: 'UNDER_REVIEW', disposable: null });
 });
});
