/* Optional browser check: npm install --no-save playwright, then node scripts/verify-notice.cjs.
 * Set CHROME_PATH to use an installed Chrome and NOTICE_SCREENSHOT to save a preview.
 * Uses only a synthetic local document, never a user's browser profile or NEIS session.
 */
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1080,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<style>body{margin:0;background:#f3f7f6;font:16px sans-serif}.work{margin:220px 40px 0;width:440px;padding:24px;background:white;border:1px solid #ddd;border-radius:12px}textarea{width:100%;height:150px;font:16px/1.7 sans-serif}.space{height:1600px}</style><div class="work"><h1>입력 보존 확인 · 가상 화면</h1><p>실제 나이스·학생 데이터가 없는 테스트 화면입니다.</p><form><textarea id="draft" aria-label="작성 중인 내용"></textarea><button type="submit">업무 저장</button></form></div><div class="space"></div>');
    await page.evaluate(version=>{
      window.TripCore={};window.messages=[];window.currentVersion=version;window.submitCount=0;window.blurs=0;
      window.contentListeners=new Set();window.hostClicks=0;window.hostKeys=0;
      document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submitCount++;});
      document.addEventListener('click',()=>hostClicks++);document.addEventListener('keydown',()=>hostKeys++);
      document.querySelector('#draft').addEventListener('blur',()=>blurs++);
      window.chrome={runtime:{id:'notice-test',getManifest:()=>({version:currentVersion}),sendMessage:async m=>{messages.push(m);return {ok:true,allowed:false}},onMessage:{addListener:fn=>contentListeners.add(fn),removeListener:fn=>contentListeners.delete(fn)}}};
      window.requestNotice=text=>new Promise(resolve=>[...contentListeners][0]({type:'NOTICE',...text},{id:'notice-test'},resolve));
      window.originalDraft=document.querySelector('#draft');
    },version);
    await page.addScriptTag({path:path.join(root,'content.js')});
    await page.locator('#draft').fill('저장 전 작성 중인 내용입니다.\n입력값과 커서 위치를 보존합니다.');
    await page.evaluate(()=>{const el=document.querySelector('#draft');el.focus();el.setSelectionRange(3,8);window.scrollTo(0,180);});
    const state=()=>page.evaluate(()=>({value:originalDraft.value,start:originalDraft.selectionStart,end:originalDraft.selectionEnd,scroll:scrollY,focused:document.activeElement===originalDraft,sameNode:document.querySelector('#draft')===originalDraft}));
    const before=await state();let navigations=0;page.on('framenavigated',()=>navigations++);
    const notice=page.locator('[data-neis-trip-notice]'),close=page.getByRole('button',{name:'알림 닫기',exact:true});
    const show=(kind,text)=>page.evaluate(({kind,text})=>requestNotice({kind,text}),{kind,text});
    for(const [kind,color] of [['first','rgb(18, 60, 70)'],['reminder','rgb(18, 60, 70)'],['departure','rgb(100, 61, 165)'],['report','rgb(173, 79, 21)'],['info','rgb(18, 60, 70)']]){
      await show(kind,'가상 알림\n대상 학생: 예시학생');
      assert.equal(await notice.evaluate(el=>getComputedStyle(el).backgroundColor),color);
      assert.deepEqual(await state(),before,'Showing a notice changed the draft, caret, focus or page scroll');
      const counters=await page.evaluate(()=>({blurs,hostClicks,submitCount,messages:messages.length}));
      await close.click();assert.equal(await notice.count(),0);assert.deepEqual(await state(),before);
      assert.deepEqual(await page.evaluate(()=>({blurs,hostClicks,submitCount,messages:messages.length})),counters,'Dismissal leaked a click, blurred an input or changed worker state');
    }
    // Close remains outside the scroller, even for many student names.
    await show('report','2학년 3반 · 새 보고서\n\n새로 확인한 교외체험학습 보고서\n접수대기 · 미상신\n\n대상 학생\n'+Array.from({length:35},(_,i)=>'• 가상학생 '+(i+1)).join('\n'));
    const closeBefore=await close.boundingBox();
    const scrolling=await notice.locator('[role="status"]').evaluate(el=>{el.scrollTop=el.scrollHeight;return {scroll:el.scrollTop,needed:el.scrollHeight>el.clientHeight};});
    assert.ok(scrolling.needed&&scrolling.scroll>0);assert.deepEqual(await close.boundingBox(),closeBefore);
    assert.deepEqual(await state(),before);
    if(process.env.NOTICE_SCREENSHOT){await notice.locator('[role="status"]').evaluate(el=>el.scrollTop=0);await page.screenshot({path:process.env.NOTICE_SCREENSHOT});}
    await close.click();
    // Keyboard dismissal returns to the former input without moving its caret or scrolling.
    for(const key of ['Enter','Space']){
      await show('departure','완결 신청서\n체험기간: 예시 기간');await close.focus();
      assert.equal(await close.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
      const hostKeys=await page.evaluate(()=>window.hostKeys);await page.keyboard.press(key);
      assert.equal(await notice.count(),0);assert.deepEqual(await state(),before);
      assert.equal(await page.evaluate(()=>window.hostKeys),hostKeys);assert.equal(await page.evaluate(()=>submitCount),0);
    }
    // Timer cancellation: closing an old notice must not expire the next notice early.
    await page.clock.install();await show('first','첫 번째');await show('report','두 번째');
    await page.clock.runFor(5000);await close.click();assert.match(await notice.textContent(),/두 번째/);
    await page.clock.runFor(10001);assert.equal(await notice.count(),1);
    await page.clock.runFor(4999);assert.equal(await notice.count(),0);assert.deepEqual(await state(),before);
    // An update cleans up the old notice/listener without refreshing or replacing the draft.
    await show('first','업데이트 전 알림');await page.evaluate(()=>currentVersion='next-version');
    await page.addScriptTag({path:path.join(root,'content.js')});assert.equal(await notice.count(),0);
    assert.equal(await page.evaluate(()=>contentListeners.size),1);assert.deepEqual(await state(),before);
    await show('report','업데이트 후 알림');await close.click();assert.deepEqual(await state(),before);
    // Narrow windows keep the close control visible and the banner inside the viewport.
    await page.setViewportSize({width:360,height:640});await show('report','긴알림'.repeat(150));
    const box=await notice.boundingBox(),button=await close.boundingBox();
    assert.ok(box.x>=0&&box.x+box.width<=360);assert.ok(button.y>=box.y&&button.y+button.height<=box.y+box.height);
    await close.click();assert.equal(await notice.count(),0);
    assert.equal(navigations,0);assert.deepEqual(errors,[]);
    console.log('PASS: five notice kinds; mouse/keyboard close; draft/caret/focus/scroll preserved; close visible for long/narrow content; timer/queue cleanup; update reinjection; no navigation, host clicks, submits or browser errors.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
