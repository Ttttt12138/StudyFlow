import { describe, expect, it } from 'vitest';
import { budgetUsage, nextBill, schoolLocation, daysUntil } from '../status';
import type { Bill, Conversation, InSchool } from '../types';
import { readWorkspaceRoute, workspaceUrl } from '../../workspace/navigation';

describe('workspace status uses current records without inventing progress', () => {
  it('reports actual budget use and only caps the drawn arc', () => {
    expect(budgetUsage('8620', '24300')).toEqual({ percent: 35.5, fraction: 8620 / 24300 });
    expect(budgetUsage('300', '200')).toEqual({ percent: 150, fraction: 1 });
    expect(budgetUsage('0', '200')).toEqual({ percent: 0, fraction: 0 });
  });
  it('does not show an invented percentage for missing or invalid budgets', () => {
    for (const [spent, budget] of [['2', '0'], ['2', ''], ['2', '-10'], ['bad', '100'], ['-1', '100']]) {
      expect(budgetUsage(spent, budget)).toBeNull();
    }
  });
  it('prioritizes overdue unpaid bills and keeps their original currency', () => {
    const bills = [
      { id: 'paid', status: 'PAID', due_date: '2026-10-01' },
      { id: 'later', status: 'DUE', due_date: '2026-11-15', currency: 'THB' },
      { id: 'due', status: 'DUE', due_date: '2026-10-15', currency: 'JPY' },
    ] as Bill[];
    const data = { enrolled: true, upcoming_bills: bills, overdue: [{ id: 'old', status: 'DUE', due_date: '2026-10-05', currency: 'USD' }] } as Extract<InSchool, { enrolled: true }>;
    expect(nextBill(data)?.id).toBe('old');
    expect(nextBill({ ...data, overdue: [] })?.currency).toBe('JPY');
    expect(nextBill({ enrolled: false })).toBeNull();
    expect(nextBill(null)).toBeNull();
  });
  it('uses geography only from the selected school and handles no matching record', () => {
    const conversation = { plan: { school_key: 'selected' }, turns: [{ cards: [
      { type: 'school_list', schools: [{ key: 'other', city: { en: 'Other' } }, { key: 'selected', city: { en: 'Bangkok', zh: '曼谷' }, country: { en: 'Thailand', zh: '泰国' } }] },
    ] }] } as Conversation;
    expect(schoolLocation(conversation, 'zh')).toBe('泰国 · 曼谷');
    expect(schoolLocation({ ...conversation, plan: { ...conversation.plan!, school_key: 'missing' } }, 'zh')).toBe('');
    expect(schoolLocation(null, 'en')).toBe('');
  });
  it('keeps passed intake dates distinct from enrollment completion', () => {
    expect(daysUntil('2026-10-15', '2026-10-12')).toBe(3);
    expect(daysUntil('2026-10-01', '2026-10-12')).toBe(-11);
    expect(daysUntil('', '2026-10-12')).toBeNull();
  });
  it('restores only supported tool sections in history and direct links', () => {
    for (const [kind, section] of [['wallet', 'convert'], ['wallet', 'quote'], ['bills', 'expense']] as const) {
      const route = { preview: true, stage: 'school' as const, tool: { kind, section } };
      expect(readWorkspaceRoute(`http://localhost${workspaceUrl(route)}`)).toEqual(route);
    }
    expect(readWorkspaceRoute('http://localhost/?tool=wallet&section=unknown').tool).toEqual({ kind: 'wallet' });
    expect(readWorkspaceRoute('http://localhost/?tool=loans&section=quote').tool).toEqual({ kind: 'loans' });
  });
});
