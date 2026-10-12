import { useEffect, useRef, useState } from 'react';
import type { Admission, Evidence, Review } from './types';
import { problem } from './adapter';
import { useI18n } from '../i18n';
export function Confirmation({ admission, review, onChange, onContinue }: { admission: Admission; review: Review; onChange: (review: Review) => void; onContinue: () => void }) {
 const { lang, t } = useI18n();
 const [source, setSource] = useState<Evidence | null>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 const opener = useRef<HTMLButtonElement | null>(null);
 // Closing the dialog returns focus to the button that opened it.
 useEffect(() => { if (source) dialog.current?.showModal(); else { opener.current?.focus(); opener.current = null; } }, [source]);
 const issues = admission.fields.filter(f => problem(f, review.corrections, lang));
 return <>
 <div className="section-heading"><div><span className="eyebrow">{t('demo.stepOf', { n: '01' })}</span><h1>{t('demo.confirm.title')}</h1><p>{t('demo.confirm.lead')}</p></div><span className="tag">{t('demo.confirm.tag')}</span></div>
 <div className="demo"><strong>{t('demo.demoData')}</strong><span>{t('demo.confirm.demoText')}</span></div>
 <section className="card"><div className="card-heading"><div><h2>{t('demo.step.confirm')}</h2><p>{t('demo.confirm.cardText')}</p></div><span className="count">{t('demo.confirm.fieldCount', { n: admission.fields.length })}</span></div>
 <div className="legend"><span className="status known">{t('demo.legend.known')}</span> {t('demo.legend.knownText')} <span className="status estimated">{t('demo.legend.estimated')}</span> {t('demo.legend.estimatedText')} <span className="status missing">{t('demo.legend.missing')}</span> {t('demo.legend.missingText')}</div>
 <div className="fields">{admission.fields.map(field => { const error = problem(field, review.corrections, lang); const corrected = Object.hasOwn(review.corrections, field.id); return <div className={`field ${error ? 'attention' : ''}`} key={field.id}>
 <div className="field-top"><label htmlFor={field.id}>{field.label}{field.required && <span className="required"> *</span>}</label><span className={`status ${field.status}`}>{t(`demo.status.${field.status}`)}</span></div>
 <input id={field.id} type={field.kind === 'date' ? 'date' : 'text'} inputMode={field.kind === 'amount' ? 'decimal' : undefined} value={corrected ? review.corrections[field.id] : field.original ?? ''} placeholder={t('demo.confirm.placeholder')} aria-required={field.required} aria-invalid={!!error} aria-describedby={`${field.id}-detail`} onChange={e => onChange({ corrections: { ...review.corrections, [field.id]: e.target.value }, confirmed: false })}/>
 <div id={`${field.id}-detail`}><div className="original">{t('demo.confirm.extracted', { value: field.original ?? t('demo.notSupplied') })}{corrected && <span className="corrected"> · {t('demo.confirm.studentCorrection')}</span>}</div>{field.alternatives && <div className="conflict"><strong>{t('demo.confirm.conflicting')}</strong>{field.alternatives.map(a => <div key={a.source}>{a.value} — {a.source}</div>)}</div>}{error && <p className="error">{error}</p>}</div>
 <div className="sources">{field.evidence.length ? field.evidence.map(e => <button className="source-button" key={e.id} onClick={event => { opener.current = event.currentTarget; setSource(e); }}>{t('demo.confirm.inspectSource')}</button>) : <span>{t('demo.confirm.noEvidence')}</span>}{corrected && <button className="reset" onClick={() => { const corrections = { ...review.corrections }; delete corrections[field.id]; onChange({ corrections, confirmed: false }); }}>{t('demo.confirm.restore')}</button>}</div>
 </div>; })}</div>
 <div className="confirmation"><div className="readiness" role="status">{issues.length ? t(issues.length === 1 ? 'demo.confirm.issuesOne' : 'demo.confirm.issuesMany', { n: issues.length }) : t('demo.confirm.ready')}</div><label className="check"><input type="checkbox" disabled={!!issues.length} checked={review.confirmed} onChange={e => onChange({ ...review, confirmed: e.target.checked })}/><span>{t('demo.confirm.check')}<small>{t('demo.confirm.checkNote')}</small></span></label></div>
 <div className="card-footer"><span>{t('demo.confirm.requiredNote')}</span><button className="primary" disabled={!!issues.length || !review.confirmed} onClick={onContinue}>{t('demo.confirm.continue')} <span>→</span></button></div></section>
 {source && <dialog ref={dialog} aria-labelledby="source-title" className="source-dialog" onCancel={() => setSource(null)}><h2 id="source-title">{source.title}</h2><p>{source.location}</p><blockquote>{source.quote}</blockquote><p className="muted">{t('demo.confirm.sourceNote')}</p><button autoFocus className="primary" onClick={() => setSource(null)} onKeyDown={e => { if (e.key === 'Escape') setSource(null); }}>{t('demo.confirm.closeSource')}</button></dialog>}
 </>;
}
