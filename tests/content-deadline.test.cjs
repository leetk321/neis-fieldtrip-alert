const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const C=require('../core.js'),R=require('../report-core.js'),D=require('../report-deadline-core.js');
const root=path.resolve(__dirname,'..'),origin='https://goe.neis.go.kr';
const config={year:'2026',grade:'1',classNo:'10',interval:5,excludedDates:[]};
const raw=(state='완결')=>({eduActAplySn:'synthetic-application',rptSn:'synthetic-report',grd:'1',clsCd:'10',clsNo:'11',regDt:'20260901',stuFlnm:'가상학생',eduActPrcsStsNm:state==='미상신'?'접수대기':'접수',atrzStsNm:state,experLrnPeriod:'2026.09.07 00:00 ~ 2026.09.09 23:59'});
async function harness(){
 let listener,response,fail=false;const requests=[],messages=[];
 const identity=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([origin,['가상교사(test)'],['가상학교']])))).toString('hex');
 const bar={querySelectorAll:s=>s==='[role="button"],button'?[{textContent:'로그아웃'}]:s==='[title]'?[{getAttribute:()=> '가상교사(test)'}]:[{getAttribute:()=> '가상학교',textContent:'가상학교'}]};
 class Clock extends Date{constructor(...args){super(...(args.length?args:['2026-09-21T01:00:00Z']));}static now(){return Date.parse('2026-09-21T01:00:00Z');}}
 const context=vm.createContext({crypto:webcrypto,TextEncoder,TextDecoder,URL,Date:Clock,AbortController,console,
  location:{origin},document:{visibilityState:'hidden',hasFocus:()=>false,querySelector:s=>s==='.topbar'?bar:null,addEventListener(){},removeEventListener(){}},
  window:{addEventListener(){},removeEventListener(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
  fetch:async(url,options)=>{requests.push({url,...options});if(fail)throw Error('offline');return {ok:true,text:async()=>JSON.stringify(response)};},
  chrome:{runtime:{id:'synthetic-extension',getManifest:()=>({version:'1.9.4'}),sendMessage:async m=>{messages.push(m);return {ok:true};},onMessage:{addListener:f=>listener=f,removeListener(){}}}}
 });
 for(const f of ['calendar.js','core.js','report-core.js','report-deadline-core.js','content.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context);
 const poll=(data,schema,kind='application')=>{response=data;return new Promise(resolve=>listener({type:'POLL',identity,config,kind,template:{endpoint:'/saved-full-query.do',body:'{"saved":"unchanged"}',headers:{'content-type':'application/json'},schema}},{id:'synthetic-extension'},resolve));};
 return {poll,requests,messages,setFail:()=>fail=true};
}
test('real content code adopts 1.9.3 application and report schemas without ARM or screen access',async()=>{
 const h=await harness(),adata={rows:[raw()],totalCount:1},rdata={rows:[raw('미상신')],totalCount:1};
 const as=C.learn(adata,1),rs=R.learn(rdata,1);assert.equal(as.coverage,undefined);
 const a=await h.poll(adata,as),r=await h.poll(rdata,rs,'report');assert.equal(a.ok,true,a.error);assert.equal(r.ok,true,r.error);
 assert.equal(a.snapshot.coverageUpgrade.source,'saved-full-query');assert.equal(a.snapshot.deadline.ready,true);assert.equal(r.snapshot.deadline.ready,true);
 assert.match(a.snapshot.deadline.rows[0].link,/^[a-f0-9]{64}$/);assert.equal(a.snapshot.deadline.rows[0].link,r.snapshot.deadline.rows[0].link);
 assert.equal(D.plan(a.snapshot.deadline,r.snapshot.deadline,'2026-09-21').rows[0].reason,'unsubmitted');
 assert.equal(Object.hasOwn(a.snapshot.deadline.rows[0],'clsNo'),false);
 assert.equal(h.messages.length,0);assert.equal(h.requests.length,2);assert.ok(h.requests.every(r=>r.url==='/saved-full-query.do'&&r.body==='{"saved":"unchanged"}'));
 assert.equal(as.coverage,undefined,'input profile was not mutated');
});
test('old empty report connection learns its first data even when the server omits total metadata',async()=>{
 const h=await harness(),old={...C.pendingSchema({rows:[]},0),kind:'report'};
 const empty=await h.poll({rows:[]},old,'report');assert.equal(empty.ok,true);assert.equal(empty.snapshot.deadline.ready,true);
 const saved={...old,coverage:empty.snapshot.coverageUpgrade};
 const first=await h.poll({rows:[raw('미상신')]},saved,'report');assert.equal(first.ok,true,first.error);assert.equal(first.snapshot.count,1);assert.equal(first.snapshot.learnedSchema.kind,'report');assert.equal(first.snapshot.deadline.ready,true);assert.equal(first.snapshot.awaitingSchema,undefined);
 assert.equal(h.messages.length,0);
});
test('partial report or a missing student number pauses only the new deadline judgment',async()=>{
 const h=await harness(),data={rows:[raw('미상신')],totalCount:1},s=R.learn(data,1);
 for(const broken of [{rows:[raw('미상신')],totalCount:2},{rows:[{...raw('미상신'),clsNo:null}],totalCount:1}]){
  const out=await h.poll(broken,s,'report');assert.equal(out.ok,true,out.error);assert.equal(out.snapshot.count,1);assert.equal(out.snapshot.deadline.ready,false);
 }
 h.setFail();assert.equal((await h.poll(data,s,'report')).ok,false);
});
test('adopted total metadata remains required on future queries',async()=>{
 const h=await harness(),data={rows:[raw()],totalCount:1},s=C.learn(data,1);
 const first=await h.poll(data,s),saved={...s,coverage:first.snapshot.coverageUpgrade};
 const next=await h.poll({rows:[]},saved);assert.equal(next.ok,true);assert.equal(next.snapshot.deadline.ready,false);
});
