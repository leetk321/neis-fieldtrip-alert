/* Controlled visibility/focus and clock in an isolated Chrome page; no live NEIS access. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1080,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));let navigations=0;
    await page.setContent('<style>body{margin:0}textarea{margin:80px;width:400px;height:120px}.space{height:1500px}</style><textarea id="draft"></textarea><div class="space"></div>');
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now()+1000));
    await page.evaluate(version=>{
      window.TripCore={};window.currentVersion=version;window.contentListeners=new Set();
      window.visibility='visible';window.windowFocused=true;window.requests=[];
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});
      document.hasFocus=()=>windowFocused;
      window.setView=(state,focused)=>{
        visibility=state;windowFocused=focused;
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event(focused?'focus':'blur'));
      };
      window.chrome={runtime:{id:'visibility-test',getManifest:()=>({version:currentVersion}),
        sendMessage:async m=>{requests.push(m);return {ok:true,allowed:false};},
        onMessage:{addListener:fn=>contentListeners.add(fn),removeListener:fn=>contentListeners.delete(fn)}}};
      window.sendNotice=(text,alertId)=>new Promise(resolve=>[...contentListeners][0](
        {type:'NOTICE',text,kind:'report',alertId},{id:'visibility-test'},resolve));
    },version);
    await page.addScriptTag({path:path.join(root,'content.js')});
    await page.locator('#draft').fill('수업 준비 중 작성한 내용\n선택 범위를 유지합니다.');
    await page.evaluate(()=>{draft.focus();draft.setSelectionRange(2,7);scrollTo(0,60);window.originalDraft=draft;});
    const state=()=>page.evaluate(()=>({value:draft.value,start:draft.selectionStart,end:draft.selectionEnd,scroll:scrollY,same:draft===originalDraft,focused:document.activeElement===draft}));
    const before=await state();page.on('framenavigated',()=>navigations++);
    const notice=page.locator('[data-neis-trip-notice]');
    const text=()=>notice.locator('[role="status"]').textContent();
    const show=(label,id)=>page.evaluate(({label,id})=>sendNotice(label,id),{label,id});
    const view=(visibility,focused)=>page.evaluate(({visibility,focused})=>setView(visibility,focused),{visibility,focused});
    const close=()=>page.getByRole('button',{name:'알림 닫기',exact:true}).click();

    await view('hidden',false);
    await show('대기 A (변경 전)','a');await show('대기 B','b');await show('대기 A (최신 내용)','a');
    assert.equal(await notice.count(),0,'hidden arrivals must not create DOM');
    await page.clock.runFor(7*60*1000);
    assert.equal(await notice.count(),0,'hidden queue survives seven minutes');
    await view('visible',false);
    await page.clock.runFor(60*1000);
    assert.equal(await notice.count(),0,'visible background Chrome window still waits for focus');
    await view('visible',true);
    assert.equal(await text(),'대기 A (최신 내용)');
    await page.clock.runFor(14999);assert.equal(await text(),'대기 A (최신 내용)');
    await page.clock.runFor(1);assert.equal(await text(),'대기 B');
    await page.clock.runFor(14999);assert.equal(await text(),'대기 B');
    await page.clock.runFor(1);assert.equal(await notice.count(),0);
    await show('소비한 A 재시도','a');assert.equal(await notice.count(),0);
    assert.deepEqual(await state(),before);
    console.log('PASS: hidden queue, seven-minute return, focused-window requirement, FIFO 15 seconds, retry deduplication/current copy.');

    for(const transition of [['hidden',false],['visible',false],['hidden',true]]){
      const id=transition.join('-');
      await show('중간에 멈추는 알림',id);
      await page.clock.runFor(5000);
      await view(...transition);
      assert.equal(await notice.count(),1);assert.equal(await notice.isVisible(),false);
      await show('그 다음 알림',id+'-next');
      await page.clock.runFor(7*60*1000);
      assert.equal(await notice.count(),1,'inactive timer must not consume or render the next notice');
      await view('visible',true);
      assert.equal(await text(),'중간에 멈추는 알림');
      await page.clock.runFor(9999);assert.equal(await text(),'중간에 멈추는 알림');
      await page.clock.runFor(1);assert.equal(await text(),'그 다음 알림');
      await page.clock.runFor(14999);assert.equal(await text(),'그 다음 알림');
      await page.clock.runFor(1);assert.equal(await notice.count(),0);
      assert.deepEqual(await state(),before);
    }
    console.log('PASS: partial timer pauses for hidden tabs, other apps, and minimized-style state; remaining time resumes.');

    await show('중복 포커스 이벤트','focus');
    await page.clock.runFor(5000);await view('visible',true);
    await page.clock.runFor(9999);assert.equal(await notice.count(),1);
    await page.clock.runFor(1);assert.equal(await notice.count(),0);
    await view('hidden',false);await show('닫기 전 A','close-a');await show('닫기 후 B','close-b');
    await view('visible',true);await page.clock.runFor(5000);await close();
    assert.equal(await text(),'닫기 후 B');
    await page.clock.runFor(10001);assert.equal(await notice.count(),1);
    await page.clock.runFor(4999);assert.equal(await notice.count(),0);
    assert.deepEqual(await state(),before);
    console.log('PASS: repeated focus does not extend timers; closing preserves the next full duration and input state.');

    await view('hidden',false);await show('정리할 대기 알림','disposed');
    await page.evaluate(()=>globalThis.__NEIS_TRIP_CONTENT_V2__.dispose());
    await view('visible',true);await page.clock.runFor(20000);
    assert.equal(await notice.count(),0);assert.equal(await page.evaluate(()=>contentListeners.size),0);
    await page.addScriptTag({path:path.join(root,'content.js')});
    assert.equal(await page.evaluate(()=>contentListeners.size),1);
    await show('새 연결의 알림','new');assert.equal(await text(),'새 연결의 알림');await close();
    assert.deepEqual(await state(),before);
    assert.equal(navigations,0);assert.deepEqual(errors,[]);
    console.log('PASS: disposal removes queue/timers/listeners; reinjection is single; no refresh, navigation, input/caret/scroll/focus changes.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
