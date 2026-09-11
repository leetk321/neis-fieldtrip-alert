'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');

(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  try{
    const page=await browser.newPage({viewport:{width:390,height:720}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const at=Date.parse('2026-09-12T10:00:00+09:00');
      window.calls=[];
      window.uiState={ok:true,configured:true,connected:true,privacyConsented:true,autoStart:true,
        config:{year:'2026',grade:'2',classNo:'3',interval:5,excludedDates:[]},
        status:{state:'watching',count:0,lastCheck:at,message:'감시 중 · 미상신 1·2차 / 완결 체험 시작 알림'},
        report:{connected:true,privacyConsented:true,autoStart:true,status:{state:'watching',count:0,lastCheck:at,message:'보고서 감시 중 · 접수대기·미상신 최초 확인 시 1회'}},
        holidayInfo:{updatedAt:at,years:[2025,2026,2027]},
        alertLog:[{kind:'departure',title:'[교외체험학습 예정 알림]',createdAt:at,message:'체험 시작을 앞둔 학생 2명\n(1근무일 전 알림)\n\n• 가상학생 A\n  체험기간: 2026.09.14 ~ 2026.09.15\n• 가상학생 B\n  체험기간: 2026.09.14 ~ 2026.09.16'}]};
      window.chrome={storage:{onChanged:{addListener(fn){window.refreshUi=fn}}},runtime:{sendMessage:async m=>{
        calls.push(m);return m.type==='STATE'?structuredClone(uiState):{ok:true,count:2,checkedAt:at,pageShown:false};
      }}};
    });
    await page.goto(pathToFileURL(path.join(root,'popup.html')).href);
    await page.waitForFunction(()=>document.querySelector('#applicationSummary').textContent.includes('0건'));
    assert.equal(await page.locator('.watcher-panel[open]').count(),0);
    await page.locator('#applicationPanel>summary').click();
    await page.locator('#connect').click();
    assert.equal(await page.locator('#message').textContent(),'연결 준비 완료\n60초 안에 진행해 주세요.\n① 이 팝업을 닫으세요.\n② 나이스의 조회 버튼을 누르세요.');
    assert.equal(await page.locator('#message .copy-line').count(),4);
    assert.equal(await page.locator('#message').evaluate(el=>{
      const rows=[...el.querySelectorAll('.copy-line')].map(row=>row.getBoundingClientRect());
      return rows.slice(1).every((row,i)=>Math.abs(row.top-rows[i].bottom)<1);
    }),true,'explicit line breaks must not add blank lines');
    await page.locator('#queryTest').click();
    assert.match(await page.locator('#message').textContent(),/^조회 성공 · 현재 미상신 2건\n확인 일시: .+\n알림 이력은 변경하지 않았습니다\.$/);
    await page.locator('#reportPanel>summary').click();
    await page.locator('#reportConnect').click();
    assert.equal(await page.locator('#reportMessage .copy-line').count(),4);
    await page.locator('#reportQueryTest').click();
    assert.equal(await page.locator('#reportMessage').textContent(),'보고서 조회 성공 · 접수대기·미상신 2건\n알림 이력은 변경하지 않았습니다.');
    await page.locator('#test').click();
    assert.equal(await page.locator('#globalMessage .copy-sentence').count(),2);
    await page.evaluate(()=>document.querySelectorAll('details').forEach(el=>el.open=true));
    await page.locator('#reset').click();
    assert.equal(await page.locator('#globalMessage .copy-sentence').count(),3);
    await page.locator('#save').click();
    assert.equal(await page.locator('#globalMessage').textContent(),'설정을 저장했습니다.\n신청서와 보고서를 각각 다시 연결해 주세요.');
    const originalLog=await page.locator('#alertLog article p').textContent();
    assert.equal(originalLog,await page.evaluate(()=>uiState.alertLog[0].message));

    // Check layout using character ranges in the actual rendered Chrome popup.
    const layout=await page.evaluate(()=>{
      const box=document.querySelector('#globalMessage');
      setCopy(box,'완료했습니다. 연결은 유지됩니다.');
      const short=[...box.querySelectorAll('.copy-sentence')].map(el=>el.getBoundingClientRect().top);
      setCopy(box,'알림 기록만 초기화했습니다. 두 연결은 유지됩니다. 다음 확인에서 조건에 맞는 신청서와 보고서를 다시 알릴 수 있습니다.');
      const brokenWords=[];
      for(const parent of document.querySelectorAll('p,li')){
        const walker=document.createTreeWalker(parent,NodeFilter.SHOW_TEXT);
        for(let node;node=walker.nextNode();){
          for(const match of node.textContent.matchAll(/\S+/g)){
            const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
            const tops=new Set([...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>Math.round(r.top)));
            if(tops.size>1)brokenWords.push(match[0]);
          }
        }
      }
      const fittingSplits=[];
      for(const sentence of document.querySelectorAll('.copy-sentence')){
        const style=getComputedStyle(sentence),width=sentence.parentElement.getBoundingClientRect().width;
        if(!sentence.getBoundingClientRect().width)continue;
        const probe=sentence.cloneNode(true);probe.style.cssText='position:fixed;visibility:hidden;white-space:nowrap;max-width:none;font:'+style.font;
        document.body.append(probe);const natural=probe.getBoundingClientRect().width;probe.remove();
        if(natural<=width&&sentence.getBoundingClientRect().height>parseFloat(style.lineHeight)+1)fittingSplits.push(sentence.textContent);
      }
      const long=box.querySelector('.copy-sentence:last-child'),longWrap=long.getBoundingClientRect().height>parseFloat(getComputedStyle(long).lineHeight)*1.5;
      return {short,brokenWords,fittingSplits,longWrap,overflow:document.documentElement.scrollWidth>390};
    });
    assert.equal(layout.short[0],layout.short[1],'short sentences share a line');
    assert.deepEqual(layout.brokenWords,[],'words must not split across lines');
    assert.deepEqual(layout.fittingSplits,[],'fitting sentences stay on one line');
    assert.equal(layout.longWrap,true);assert.equal(layout.overflow,false);
    await page.evaluate(()=>setCopy(document.querySelector('#globalMessage'),'<img src=x onerror=alert(1)> 안내입니다.'));
    assert.equal(await page.locator('#globalMessage img').count(),0);
    await page.locator('#reset').click();
    // Render the two connection guides for review; only synthetic Chrome API calls occur.
    await page.locator('#connect').click();await page.locator('#reportConnect').click();
    await page.evaluate(()=>{
      document.querySelector('.calendar-settings').open=false;
      document.querySelector('main>details:last-of-type').open=false;
    });
    if(process.env.POPUP_SCREENSHOT)await page.screenshot({path:process.env.POPUP_SCREENSHOT,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: popup actions, sentence packing, word wrapping, explicit newlines, no horizontal overflow, literal text, original alert copy.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
