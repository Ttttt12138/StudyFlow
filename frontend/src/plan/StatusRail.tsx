import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { CurrencyCircleDollar } from '@phosphor-icons/react/dist/csr/CurrencyCircleDollar';
import { Bank } from '@phosphor-icons/react/dist/csr/Bank';
import { PaperPlaneTilt } from '@phosphor-icons/react/dist/csr/PaperPlaneTilt';
import { useId } from 'react';
import { useI18n } from '../i18n';
import type { ToolTarget } from '../workspace/navigation';
import { day, money, pick } from './format';
import type { JourneyPhase } from './journeyPhase';
import type { InSchool, Plan, Spending } from './types';
import { budgetUsage, daysUntil, nextBill } from './status';

type OpenTool = (target: ToolTarget) => void;

function RailLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="rail-link" onClick={onClick}>{children}<ArrowRight size={16} aria-hidden="true" /></button>;
}

function BudgetArc({ spending }: { spending: Spending }) {
  const { t, lang } = useI18n();
  const usage = budgetUsage(spending.spent, spending.budget);
  const label = usage ? t('status.used', { percent: usage.percent.toLocaleString(lang) }) : t('status.budgetMissing');
  const id = `budget-${useId().replace(/:/g, '')}`;
  const end = (135 + (usage?.fraction ?? 0) * 270) * Math.PI / 180;
  // A live data visualization: 270 degrees correspond to 100% of the budget.
  return <figure className={`budget-arc${usage && usage.percent > 100 ? ' is-over' : ''}`} aria-label={`${t('status.spent')}: ${money(spending.spent, spending.currency, lang)}. ${label}`}>
    <svg viewBox="0 0 240 215" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-value`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#1f9f82" /><stop offset="1" stopColor="#6ff7d4" /></linearGradient>
        <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" /></filter>
        <radialGradient id={`${id}-point`}><stop offset="0" stopColor="#fff6d8" /><stop offset=".45" stopColor="#f2c879" stopOpacity=".8" /><stop offset="1" stopColor="#f2c879" stopOpacity="0" /></radialGradient>
      </defs>
      <circle className="budget-arc-ticks" cx="120" cy="115" r="110" pathLength="100" strokeDasharray=".25 1.25" transform="rotate(135 120 115)" />
      <circle className="budget-arc-track" cx="120" cy="115" r="99" pathLength="100" strokeDasharray="75 25" transform="rotate(135 120 115)" />
      {usage && <>
        <circle className="budget-arc-halo" cx="120" cy="115" r="99" pathLength="100" filter={`url(#${id}-glow)`}
          strokeDasharray={`${usage.fraction * 75} 100`} transform="rotate(135 120 115)" />
        <circle className="budget-arc-value" cx="120" cy="115" r="99" pathLength="100" stroke={`url(#${id}-value)`}
          strokeDasharray={`${usage.fraction * 75} 100`} transform="rotate(135 120 115)" />
        <circle cx={120 + 99 * Math.cos(end)} cy={115 + 99 * Math.sin(end)} r="11" fill={`url(#${id}-point)`} />
        <circle className="budget-arc-point" cx={120 + 99 * Math.cos(end)} cy={115 + 99 * Math.sin(end)} r="4" />
        <circle className="budget-arc-start" cx={120 + 99 * Math.cos(Math.PI * .75)} cy={115 + 99 * Math.sin(Math.PI * .75)} r="3.5" />
      </>}
      <text className="budget-arc-scale" x="27" y="198" textAnchor="middle">0%</text>
      <text className="budget-arc-scale" x="213" y="198" textAnchor="middle">100%</text>
    </svg>
    <figcaption><span>{t('status.spent')}</span><strong>{money(spending.spent, '', lang)}</strong><span>{spending.currency}</span>
      <small>{usage && usage.percent > 100 ? `${t('status.over')} · ` : ''}{label}</small></figcaption>
  </figure>;
}

function BudgetStatus({ spending, open }: { spending: Spending; open: OpenTool }) {
  const { t, lang } = useI18n();
  return <section className="status-budget">
    <div className="rail-heading"><h2>{t('status.budget')}</h2><span>{spending.month}</span></div>
    <BudgetArc spending={spending} />
    <dl className="rail-facts"><div><dt>{t('status.limit')}</dt><dd>{money(spending.budget, spending.currency, lang)}</dd></div>
      <div><dt>{t('status.remaining')}</dt><dd className={Number(spending.remaining) < 0 ? 'is-over' : ''}>{money(spending.remaining, spending.currency, lang)}</dd></div></dl>
    {!!spending.unconverted?.length && <p className="rail-warning">{t('plan.monthly.unconverted', { n: spending.unconverted.length })}</p>}
    <RailLink onClick={() => open({ kind: 'spending', month: spending.month })}>{t('status.expenses')}</RailLink>
  </section>;
}

