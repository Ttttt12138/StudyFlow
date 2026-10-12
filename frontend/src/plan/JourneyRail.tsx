import { ArrowRight } from '@phosphor-icons/react/dist/csr/ArrowRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { useEffect, useId, useState } from 'react';
import type { WalletClient } from '../wallet/client';
import { useI18n } from '../i18n';
import { pick } from './format';
import type { CatalogEntry, Conversation } from './types';
import type { JourneyPhase } from './journeyPhase';
import { schoolLocation } from './status';

function useSchoolLocation(conversation: Conversation | null, client: WalletClient, preview: boolean) {
  const { lang } = useI18n();
  const fallback = schoolLocation(conversation, lang), key = conversation?.plan?.school_key;
  const [loaded, setLoaded] = useState({ key: '', text: '' });
  useEffect(() => {
    if (!key || fallback || preview) return;
    let alive = true;
    void client.get<{ school: CatalogEntry }>(`planning/schools/${encodeURIComponent(key)}/`).then(result => {
      if (alive && result.school?.key === key) setLoaded({ key,
        text: [pick(result.school.school.country, lang), pick(result.school.school.city, lang)].filter(Boolean).join(' · ') });
    }).catch(() => { /* Optional geography stays unknown when unavailable. */ });
    return () => { alive = false; };
  }, [key, fallback, preview, client, lang]);
  return fallback || (loaded.key === key ? loaded.text : '');
}

export function JourneyRail({ conversation, current, selected, onEnter, onPlan, disabled, client, preview }: {
  conversation: Conversation | null; current: JourneyPhase; selected: JourneyPhase;
  onEnter: (phase: JourneyPhase) => void; onPlan: () => void; disabled: boolean;
  client: WalletClient; preview: boolean;
}) {
  const { t, lang } = useI18n();
  const plan = conversation?.plan;
  const location = useSchoolLocation(conversation, client, preview);
  const orbitId = `journey-orbit-${useId().replace(/:/g, "")}`;
  return <aside className="journey-rail" aria-label={t('status.journey')}>
    <h2 className="rail-eyebrow"><span aria-hidden="true">01 /</span> {t('status.journey')}</h2>
    <div className="journey-track-wrap">
      {/* Decorative orbit through the three stage nodes; offsets match the staggered stops in CSS. */}
      <svg className="journey-orbit" viewBox="0 -40 90 360" width="90" height="360" aria-hidden="true" focusable="false">
        <defs><linearGradient id={orbitId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4ff2c6" stopOpacity="0" /><stop offset=".2" stopColor="#4ff2c6" stopOpacity=".75" />
          <stop offset=".85" stopColor="#4ff2c6" stopOpacity=".55" /><stop offset="1" stopColor="#4ff2c6" stopOpacity=".15" /></linearGradient></defs>
        <path d="M26 -34 C 34 -6, 41 18, 41 54 S 60 100, 60 144 S 64 196, 63 234 S 50 290, 38 306" fill="none" stroke={`url(#${orbitId})`} strokeWidth="1.2" />
        <circle cx="38" cy="306" r="2.6" fill="#d9fff3" />
      </svg>
    <ol className="journey-track">{([0, 1, 2] as const).map(phase => <li key={phase}>
      <button type="button" className={`journey-stop${current === phase ? ' is-current' : ''}${selected === phase ? ' is-selected' : ''}`}
        disabled={disabled || phase > current} aria-current={current === phase ? 'step' : undefined}
        aria-pressed={phase === selected} onClick={() => onEnter(phase)}>
        <span className="journey-stop-number" aria-hidden="true">0{phase + 1}</span>
        <span className="journey-stop-node" aria-hidden="true">{phase < current && <Check size={15} weight="bold" />}</span>
        <span><strong>{t(`plan.intro.name.${phase}`)}</strong><small>{t(phase < current ? 'plan.intro.done' : phase === current ? 'plan.intro.current' : 'plan.intro.future')}</small>
          {selected === phase && phase !== current && <small className="journey-view-label">{t('status.reviewing')}</small>}</span>
      </button>
    </li>)}</ol></div>
    <section className="journey-destination" aria-label={t('plan.plan.school')}>
      <img className="journey-globe" src="/images/workspace-globe.png" alt="" width="260" height="260" decoding="async" />
      <h3>{plan ? pick(plan.school?.name, lang) || plan.school_key : t('status.schoolPending')}</h3>
      <p>{plan ? location || t('status.locationPending') : t('status.choose')}</p>
      {plan && <><small>{t('plan.sample')}</small><div className="journey-destination-footer">
        <span>{t(`plan.plan.status.${plan.status}`)}</span>
        <button type="button" className="rail-link" onClick={onPlan}>{t('status.planLink')} <ArrowRight size={16} aria-hidden="true" /></button>
      </div></>}
    </section>
  </aside>;
}
