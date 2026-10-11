// Real Django/PostgreSQL, fixture FX; disposable users, operator-assisted setup only.
import { test } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { root, backend, python } from '../../support.mjs';

// Student, verifier and approver each sign in with their own browser context.
test('real Django/PostgreSQL wallet, fixture quotes, T2/T3, expiry, permissions, safe retries and reload.', async ({ browser }, testInfo) => {
  const origin=process.env.TEST_URL||'http://127.0.0.1:5173';
  const names={student:`wallet-uat-${randomUUID()}`,verifier:`verifier-${randomUUID()}`,approver:`approver-${randomUUID()}`};
  const passwords={student:randomUUID(),verifier:randomUUID(),approver:randomUUID()};
  execFileSync(python,['manage.py','shell','-c','import os,json; from django.contrib.auth import get_user_model; from finance.corridors import ensure_default_corridors; from finance.policy_defaults import ensure_default_limits; names=json.loads(os.environ["UAT_NAMES"]); passwords=json.loads(os.environ["UAT_PASSWORDS"]); [get_user_model().objects.create_user(username=n,password=passwords[k],is_staff=k!="student") for k,n in names.items()]; ensure_default_corridors(); ensure_default_limits()'],{cwd:backend,env:{...process.env,UAT_NAMES:JSON.stringify(names),UAT_PASSWORDS:JSON.stringify(passwords)},stdio:'pipe'});
  const contexts={},pages={},endpoints=new Set(),errors=[];
  async function login(kind){const ctx=await browser.newContext({ locale: "en-US", viewport:{width:1440,height:1000}});contexts[kind]=ctx;const page=await ctx.newPage();pages[kind]=page;page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{const p=new URL(req.url()).pathname;if(p.startsWith('/api/'))endpoints.add(`${kind}: ${req.method()} ${p}`);});await page.goto(`${origin}/api/auth/login/?next=${encodeURIComponent(origin+'/?wallet=1')}`);await page.getByLabel('Username').fill(names[kind]);await page.getByLabel('Password').fill(passwords[kind]);await page.getByRole('button',{name:'Log in',exact:true}).click();await page.getByRole('heading',{name:'Wallet & transfers',exact:true}).waitFor();}
  async function get(path,kind='student'){endpoints.add(`${kind}: GET /api/v2/${path}`);const r=await contexts[kind].request.get(`${origin}/api/v2/${path}`);assert.equal(r.status(),200,`${path}: ${await r.text()}`);const p=await r.json();return p.data??p;}
  async function post(path,body,kind='student',key=randomUUID(),headers={}){endpoints.add(`${kind}: POST /api/v2/${path}`);const identity=await(await contexts[kind].request.get(`${origin}/api/auth/session/`)).json();return contexts[kind].request.post(`${origin}/api/v2/${path}`,{data:body,headers:{'X-CSRFToken':identity.csrf_token,'Idempotency-Key':key,...headers}});}
  async function successful(path,body,kind='student'){const r=await post(path,body,kind);assert.ok([200,201].includes(r.status()),`${path}: ${await r.text()}`);const p=await r.json();return p.data??p;}
  try {
   for(const k of ['student','verifier','approver'])await login(k);
   const page=pages.student,button=name=>page.getByRole('button',{name,exact:true});
   const semester=await successful('readiness/semesters/',{reserve:'1000.00',opening_balance:'200000.00',as_of:new Date().toISOString().slice(0,10)});
   await successful('demo/initialize/',{state_version:semester.state_version});
   const payee=await successful('beneficiaries/',{name:'Disposable verified school',destination_label:'SIMULATED-UAT'});
   const unverified=await successful('beneficiaries/',{name:'Unverified UAT',destination_label:'SIMULATED-UNVERIFIED'});
   let denied=await post(`beneficiaries/${payee.id}/verify/`,{verified:true});assert.equal(denied.status(),403);
   await successful(`beneficiaries/${payee.id}/verify/`,{verified:true},'verifier');
   await button('Refresh from Django').click();await page.getByText('THB 200,000.00',{exact:true}).waitFor();
   const routes=await get('corridors/'),route=routes.find(r=>r.source_currency==='THB'&&r.target_currency==='CNY');assert.ok(route);
   await page.getByLabel('Currency route').selectOption(route.id);await page.getByLabel('Send amount').fill('3000.00');await button('Get backend quotes').click();await page.getByText(/3 backend-priced routes returned/).waitFor();
   const select=page.locator('.wallet-quote-grid').getByRole('button',{name:'Select quote'});await select.first().click();
   await page.getByLabel('Recipient',{exact:true}).selectOption('BENEFICIARY');await page.getByLabel('Beneficiary',{exact:true}).waitFor();assert.equal(await page.getByLabel('Beneficiary',{exact:true}).locator(`option[value="${unverified.id}"]`).evaluate(option=>option.disabled),true);await page.getByLabel('Beneficiary',{exact:true}).selectOption(payee.id);
   // Failed-before-commit then dropped-after-commit creation uses one body/key and one record.
   let createAttempt=0,createKey,createBody;
   await page.route('**/api/v2/remittance-orders/',async r=>{if(r.request().method()!=='POST')return r.continue();createAttempt++;const req=r.request();if(createAttempt===1){createKey=req.headers()['idempotency-key'];createBody=req.postData();return r.fulfill({status:503,json:{detail:'Injected transport test failure'}});}assert.equal(req.headers()['idempotency-key'],createKey);assert.equal(req.postData(),createBody);const response=await r.fetch();assert.equal(response.status(),201);return r.abort('failed');});
   await button('Create order for review').click();await page.getByText(/order was not found after the failed response/).waitFor();await button('Create order for review').click();await page.getByText(/Django already saved this order/).waitFor();await page.unroute('**/api/v2/remittance-orders/');
   let orders=await get('remittance-orders/');assert.equal(orders.count,1);let order=orders.results[0];assert.equal(order.status,'CREATED');assert.equal((await get('demo/wallets/balances/')).balances.find(x=>x.currency==='THB').balance,'200000.00');
   await page.getByRole('checkbox',{name:/I reviewed this exact simulated transfer/}).check();await button('Confirm submission').click();await page.getByRole('heading',{name:'Password check'}).waitFor();
   let dropped=false,submitKey;
   await page.route(`**/api/v2/remittance-orders/${order.id}/submit/`,async r=>{submitKey=r.request().headers()['idempotency-key'];const response=await r.fetch();assert.equal(response.status(),201);dropped=true;return r.abort('failed');});
   await page.getByLabel('Password',{exact:true}).fill(passwords.student);await button('Authorize and submit').click();await page.getByText(/response was lost or the server failed/).waitFor();assert.ok(dropped);await page.unroute(`**/api/v2/remittance-orders/${order.id}/submit/`);
   // Replay the identical committed command without the consumed step-up grant: idempotency is checked first.
   const replay=await post(`remittance-orders/${order.id}/submit/`,{expected_version:order.version},'student',submitKey);assert.equal(replay.status(),200);
   await button('Refresh order status').click();await page.getByText('Submitted to the simulated processing route. Delivery is not confirmed.').waitFor();
   await page.getByText('THB 197,000.00',{exact:true}).waitFor();
   order=await get(`remittance-orders/${order.id}/`);assert.equal(order.status,'SUBMITTED');assert.equal(order.history.filter(h=>h.to==='SUBMITTED').length,1);assert.equal((await get('demo/wallets/balances/')).balances.find(x=>x.currency==='THB').balance,'197000.00');
   denied=await post(`remittance-orders/${order.id}/adapter-event/`,{expected_version:order.version,outcome:'delivered'});assert.equal(denied.status(),403);
   // Student denial plus different verifier/approver identities remain real HTTP policy checks.
   await page.getByLabel('Send amount').fill('60000.00');await button('Get backend quotes').click();await page.getByText(/3 backend-priced routes returned/).waitFor();await select.first().click();await button('Create order for review').click();await page.getByText('Simulated order prepared. Review its backend-priced details before submitting.').waitFor();
   await page.getByRole('checkbox',{name:/I reviewed this exact simulated transfer/}).check();await button('Confirm submission').click();await page.getByRole('heading',{name:'Operator approval required'}).waitFor();await button('Request operator approval').click();await page.getByText(/Approval requested/).waitFor();
   const approval=(await get('approvals/')).results[0];denied=await post(`approvals/${approval.id}/decide/`,{expected_version:approval.version,decision:'approve'});assert.equal(denied.status(),403);
   denied=await post(`approvals/${approval.id}/decide/`,{expected_version:approval.version,decision:'approve'},'verifier');assert.equal(denied.status(),403);
   await successful(`approvals/${approval.id}/decide/`,{expected_version:approval.version,decision:'approve'},'approver');
   await button('Refresh from Django').click();await button('Continue to password check').click();await page.getByLabel('Password',{exact:true}).fill(passwords.student);await button('Authorize and submit').click();await page.getByText('Django reports: SUBMITTED.',{exact:true}).waitFor();
   await page.reload();await page.getByText('Submitted to the simulated processing route. Delivery is not confirmed.').waitFor();orders=await get('remittance-orders/');assert.equal(orders.count,2);assert.ok(orders.results.every(o=>o.status==='SUBMITTED'));
   // Controlled backend fixture expiry, then real reads/commands; no long blocking wait.
   const expiryQuote=await successful('fx-quotes/live/',{corridor_id:route.id,send_amount:'1000.00'});
   const expiryOrder=await successful('remittance-orders/',{quote_id:expiryQuote.id,recipient:'SELF',purpose:'living'});
   execFileSync(python,['manage.py','shell','-c','import os; from django.utils import timezone; from datetime import timedelta; from finance.workflow_models import FXQuote; FXQuote.objects.filter(pk=os.environ["UAT_QUOTE"]).update(expires_at=timezone.now()-timedelta(seconds=1))'],{cwd:backend,env:{...process.env,UAT_QUOTE:expiryQuote.id},stdio:'pipe'});
   assert.equal((await get(`remittance-orders/${expiryOrder.id}/`)).effective_status,'EXPIRED');
   const expiryRejected=await post('remittance-orders/',{quote_id:expiryQuote.id,recipient:'SELF',purpose:'living'});assert.equal(expiryRejected.status(),400);
   // Real version conflict on a prepared order; no backend security settings disabled.
   const q=await successful('fx-quotes/live/',{corridor_id:route.id,send_amount:'1000.00'}),prepared=await successful('remittance-orders/',{quote_id:q.id,recipient:'SELF',purpose:'living'});
   const conflict=await post(`remittance-orders/${prepared.id}/cancel/`,{expected_version:0+prepared.version+1});assert.equal(conflict.status(),409);assert.equal((await get(`remittance-orders/${prepared.id}/`)).status,'CREATED');
   await button('Refresh from Django').click();await page.getByRole('button',{name:/living .*EXPIRED/}).click();await page.getByText('The quote expired. Prepare a new transfer with a fresh quote.').waitFor();
   mkdirSync(`${root}output/frontend`,{recursive:true});for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${root}output/frontend/wallet-live-${width}.png`,fullPage:true});}
   assert.deepEqual(errors,[]);writeFileSync(`${root}output/frontend/wallet-integration.json`,JSON.stringify({passed:true,tested_at:new Date().toISOString(),database:'PostgreSQL 17',fx:'fixture STUDYFLOW_FX_LIVE=false',worker:'not required for remittance',operator_assistance:['verify beneficiary','separate-operator T3 approval'],expiry:'controlled quote timestamp fixture followed by real HTTP',endpoints:[...endpoints].sort(),checks:['session/CSRF','backend pricing','unverified recipient disabled','prepare does not debit','failed/dropped create response exact-once','T2 step-up','dropped submit response idempotent replay','T3 approval with different verifier/approver','student operator endpoints denied','reload','expiry','actual HTTP 409','desktop/mobile'],liveFX:false},null,2));
  } catch (error) {
    if (pages.student) await testInfo.attach('student-page', { body: await pages.student.screenshot({ fullPage: true }), contentType: 'image/png' });
    throw error;
  } finally {
    for (const context of Object.values(contexts)) await context.close();
  }
});
