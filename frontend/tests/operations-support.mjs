export const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const student = { owner: 3, owner_username: 's1' };
export const approval = { ...student, id: id(1), action: 'payment.submit', target_id: id(2), amount: '65000.00', currency: 'THB',
  reason: 'Tuition', status: 'PENDING', version: 1, created_at: '2026-10-11T00:00:00Z', expires_at: new Date(Date.now() + 86400000).toISOString(),
  decided_at: null, decision_note: '', requested_by_username: 's1', decided_by_username: null, can_decide: true, blocked_reason: null, target: null };
export const payment = { ...student, id: id(3), amount: '9000.00', currency: 'THB', status: 'unknown', event_id: 'rent',
  due_on: '2026-10-20', submitted_at: '2026-10-11T01:00:00Z', beneficiary_name: 'Landlord', beneficiary_verified: true, invoice_snapshot: {} };
export const order = { ...student, id: id(4), version: 2, status: 'SUBMITTED', effective_status: 'SUBMITTED', recipient: 'SELF',
  beneficiary_name: null, purpose: 'tuition', send_amount: '1000.00', send_currency: 'CNY', receive_amount: '4500.00', receive_currency: 'THB',
  submitted_at: '2026-10-11T01:00:00Z', expected_latest: '2026-10-14', deadline: null };
export const payee = { ...student, id: id(5), name: 'New landlord', destination_label: 'MOCK-ONLY', verified: false, created_at: '2026-10-11T00:00:00Z' };
export const loan = { ...student, id: id(6), version: 3, status: 'APPROVED', created_at: '2026-10-11T00:00:00Z', decision_reason: '',
  assessment: { status: 'AFFORDABLE' }, quote: { currency: 'THB', principal: '10000.00', net_proceeds: '9500.00', fees: '500.00', total_repayment: '10300.00', maximum_installment: '1720.00', months: 6, annual_rate: '0.12' } };
export const sponsor = { ...student, id: id(7), status: 'PENDING', terms_version: 2, purpose: 'Tuition help', created_at: '2026-10-11T00:00:00Z', token_expires_at: null, confirmed_at: null,
  source: { id: id(8), amount: '8000.00', currency: 'THB', available_on: '2026-10-10', received: false } };
export const item = (kind, record) => ({ kind, record, queued_at: record.created_at ?? record.submitted_at, attention: record.status?.toLowerCase() === 'unknown' ? 'unknown' : null });
export function workbench(items = [], changes = {}) {
  return { operator: { id: 9, username: 'op' }, is_simulated: true, generated_at: '2026-10-13T09:00:00Z',
    summary: { total: items.length, expiring: 0, unknown: items.filter(row => row.attention === 'unknown').length,
      unverified: items.filter(row => row.kind === 'payee').length,
      by_kind: { approvals: items.filter(row => row.kind === 'approval').length, transactions: items.filter(row => ['payment', 'order'].includes(row.kind)).length,
        payees: items.filter(row => row.kind === 'payee').length, loans: items.filter(row => row.kind === 'loan').length, sponsors: items.filter(row => row.kind === 'sponsor').length } },
    items, recent_decisions: [], pagination: { page: 1, page_size: 20, total: items.length, pages: 1 }, ...changes };
}
export async function openOpsItem(page, kind, text) {
  const row = page.locator(`.ops-table tbody tr[data-kind="${kind}"]`).filter(text ? { hasText: text } : {});
  await row.first().getByRole('button', { name: 'View', exact: true }).click();
  return page.getByRole('dialog', { name: 'Item details' });
}
