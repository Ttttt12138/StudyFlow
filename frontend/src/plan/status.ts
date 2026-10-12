import type { Lang } from '../i18n';
import { pick } from './format';
import type { Conversation, InSchool } from './types';

export function budgetUsage(spent: string, budget: string) {
  const used = Number(spent), limit = Number(budget);
  if (!spent.trim() || !Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit <= 0) return null;
  return { percent: Math.round(used / limit * 1000) / 10, fraction: Math.min(used / limit, 1) };
}

export function nextBill(data: InSchool | null) {
  if (!data?.enrolled) return null;
  return [...(data.bills ?? data.upcoming_bills), ...data.overdue]
    .filter(bill => bill.status === 'DUE').sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;
}

export function schoolLocation(conversation: Conversation | null, lang: Lang) {
  const key = conversation?.plan?.school_key;
  if (!key) return '';
  for (const turn of [...conversation.turns].reverse()) {
    for (const card of turn.cards) {
      const school = card.type === 'school' && card.school?.key === key ? card.school.school
        : card.type === 'school_list' || card.type === 'comparison' ? card.schools.find(item => item.key === key) : null;
      if (school) return [pick(school.country, lang), pick(school.city, lang)].filter(Boolean).join(' · ');
    }
  }
  return '';
}

export function daysUntil(start: string, today: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const delta = Date.parse(`${start}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(delta) ? Math.round(delta / 86400000) : null;
}
