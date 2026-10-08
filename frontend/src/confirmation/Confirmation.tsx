import { useEffect, useRef, useState } from 'react';
import type { Admission, Evidence, Review } from './types';
import { problem } from './adapter';
export function Confirmation({ admission, review, onChange, onContinue }: { admission: Admission; review: Review; onChange: (review: Review) => void; onContinue: () => void }) {
 const [source, setSource] = useState<Evidence | null>(null);
 const dialog = useRef<HTMLDialogElement>(null);
 useEffect(() => { if (source) dialog.current?.showModal(); }, [source]);
 const issues = admission.fields.filter(f => problem(f, review.corrections));
 return <>
 <div className="section-heading"><div><span className="eyebrow">STEP 01 / 05</span><h1>Start with the facts.</h1><p>Review your admission details before planning your study costs.</p></div><span className="tag">Admission review</span></div>
 <div className="demo"><strong>Demo data</strong><span>Synthetic admission documents. No live extraction or API is connected.</span></div>
 <section className="card"><div className="card-heading"><div><h2>Confirm information</h2><p>Check each value against its source. Your corrections stay separate from the extraction.</p></div><span className="count">{admission.fields.length} fields</span></div>
 <div className="legend"><span className="status known">Known</span> Documented <span className="status estimated">Estimated</span> Requires review <span className="status missing">Missing</span> Needs information</div>
 <div className="fields">{admission.fields.map(field => { const error = problem(field, review.corrections); const corrected = Object.hasOwn(review.corrections, field.id); return <div className={`field ${error ? 'attention' : ''}`} key={field.id}>
 <div className="field-top"><label htmlFor={field.id}>{field.label}{field.required && <span className="required"> *</span>}</label><span className={`status ${field.status}`}>{field.status}</span></div>
 <input id={field.id} type={field.kind === 'date' ? 'date' : 'text'} inputMode={field.kind === 'amount' ? 'decimal' : undefined} value={corrected ? review.corrections[field.id] : field.original ?? ''} placeholder="Not supplied — enter verified information" aria-required={field.required} aria-invalid={!!error} aria-describedby={`${field.id}-detail`} onChange={e => onChange({ corrections: { ...review.corrections, [field.id]: e.target.value }, confirmed: false })}/>
 <div id={`${field.id}-detail`}><div className="original">Extracted: {field.original ?? 'Not supplied'}{corrected && <span className="corrected"> · Student correction</span>}</div>{field.alternatives && <div className="conflict"><strong>Conflicting source values</strong>{field.alternatives.map(a => <div key={a.source}>{a.value} — {a.source}</div>)}</div>}{error && <p className="error">{error}</p>}</div>
 <div className="sources">{field.evidence.length ? field.evidence.map(e => <button className="source-button" key={e.id} onClick={() => setSource(e)}>↗ Inspect source</button>) : <span>No source evidence supplied</span>}{corrected && <button className="reset" onClick={() => { const corrections = { ...review.corrections }; delete corrections[field.id]; onChange({ corrections, confirmed: false }); }}>Restore extraction</button>}</div>
 </div>; })}</div>
 <div className="confirmation"><div className="readiness" role="status">{issues.length ? `${issues.length} required field${issues.length === 1 ? '' : 's'} need attention before you can confirm.` : 'All required fields are addressed. Please confirm your review.'}</div><label className="check"><input type="checkbox" disabled={!!issues.length} checked={review.confirmed} onChange={e => onChange({ ...review, confirmed: e.target.checked })}/><span>I have reviewed the admission information and confirm these values.<small>Confirmation records your review in this draft only.</small></span></label></div>
 <div className="card-footer"><span>* Required for this draft’s confirmation workflow</span><button className="primary" disabled={!!issues.length || !review.confirmed} onClick={onContinue}>Continue to expenses <span>→</span></button></div></section>
 {source && <dialog ref={dialog} aria-labelledby="source-title" className="source-dialog" onCancel={() => setSource(null)}><h2 id="source-title">{source.title}</h2><p>{source.location}</p><blockquote>{source.quote}</blockquote><p className="muted">Synthetic source evidence for demonstration only.</p><button autoFocus className="primary" onClick={() => setSource(null)} onKeyDown={e => { if (e.key === 'Escape') setSource(null); }}>Close source</button></dialog>}
 </>;
}
