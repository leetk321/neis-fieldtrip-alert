/* Isolated browser integration of persistent page metadata and the real content renderer. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1080,height:800}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const until=async condition=>{for(let i=0;i<150;i++){if(await page.evaluate(condition))return;await new Promise(r=>setTimeout(r,20));}throw Error('State did not settle: '+condition.toString()+' '+JSON.stringify(await page.evaluate(()=>({requests:requests.slice(-4),bar:document.querySelector(".topbar").textContent,pending:local.pendingPageNotices,notice:document.querySelector("[data-neis-trip-notice]")?.textContent}))));};
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div class="topbar"><button>로그아웃</button><span title="가상교사(test)"></span><div role="combobox">가상학교</div></div><textarea id="draft"></textarea><div style="height:1800px"></div>'}));
  await page.goto('https://goe.neis.go.kr/mock');let navigations=0;page.on('framenavigated',()=>navigations++);
  await page.clock.install({time:new Date('2026-09-01T01:00:00Z')});await page.clock.pauseAt(new Date('2026-09-01T01:00:01Z'));
  await page.evaluate(version=>{
   window.currentVersion=version;window.visibility='hidden';window.windowFocused=false;window.listeners=new Set();window.requests=[];window.local={alertLog:[]};window.rejectAck=false;window.rejectValidation=false;
   Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});document.hasFocus=()=>windowFocused;
   window.setView=(v,f)=>{visibility=v;windowFocused=f;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event(f?'focus':'blur'));};
   window.dispatchContent=m=>new Promise(resolve=>[...listeners][0](m,{id:'replay-test'},resolve));
   window.chrome={runtime:{id:'replay-test',getManifest:()=>({version:currentVersion}),onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:async m=>{
    requests.push(m);
    if(m.type==='CAN_IDENTIFY')return {ok:true,allowed:false};
    if(m.type==='NOTICE_VALIDATE'){if(rejectValidation)return {ok:false};await ledger.replay(connection,snapshot);return {ok:true};}
    if(m.type==='NOTICE_VIEWED'){if(rejectAck)return {ok:false};return {ok:await ledger.viewed(m.refs,connection)};}
    return {ok:true};
   }},storage:{local:{get:async()=>structuredClone(local),set:async values=>Object.assign(local,structuredClone(values))}},tabs:{sendMessage:async(id,m)=>dispatchContent(m)}};
  },version);
  for(const file of ['calendar.js','core.js','alert-delivery.js','page-notices.js','content.js'])await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(async()=>{
   const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([location.origin,['가상교사(test)'],['가상학교']]))))).map(v=>v.toString(16).padStart(2,'0')).join('');
   window.connection={tabId:1,origin:location.origin,identity:id,config:{year:'2026',grade:'2',classNo:'3',interval:5}};
   window.ledger=TripPageNotices.create({chrome,core:TripCore,calendar:TripCalendar,copy:TripAlertDelivery.copy});
   window.snapshot={records:[],departures:[],count:0,total:0};
   window.addWork=async(id,rows)=>{
    snapshot={records:rows,departures:[],count:rows.length,total:rows.length};
    const item={id,kind:'first',title:'[1차 알림]',message:'가상 테스트',createdAt:Date.now(),page:{version:1,viewedAt:null},delivery:{state:'requested'}};
    local.alertLog.unshift(item);await ledger.register(item,connection,rows,[]);await ledger.replay(connection,snapshot);
   };
   draft.value='작성 중인 교사 업무\n입력 내용 보존';draft.focus();draft.setSelectionRange(2,6);scrollTo(0,50);
  });
  const state=()=>page.evaluate(()=>({value:draft.value,start:draft.selectionStart,end:draft.selectionEnd,focused:document.activeElement===draft,scroll:scrollY}));
  const before=await state(),notice=page.locator('[data-neis-trip-notice]');
  const rows=[{key:'b'.repeat(64),receipt:'접수대기',unsubmitted:true,startDate:'2026-10-01',studentName:'처리할학생'},{key:'c'.repeat(64),receipt:'접수대기',unsubmitted:true,startDate:'2026-10-01',studentName:'이전이름'}];
  await page.evaluate(rows=>addWork('original',rows),rows);
  assert.equal(await notice.count(),0);assert.equal(await page.evaluate(()=>requests.filter(m=>m.type==='NOTICE_VIEWED').length),0);
  await page.evaluate(()=>globalThis.__NEIS_TRIP_CONTENT_V2__.dispose());
  await page.clock.runFor(3*24*60*60*1000);
  await page.addScriptTag({path:path.join(root,'content.js')});
  await page.evaluate(async()=>{snapshot.records=snapshot.records.slice(1);snapshot.records[0].studentName='현재이름';await ledger.replay(connection,snapshot);});
  assert.equal(await notice.count(),0);
  await page.evaluate(()=>setView('visible',true));
  await until(()=>document.querySelector('[data-neis-trip-notice]'));
  assert.match(await notice.textContent(),/신청서 1건/);assert.match(await notice.textContent(),/현재이름/);assert.doesNotMatch(await notice.textContent(),/처리할학생|이전이름/);
  await until(()=>local.pendingPageNotices.length===0);
  assert.ok(await page.evaluate(()=>local.alertLog[0].page.viewedAt));assert.deepEqual(await state(),before);
  await page.clock.runFor(5000);await page.evaluate(()=>setView('hidden',false));await page.clock.runFor(60000);
  await page.evaluate(()=>setView('visible',true));await until(()=>document.querySelector('[data-neis-trip-notice]').style.display==='grid');
  await page.clock.runFor(9999);assert.equal(await notice.count(),1);await page.clock.runFor(1);assert.equal(await notice.count(),0);
  await page.evaluate(()=>globalThis.__NEIS_TRIP_CONTENT_V2__.dispose());await page.addScriptTag({path:path.join(root,'content.js')});
  await page.evaluate(()=>ledger.replay(connection,snapshot));assert.equal(await notice.count(),0);
  console.log('PASS: three-day restart, fresh subset/name, visible-only ACK, no replay after ACK, remaining timer and input preserved.');

  await page.evaluate(()=>setView('hidden',false));await page.evaluate(rows=>addWork('processed',rows),[rows[0]]);
  await page.evaluate(()=>{snapshot.records=[];setView('visible',true);});
  await until(()=>local.pendingPageNotices.length===0);assert.equal(await notice.count(),0);
  console.log('PASS: returning to an existing hidden queue rechecks current data before displaying; processed work is silent.');

  await page.evaluate(()=>{rejectAck=true;});await page.evaluate(rows=>addWork('ack-retry',rows),[rows[0]]);
  await until(()=>document.querySelector('[data-neis-trip-notice]'));
  await until(()=>requests.some(m=>m.type==='NOTICE_VIEWED'&&m.refs.some(r=>r.id==='ack-retry')));
  assert.equal(await page.evaluate(()=>local.pendingPageNotices.length),1);
  await page.evaluate(()=>{rejectAck=false;});await page.clock.runFor(10000);
  await until(()=>local.pendingPageNotices.length===0);
  await page.getByRole('button',{name:'알림 닫기',exact:true}).click();
  console.log('PASS: a failed ACK remains durable, retries, and is not treated as read upon queue arrival.');

  await page.evaluate(()=>setView('hidden',false));await page.evaluate(rows=>addWork('account',rows),[rows[0]]);
  const ackCount=await page.evaluate(()=>requests.filter(m=>m.type==='NOTICE_VIEWED').length);
  await page.evaluate(()=>{document.querySelector('.topbar span').title='다른교사(other)';setView('visible',true);});
  await until(()=>!globalThis.__NEIS_TRIP_CONTENT_V2__?false:true);
  await page.clock.runFor(1000);assert.equal(await notice.count(),0);assert.equal(await page.evaluate(()=>requests.filter(m=>m.type==='NOTICE_VIEWED').length),ackCount);
  await page.evaluate(()=>{document.querySelector('.topbar span').title='가상교사(test)';rejectValidation=true;setView('hidden',false);});
  await page.evaluate(()=>ledger.replay(connection,snapshot));await page.evaluate(()=>setView('visible',true));await page.clock.runFor(1000);
  assert.equal(await notice.count(),0);assert.equal(await page.evaluate(()=>local.pendingPageNotices.length),1);
  await page.evaluate(async()=>{rejectValidation=false;await ledger.replay(connection,snapshot);});
  await until(()=>document.querySelector('[data-neis-trip-notice]'));
  await page.getByRole('button',{name:'알림 닫기',exact:true}).click();
  assert.deepEqual(await state(),before);assert.equal(navigations,0);assert.deepEqual(errors,[]);
  console.log('PASS: account switch and query failure cannot display stale work; recovery works without navigation or changing teacher input.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
