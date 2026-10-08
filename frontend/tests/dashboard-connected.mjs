import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let failure=true,stale=false,auth=false,active=false;
const v={state_version:2,budget_version:3,analysis_version:1};
await page.route('**/api/auth/session/',r=>r.fulfill({json:{authenticated:true,username:'student',csrf_token:'mock'}}));
await page.route('**/api/v2/**',r=>{
 const p=new URL(r.request().url()).pathname;
 if(auth&&p.endsWith('/briefing/'))return r.fulfill({status:403,json:{detail:'Authentication required'}});
 if(p.endsWith('/templates/'))return r.fulfill({json:{data:[{key:'demo',label:'Demo'}]}});
 if(p.endsWith('/state/'))return active?r.fulfill({json:{data:{...v,semester_id:'semester'}}}):r.fulfill({status:400,json:{code:'NO_ACTIVE_SEMESTER'}});
 if(p.endsWith('/briefing/'))return r.fulfill({json:{data:{...v,state_version:stale?1:2,as_of:'2026-10-08',is_simulated:true,status:'NEEDS_INFORMATION',data_issues:['MISSING:food'],actions:[],next_obligation:null}}});
 if(p.endsWith('/calendar/'))return r.fulfill({json:{data:{...v,as_of:'2026-10-08',calendar:[]}}});
 if(p.endsWith('/notifications/'))return r.fulfill({json:{data:[],unread_count:4,count:4,next:null,previous:null}});
 if(p.endsWith('/review-queue/'))return failure?r.fulfill({status:503,json:{code:'TEMPORARY_FAILURE'}}):r.fulfill({json:{data:{count:0,items:[],next:null,previous:null}}});
 return r.fulfill({json:{data:[]}});
});
try{
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5173');await page.getByRole('heading',{name:'Create a semester',exact:true}).waitFor();
 await page.getByRole('navigation').getByRole('button',{name:'Dashboard',exact:true}).click();
 await page.getByText('4 unread · 4 total').waitFor();await page.getByText('Could not load reviews.').waitFor();await page.getByRole('heading',{name:'Start your semester'}).waitFor();
 failure=false;await page.getByRole('button',{name:'Retry reviews'}).click();await page.getByText('No review items were returned.').waitFor();
 active=true;stale=true;await page.getByRole('button',{name:'Refresh dashboard',exact:true}).click();await page.getByText('The briefing or calendar uses older backend versions. Refresh before relying on it.').waitFor();
 stale=false;await page.getByRole('button',{name:'Refresh dashboard',exact:true}).click();await page.getByText('The briefing or calendar uses older backend versions. Refresh before relying on it.').waitFor({state:'hidden'});
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 auth=true;await page.getByRole('button',{name:'Refresh dashboard',exact:true}).click();await page.getByRole('heading',{name:'Sign in again'}).waitFor();assert.equal(await page.getByText('4 unread · 4 total').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: mocked dashboard partial failure/retry, envelopes, no semester, stale, auth, desktop/mobile.');
}finally{await browser.close();}
