'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')).version;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:780}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(version=>{
   window.fixture={ok:true,configured:true,connected:true,privacyConsented:true,autoStart:true,notificationPermission:'granted',config:{year:'2026',grade:'1',classNo:'10',interval:5,excludedDates:[]},
    status:{state:'watching',count:0,message:'감시 중 · 미상신 1·2차 / 완결 체험 시작 알림'},
    report:{connected:true,privacyConsented:true,autoStart:true,status:{state:'watching',count:1,message:'보고서 감시 중 · 접수대기·미상신 최초 확인 시 1회'}},
    deadline:{state:'watching',count:2,lastCheck:Date.parse('2026-09-21T09:00:00+09:00'),message:'종료 후 5번째 근무일부터 미제출·미상신 확인'},
    alertLog:[{kind:'deadline',title:'[체험학습 보고서 처리 확인]',message:'종료 후 5근무일에 도달한 체험학습 2건\n\n• 가상학생 A — 보고서 미제출\n  체험기간: 2026-09-07 ~ 2026-09-09\n  확인 기준일: 2026-09-16\n• 가상학생 B — 보고서 미상신\n  체험기간: 2026-09-10 ~ 2026-09-11\n  확인 기준일: 2026-09-18',page:{version:1,viewedAt:null},delivery:{state:'requested'}}]};
   window.chrome={runtime:{getManifest:()=>({version}),sendMessage:async()=>structuredClone(fixture)},storage:{onChanged:{addListener:f=>window.renderFixture=f}}};
  },version);
  await page.goto(pathToFileURL(path.join(root,'popup.html')).href);
  await page.waitForFunction(()=>document.querySelector('#deadlineState').textContent.includes('2건'));
  assert.equal(await page.locator('#version').textContent(),version);
  await page.locator('#reportPanel>summary').click();
  assert.match(await page.locator('.deadline-rules').textContent(),/재연결이나 설정 저장 없이/);
  assert.equal(await page.locator('#alertLog article[data-kind="deadline"]').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>390),false);
  assert.equal(await page.locator('#deadlineState').textContent(),'보고서 기한 확인 중 · 대상 2건');
  if(process.env.DEADLINE_SCREENSHOT){await page.evaluate(()=>document.querySelector('#applicationPanel').open=false);await page.screenshot({path:process.env.DEADLINE_SCREENSHOT,fullPage:true});}
  await page.evaluate(()=>{fixture.deadline={state:'waiting',message:'기한 알림 대기 · 전체 건수와 응답 행수가 달라 보고서 기한 판단을 보류합니다.'};renderFixture();});
  await page.waitForFunction(()=>document.querySelector('#deadlineState').textContent==='보고서 기한 확인 대기');
  assert.equal(await page.locator('#deadlineChecked').textContent(),'');assert.deepEqual(errors,[]);
  console.log('PASS: actual manifest version, no-reconnect guidance, deadline count and reasons, failure state, no overflow or browser errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