function BillStatus({ data, open }: { data: InSchool; open: OpenTool }) {
  const { t, lang } = useI18n();
  const bill = nextBill(data);
  return <section className="status-bills"><h2>{t('status.bills')}</h2>
    {bill ? <div className="bill-timeline"><time dateTime={bill.due_date} aria-label={day(bill.due_date, lang)}>
      <strong>{Number(bill.due_date.slice(8, 10))}</strong>
      <span>{new Date(`${bill.due_date}T00:00:00`).toLocaleDateString(lang, { month: 'short' })}</span></time>
      <div className="bill-timeline-detail"><span>{pick(bill.label, lang)}</span><strong>{money(bill.amount, bill.currency, lang)}
        <small>{t(data.enrolled && bill.due_date < data.today ? 'status.overdue' : 'status.due')}</small></strong></div></div>
      : <p className="rail-muted">{t('status.noBills')}</p>}
    <p className="rail-muted">{t('status.billNote')}</p>
    <RailLink onClick={() => open({ kind: 'bills' })}>{t('status.billLink')}</RailLink>
  </section>;
}

function PlanStatus({ plan, phase, open }: { plan: Plan | null; phase: JourneyPhase; open: OpenTool }) {
  const { t, lang } = useI18n();
  const currency = plan?.currency ?? plan?.school?.currency ?? '';
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const days = plan ? daysUntil(plan.start_date, today) : null;
  return <>
    <section className="status-plan"><h2>{t(phase === 1 ? 'status.prepare' : 'status.estimate')}</h2>
      {phase === 1 && plan ? <><time className="rail-start-date" dateTime={plan.start_date}>{day(plan.start_date, lang)}</time>
        {days !== null && <p className="rail-muted">{t(days > 0 ? 'status.countdown' : days === 0 ? 'status.startToday' : 'status.startPassed', { n: days })}</p>}</>
        : <><p className="rail-muted">{t('status.total')}</p><div className="rail-total">{money(plan?.total, '', lang)}<small>{currency}</small></div></>}
      <dl className="rail-facts">
        {phase === 1 && <div><dt>{t('status.total')}</dt><dd>{money(plan?.total, currency, lang)}</dd></div>}
        <div><dt>{t('status.funds')}</dt><dd>{money(plan?.available_funds, plan?.funds_currency ?? '', lang)}</dd></div>
        <div><dt>{t('status.gap')}</dt><dd>{money(plan?.gap, currency, lang)}</dd></div>
      </dl>
      <p className="rail-muted">{t('status.estimateNote')}</p>
      <RailLink onClick={() => open({ kind: 'plan' })}>{t('status.planLink')}</RailLink>
    </section>
    <section className="status-next"><h2>{t('status.next')}</h2><p>{t(phase === 1 ? 'status.prepareNext' : 'status.consultNext')}</p>
      {phase === 1 && plan?.status !== 'ENROLLED' && <p className="rail-muted">{t('status.enrollmentNote')}</p>}</section>
  </>;
}

export function StatusRail({ plan, data, phase, open }: { plan: Plan | null; data: InSchool | null; phase: JourneyPhase; open: OpenTool }) {
  const { t } = useI18n();
  return <aside className="status-rail" aria-label={t('status.overview')}>
    {phase === 2 ? data?.enrolled ? <><BudgetStatus spending={data.spending} open={open} /><BillStatus data={data} open={open} /></>
      : <p className="rail-muted" role="status">{t('status.loading')}</p>
      : <PlanStatus plan={plan} phase={phase} open={open} />}
    <section className="status-finance"><h2>{t('status.finance')}</h2><div>
      <button type="button" onClick={() => open({ kind: 'wallet', section: 'convert' })}><CurrencyCircleDollar size={34} weight="light" aria-hidden="true" />{t('status.fx')}</button>
      <button type="button" onClick={() => open({ kind: 'wallet', section: 'quote' })}><PaperPlaneTilt size={34} weight="light" aria-hidden="true" />{t('status.remit')}</button>
      <button type="button" onClick={() => open({ kind: 'loans' })}><Bank size={34} weight="light" aria-hidden="true" />{t('status.loan')}</button>
    </div></section>
  </aside>;
}
