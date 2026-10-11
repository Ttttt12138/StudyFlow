// Requires Django/PostgreSQL, Vite and readiness_worker --mode mock. Creates synthetic students only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root, backend, python, executablePath } from './support.mjs';
const today = new Date();
const iso = date => date.toISOString().slice(0,10);
const future = (months, day=1) => iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth()+months, day)));
const dates = {asOf: iso(today), start: future(1), end: future(5,28), due: future(1,10), repayment: future(6), source: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()+1)))};
const fixture = text => text.replaceAll('2027-01-01',dates.start).replaceAll('2027-05-31',dates.end).replaceAll('2027-01-10',dates.due).replaceAll('year 2027',`year ${dates.due.slice(0,4)}`);
const username = `frontend-uat-${randomUUID()}`, password = randomUUID();
execFileSync(python, ['manage.py', 'shell', '-c', 'import os; from django.contrib.auth import get_user_model; get_user_model().objects.create_user(username=os.environ["UAT_USERNAME"], password=os.environ["UAT_PASSWORD"])'], {cwd:backend, env:{...process.env,UAT_USERNAME:username,UAT_PASSWORD:password},stdio:'pipe'});
const browser = await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
const page = await browser.newPage({viewport:{width:1440,height:1100}});
const errors = [], endpoints = new Set();
page.on('pageerror', e => errors.push(e.message));
page.on('request', req => {const path = new URL(req.url()).pathname; if(path.startsWith('/api/')) endpoints.add(`${req.method()} ${path}`);});
const origin = process.env.TEST_URL || 'http://127.0.0.1:5173';
const nav = name => page.getByRole('navigation').getByRole('button',{name});
const button = name => page.getByRole('button',{name,exact:true});
async function get(path){endpoints.add(`GET /api/v2/${path}`);const r=await page.request.get(`${origin}/api/v2/${path}`); assert.equal(r.status(),200,`${path}: ${await r.text()}`); const payload=await r.json(); return payload.data ?? payload;}
async function post(path,body,key=randomUUID()){endpoints.add(`POST /api/v2/${path}`);const s=await(await page.request.get(`${origin}/api/auth/session/`)).json(); return page.request.post(`${origin}/api/v2/${path}`,{data:body,headers:{'X-CSRFToken':s.csrf_token,'Idempotency-Key':key}});}
try {
 await page.goto(origin);
 await page.getByRole('link',{name:'Sign in to StudyFlow'}).click();
 await page.getByLabel('Username').fill(username); await page.getByLabel('Password').fill(password);
 await button('Log in').click();
 await page.getByRole('heading',{name:'Create a semester'}).waitFor();
 await page.getByLabel('Opening balance (THB)').fill('50000.00');
 await page.getByLabel('Balance as of').fill(dates.asOf);
 await page.getByLabel('Reserve (THB; optional until confirmed)').fill('15000.00');
 await button('Create semester').click();
 await page.getByRole('heading',{name:'Check your school and dates'}).waitFor();
 await page.getByLabel('start date',{exact:true}).fill(dates.start);
 await page.getByLabel('end date',{exact:true}).fill(dates.end);
 await button('Save profile corrections').click(); await page.getByText('Your expense changes were saved.').waitFor();
 await page.getByLabel('Admission document').setInputFiles({name:'synthetic-offer.txt',mimeType:'text/plain',buffer:Buffer.from(fixture('SYNTHETIC UAT fixture, not an official invoice.\nSchool: Prince of Songkla University\nCampus: Phuket\nCountry: Thailand\nProgram: BBA International Business\nStudent type: new international undergraduate\nStart date: 2027-01-01\nEnd date: 2027-05-31\nTuition: THB 65000 per semester; year 2027; campus Phuket; unpaid; due 2027-01-10; invoice_id UAT-65000\n'))});
 await button('Upload for extraction').click(); await page.getByText('Status: QUEUED').waitFor();
 let material;
 for(let attempt=0;attempt<60;attempt++){material=(await get('readiness/imports/'))[0]; if(material.status==='NEEDS_REVIEW') break; await new Promise(resolve=>setTimeout(resolve,500));}
 assert.equal(material.status,'NEEDS_REVIEW',JSON.stringify(material));
 assert.ok(Object.keys(material.result.merge_conflicts??{}).length>0,'C returned source conflicts');
 assert.ok(material.result.issues.some(issue=>issue.code==='MISSING_COST_FIELD'),'C returned missing fields');
 const original=structuredClone(material.result.draft); assert.ok(original.costs.some(c=>c.evidence.length));
 await button('Refresh processing status').click(); await page.getByRole('heading',{name:'Review information from your document'}).waitFor();
 await page.getByLabel('tuition proposed amount').fill('66000.00');
 await page.getByLabel('tuition proposed due date').fill(dates.due);
 await page.getByLabel('tuition proposed payment status').selectOption('false');
 for(const input of await page.getByLabel(/^resolve conflict:|^review reason for/i).all()) await input.fill('Reviewed synthetic UAT correction and original evidence.');
 await page.getByLabel('Document issuer').fill('Synthetic UAT issuer');
 await button('Confirm selected information').click(); await page.getByText('Your document review was saved.').waitFor();
 const committed=await get(`readiness/imports/${material.id}/`); assert.equal(committed.status,'COMMITTED'); assert.deepEqual(committed.result.draft,original);
 let state=await get('readiness/state/'), semester=await get(`readiness/semesters/${state.semester_id}/`);
 assert.equal(semester.draft.costs.find(c=>c.cost_id==='tuition').amount,'66000.00');
 assert.equal(semester.draft.costs.find(c=>c.cost_id==='tuition').confidence_type,'VERIFIED');
 await nav('Complete expenses').click(); assert.equal(await page.getByLabel('tuition amount',{exact:true}).isDisabled(),true);
 await page.getByLabel('food amount',{exact:true}).fill(''); await button('Save expense revisions').click(); await page.getByText('Your expense changes were saved.').waitFor();
 await page.reload(); await page.getByRole('heading',{name:'Check your school and dates'}).waitFor(); await nav('Complete expenses').click();
 assert.equal(await page.getByLabel('food amount',{exact:true}).inputValue(),'');
 await page.getByLabel('food amount',{exact:true}).fill('3500.00'); await nav('Budget').click();
 await page.getByRole('heading',{name:'Update needed',exact:true}).waitFor(); assert.equal(await button('Update budget results').isDisabled(),true);
 await nav('Complete expenses').click();
 state=await get('readiness/state/'); semester=await get(`readiness/semesters/${state.semester_id}/`);
 const versions={semester_id:state.semester_id,state_version:state.state_version,budget_version:state.budget_version,analysis_version:state.analysis_version};
 const changed=structuredClone(semester.draft); changed.reserve='16000.00';
 const otherWrite=await post('readiness/semesters/revise/',{...versions,draft:changed}); assert.equal(otherWrite.status(),201,await otherWrite.text());
 await button('Save expense revisions').click(); await button('Restore my unsaved edits').waitFor(); await button('Restore my unsaved edits').click();
 assert.equal(await page.getByLabel('food amount',{exact:true}).inputValue(),'3500.00');
 await button('Save expense revisions').click(); await page.getByText('Your expense changes were saved.').waitFor(); await nav('Budget').click();
 let lost=true, firstKey;
 await page.route('**/api/v2/readiness/budgets/',async route=>{if(route.request().method()!=='POST')return route.continue(); const key=route.request().headers()['idempotency-key']; if(lost){lost=false;firstKey=key;const r=await route.fetch();assert.equal(r.status(),201);return route.abort('failed');}assert.equal(key,firstKey);return route.continue();});
 const beforeBudget=(await get('readiness/budgets/')).length;
 await button('Update budget results').click(); await page.getByRole('alert').waitFor(); await button('Update budget results').click(); await page.getByText('Your budget results are ready.').waitFor();
 const budgets=await get('readiness/budgets/'); assert.equal(budgets.length,beforeBudget+1); assert.equal(budgets[0].result.complete,false);
 await button('Update 90-day calendar').click(); await page.getByText('Your payment calendar is ready.').waitFor();
 assert.ok((await get('readiness/forecasts/'))[0].result.timeline.length > 0, 'B supplied actual dated calendar events');
 await nav('Funding').click(); await page.getByText('Add a non-loan funding source').click();
 await page.getByLabel('Amount THB',{exact:true}).fill('10000.00'); await page.getByLabel('Available on',{exact:true}).fill(dates.source);
 let sourceLost=true,sourceKey,sourceBody;
 await page.route('**/api/v2/funding-sources/',async route=>{if(route.request().method()!=='POST')return route.continue();const req=route.request();if(sourceLost){sourceLost=false;sourceKey=req.headers()['idempotency-key'];sourceBody=req.postDataJSON();const r=await route.fetch();assert.equal(r.status(),201);return route.abort('failed');}assert.equal(req.headers()['idempotency-key'],sourceKey);assert.deepEqual(req.postDataJSON(),sourceBody);return route.continue();});
 await button('Save funding source').click(); await page.getByRole('alert').waitFor(); await button('Save funding source').click(); await page.getByText('Funding source recorded; it is not received money.').waitFor();
 const sources=await get('funding-sources/'); assert.equal(sources.count,1); assert.equal(sources.results[0].received,false);
 await button('Get funding recommendation').click(); await page.getByText('Your funding options are ready.').waitFor();
 await page.getByText('Explore funding sources and plan details').click();await button('Check suggested funding plan').click(); await page.getByText('Your funding choices were reviewed.').waitFor();
 await nav('Simulated application').click(); await page.getByText('1. Monthly affordability profile').click();
 await button('Add month').click(); await page.getByLabel('Month',{exact:true}).fill(dates.repayment.slice(0,7));
 await page.getByLabel('income',{exact:true}).fill('10000.00'); await page.getByLabel('living expenses',{exact:true}).fill('4000.00'); await page.getByLabel('existing repayments',{exact:true}).fill('0.00');
 await button('Save monthly profile').click(); await page.getByText('Your monthly profile was saved for application review.').waitFor();
 await page.getByLabel('Principal THB',{exact:true}).fill('10000.00'); await page.getByLabel('Annual rate as fraction').fill('0'); await page.getByLabel('Months',{exact:true}).fill('1'); await page.getByLabel('First due date').fill(dates.repayment);
 await button('Create loan quote').click(); await page.getByText('Your loan quote is ready. Review the repayment schedule before applying.').waitFor();
 await button('Create application draft').click(); await page.getByText('Simulated application draft created.').waitFor();
 await button('Submit simulated application').click(); await page.getByText('Your application status was updated.').waitFor();
 const apps=await get('applications/'); assert.equal(apps.count,1); assert.equal(apps.results[0].status,'REJECTED');
 await page.reload(); await page.getByRole('heading',{name:'Check your school and dates'}).waitFor(); await nav('Simulated application').click(); await page.locator('.application-status').waitFor();
 assert.match(await page.locator('.application-status').innerText(),/not approved|rejected/i);
 await button('Reload application state').click();
 mkdirSync(`${root}output/frontend`,{recursive:true});
 for(const size of [{width:1440,height:1100},{width:390,height:844}]){await page.setViewportSize(size);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${root}output/frontend/integration-${size.width}.png`,fullPage:true});}
 await page.setViewportSize({width:1440,height:1100});
 await nav('Confirm information').click();
 async function waitImport(status) {
   let row;
   for (let i=0;i<60;i++) {row=(await get('readiness/imports/'))[0]; if(row.status===status) return row; await new Promise(resolve=>setTimeout(resolve,500));}
   assert.equal(row.status,status,JSON.stringify(row));
 }
 await page.getByLabel('Admission document').setInputFiles(`${root}studyflow-ai/src/studyflow_ai/data/tuition.pdf`);
 await button('Upload for extraction').click(); await page.getByText('Status: QUEUED').waitFor();
 const pdf = await waitImport('NEEDS_REVIEW'); assert.equal(pdf.kind,'pdf'); assert.equal(pdf.processing.consent.accepted,false);
 await button('Refresh processing status').click(); await page.getByRole('heading',{name:'Review information from your document'}).waitFor();
 const image = execFileSync(python, ['-c', 'from PIL import Image; import sys; Image.new("RGB", (20,20), "white").save(sys.stdout.buffer, format="PNG")']);
 await page.getByLabel('Admission document').setInputFiles({name:'synthetic-image.png',mimeType:'image/png',buffer:image});
 assert.equal(await page.getByRole('checkbox',{name:/I agree to OCR/}).isChecked(),false);
 await button('Upload for extraction').click(); await page.getByText('Status: QUEUED').waitFor();
 const manual = await waitImport('NEEDS_MANUAL_INPUT'); assert.equal(manual.processing.consent.accepted,false);
 await button('Refresh processing status').click();
 await page.getByLabel('Manual transcription').fill(fixture('Synthetic manual transcription. Tuition: THB 65000 per semester; year 2027; campus Phuket; unpaid; due 2027-01-10; invoice_id UAT-MANUAL'));
 await button('Submit transcription').click(); await page.getByText('Manual transcription queued for extraction.').waitFor();
 await waitImport('NEEDS_REVIEW'); await button('Refresh processing status').click();
 await page.getByRole('heading',{name:'Review information from your document'}).waitFor();
 await page.unroute("**/api/v2/readiness/budgets/");
 // Complete-result fixture uses actual student APIs; spending UI remains outside this task.
 state=await get('readiness/state/');semester=await get(`readiness/semesters/${state.semester_id}/`);
 const completeDraft=structuredClone(semester.draft);
 for(const cost of completeDraft.costs){if(cost.confidence_type!=='VERIFIED'&&!cost.locked){cost.applicability='NOT_APPLICABLE';cost.applicability_reason='Reviewed disposable UAT fixture: not applicable';cost.conflict=false;}}
 const completeRev=await post('readiness/semesters/revise/',{semester_id:state.semester_id,state_version:state.state_version,budget_version:state.budget_version,analysis_version:state.analysis_version,draft:completeDraft});assert.equal(completeRev.status(),201,await completeRev.text());
 const lastMonthStart=iso(new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)));
 const transactionDate=iso(new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,5)));
 const sessionForCsv=await(await page.request.get(`${origin}/api/auth/session/`)).json();
 endpoints.add('POST /api/v2/readiness/transaction-imports/');
 const csv=await page.request.post(`${origin}/api/v2/readiness/transaction-imports/`,{headers:{'X-CSRFToken':sessionForCsv.csrf_token,'Idempotency-Key':randomUUID()},multipart:{source_type:'synthetic',file:{name:'uat-history.csv',mimeType:'text/csv',buffer:Buffer.from(`transaction_id,account_id,date,amount,currency,counterparty,description\nuat-rent,uat-account,${transactionDate},-100.00,THB,Demo Condo,Monthly rent\n`)}}});assert.equal(csv.status(),202,await csv.text());
 const csvBatch=(await csv.json()).data;
 const coverage=await post(`readiness/transaction-imports/${csvBatch.id}/confirm/`,{selected_rows:csvBatch.preview.rows.map(r=>r.locator),coverage:[{account_id:'uat-account',start:lastMonthStart,end:dates.asOf,complete:true}]});assert.equal(coverage.status(),201,await coverage.text());
 state=await get('readiness/state/');
 const balanceConfirmation=await post('readiness/balance-confirmations/',{state_version:state.state_version,amount:'50000.00',as_of:dates.asOf});assert.equal(balanceConfirmation.status(),201,await balanceConfirmation.text());
 state=await get('readiness/state/');
 const completeBudget=await post('readiness/budgets/',{semester_id:state.semester_id,state_version:state.state_version,budget_version:state.budget_version,analysis_version:state.analysis_version});assert.equal(completeBudget.status(),201,await completeBudget.text());
 const completeResult=(await completeBudget.json()).data;assert.equal(completeResult.result.complete,true,JSON.stringify(completeResult.result.issues));
 // Compare the rendered count with the actual response used by the dashboard.
 // The worker can create notifications between this load and a subsequent GET.
 const notificationResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/v2/readiness/notifications/' && response.request().method()==='GET');
 await nav('Dashboard').click();
 await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
 await page.getByText(/unread · .* total/).waitFor();
 const briefing=await get('readiness/briefing/'), calendar=await get('readiness/calendar/');
 const nr=await notificationResponse, notifications=await nr.json();
 const reviews=await get('review-queue/');
 assert.equal(nr.status(),200); assert.ok(Array.isArray(notifications.data)); assert.ok(Array.isArray(reviews.items));
 const main=await page.locator('main').innerText();
 assert.ok(main.includes(`${notifications.unread_count} unread · ${notifications.count} total`));
 if(briefing.next_obligation) assert.ok(main.includes(briefing.next_obligation.label));
 assert.ok(Array.isArray(calendar.calendar));
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${root}output/frontend/dashboard-${width}.png`,fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});await page.reload();await page.getByRole('heading',{name:'Check your school and dates'}).waitFor();await nav('Dashboard').click();await page.getByText(/unread · .* total/).waitFor();
 assert.deepEqual(errors,[]);
 // HEAD identifies the code actually exercised, including a CI pull-request merge.
 // A shallow Actions checkout need not contain any other remote branch refs.
 writeFileSync(`${root}output/frontend/integration.json`,JSON.stringify({passed:true,tested_at:new Date().toISOString(),backend_commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),backend:'Django/PostgreSQL 17',authentication:'actual Django session login + CSRF',worker:'readiness_worker --mode mock',extraction:'C mock, synthetic fixture',endpoints:[...endpoints].sort(),checks:['original extraction preserved','merged stable IDs','verified fee locked','unknown costs persist','reload','local edits stale','real 409 recovery','lost committed budget/source responses retried without duplicates','B-authored results','desktop/mobile no overflow','text PDF without OCR consent','image with OCR disabled and manual transcription','dashboard live briefing/calendar/notifications/reviews and reload','complete budget after real CSV coverage and balance confirmation; NOT_APPLICABLE distinct from null'],liveModels:false},null,2));
 console.log('PASS: real PostgreSQL/session/CSRF/C mock worker five-step browser integration.');
} catch(error){mkdirSync(`${root}output/frontend`,{recursive:true});await page.screenshot({path:`${root}output/frontend/integration-failure.png`,fullPage:true});console.error('Current UI:',(await page.locator('main').innerText().catch(()=>'No main')).slice(-4500));throw error;} finally {await browser.close();}
