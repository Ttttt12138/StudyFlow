export function asksForMonthlySpending(text: string) {
  const value = text.toLowerCase();
  if (/记录|记一|记账|支付|付款|不要|别展示|\b(pay|record|add|don't|do not)\b/.test(value)) return false;
  return /本月|这个月|这月|this month|current month/.test(value)
    && /账单|消费|开销|支出|花销|花了多少|\b(bills?|spend|spending|spent|expenses?)\b/.test(value);
}

const COLORS = ["#40edc3", "#75a7ff", "#ffcf70", "#ca96ff", "#ff8d9c", "#8cd67d", "#65d5ef", "#c5b5a2"];
export function spendingSlices(categories: Record<string, string>) {
  const rows = Object.entries(categories).map(([category, amount]) => ({ category, amount, value: Number(amount) }))
    .filter(row => Number.isFinite(row.value) && row.value > 0).sort((a, b) => b.value - a.value);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let end = 0;
  return rows.map((row, i) => {
    const start = end, share = row.value / total * 100;
    end = i === rows.length - 1 ? 100 : start + share;
    return { ...row, start, end, share, color: COLORS[i % COLORS.length] };
  });
}
