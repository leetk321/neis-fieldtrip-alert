'use strict';
importScripts('calendar.js','core.js','holiday-sync.js','tab-bridge.js','report-watcher.js');
const holidaySync=HolidaySync.create(chrome.storage.local,TripCalendar,typeof fetch==='function'?fetch.bind(globalThis):undefined);
const C=TripCore, ALARM='trip-poll';
const defaults={year:C.schoolYear(),grade:'',classNo:'',interval:5,excludedDates:[]};
const storageReady=chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
storageReady.catch(()=>{});
let queue=Promise.resolve();
const serial=fn=>{const run=async()=>{await storageReady;try{return await fn();}finally{await maintainRecoveryAlarm().catch(()=>{});}};const p=queue.then(run,run);queue=p.catch(()=>{});return p;};
const session=async()=> (await chrome.storage.session.get('connection')).connection;
const config=async()=> (await chrome.storage.local.get('config')).config||defaults;
const profile=async()=> (await chrome.storage.local.get('watchProfile')).watchProfile;
const consented=async()=> (await chrome.storage.local.get('privacyConsent')).privacyConsent?.version===1;
const bridge=TripTabBridge.create(chrome);
const reports=TripReportWatcher.create({chrome,core:C,setup,consented,validatedProfile,logAlert,showPageNotice,watchingNeis,ensureTab:bridge.ensure});
const RECOVERY_ALARM='trip-reconnect';
async function applicationNeedsResume(){return !!(await consented()&&(await profile())?.enabled&&!await session());}
async function maintainRecoveryAlarm(){
  const needed=await applicationNeedsResume()||await reports.needsResume();
  if(!needed){await chrome.alarms.clear(RECOVERY_ALARM);return;}
  if(!await chrome.alarms.get(RECOVERY_ALARM))await chrome.alarms.create(RECOVERY_ALARM,{periodInMinutes:1,delayInMinutes:1});
}
async function setup(){
  const value=await config();
  try{return {config:C.config(value),configured:true};}
  catch{return {config:defaults,configured:false};}
}
const status=async value=>chrome.storage.local.set({status:{...value,updatedAt:Date.now()}});
async function badge(text,color='#126b68'){await chrome.action.setBadgeText({text});await chrome.action.setBadgeBackgroundColor({color});}
async function logAlert(kind,title,message) {
  const stored=(await chrome.storage.local.get('alertLog')).alertLog;
  const alertLog=Array.isArray(stored)?stored:[];
  const item={id:crypto.randomUUID(),kind,title,message,createdAt:Date.now()};
  await chrome.storage.local.set({alertLog:[item,...alertLog].slice(0,20)});
  return item;
}
async function showPageNotice(connection,text,kind) {
  if(!connection?.tabId)return false;
  try {const result=await chrome.tabs.sendMessage(connection.tabId,{type:'NOTICE',text,kind});return result?.ok===true;}
  catch {return false;}
}
async function clearConnection(reason) {
  await chrome.alarms.clear(ALARM);
  await chrome.storage.session.remove(['connection','arm']);
  await status({state:'disconnected',message:reason});await badge('!','#995414');
}
async function waitForNeis(reason) {
  await chrome.alarms.clear(ALARM);
  await chrome.storage.session.remove(['connection','arm']);
  await status({state:'waiting',message:reason});await badge('…','#496a70');
}
function validatedProfile(value) {
  if(!value||value.enabled!==true||!value.template||!/^[a-f0-9]{64}$/.test(value.identity||''))throw Error('저장된 자동 연결 정보가 없습니다.');
  const origin=new URL(value.origin).origin;
  if(!/^https:\/\/[^/]+\.neis\.go\.kr$/.test(origin))throw Error('저장된 나이스 주소를 확인할 수 없습니다.');
  C.endpoint(value.template.endpoint,origin);
  if(typeof value.template.body!=='string'||value.template.body.length>512000)throw Error('저장된 조회 조건을 확인할 수 없습니다.');
  const parsed=JSON.parse(value.template.body);
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('저장된 조회 조건을 확인할 수 없습니다.');
  const allowed=new Set(['accept','content-type','x-requested-with','ui']);
  if(!value.template.headers||Object.entries(value.template.headers).some(([k,v])=>!allowed.has(k.toLowerCase())||typeof v!=='string'))throw Error('저장된 조회 헤더를 확인할 수 없습니다.');
  value.config=C.config(value.config);
  return value;
}
async function resumeFromPage(tabId,pageUrl,identity) {
  if(!await consented())return {resumed:false};
  const saved=await profile();
  if(!saved?.enabled)return {resumed:false};
  let p;try{p=validatedProfile(saved);}catch(e){await clearConnection('자동 연결 정보 오류 · '+e.message);return {resumed:false};}
  const origin=new URL(pageUrl).origin;
  if(origin!==p.origin||identity!==p.identity)return {resumed:false};
  const current=await session();
  if(current?.tabId===tabId&&current.identity===identity)return {resumed:false,already:true};
  const connection={tabId,identity:p.identity,origin:p.origin,config:p.config,template:p.template,automatic:true};
  await chrome.storage.session.set({connection});
  await status({state:'connecting',message:'나이스 탭을 확인하여 감시를 자동으로 재개하는 중입니다.'});
  await poll();
  const s=(await chrome.storage.local.get('status')).status;
  if(['watching','learning'].includes(s?.state)){
    await chrome.alarms.create(ALARM,{periodInMinutes:connection.config.interval,delayInMinutes:connection.config.interval});
    return {resumed:true};
  }
  return {resumed:false};
}
async function probeOpenTabs(){
  if(!await consented())return;
  const pending=await chrome.storage.session.get(['arm','reportArm']);
  if([pending.arm,pending.reportArm].some(a=>a?.until>Date.now()))return;
  if(!await applicationNeedsResume()&&!await reports.needsResume())return;
  const saved=await profile();
  const tabs=await chrome.tabs.query({url:'https://*.neis.go.kr/*'});
  for(const tab of tabs){
    if(!tab.id)continue;
    try{
      const application=await applicationNeedsResume()&&new URL(tab.url).origin===saved?.origin;
      const report=await reports.needsResume()&&await reports.canIdentify(tab.url);
      if((!application&&!report)||!await bridge.ensure(tab))continue;
      const who=await chrome.tabs.sendMessage(tab.id,{type:'WHO',origin:new URL(tab.url).origin});if(!who?.ok)continue;
      if(application)await resumeFromPage(tab.id,tab.url,who.identity);
      if(report)await reports.resume(tab.id,tab.url,who.identity);
    }catch{}
    if(!await applicationNeedsResume()&&!await reports.needsResume())return;
  }
}
async function watchingNeis(connection){
  try{
    const tab=await chrome.tabs.get(connection.tabId);
    const win=await chrome.windows.get(tab.windowId);
    return tab.active===true&&win.focused===true&&win.state!=='minimized';
  }catch{return false;}
}
async function notify(rows,stage,connection,combined=[]) {
  const count=rows.length;
  if(!count)return true;
  const names={first:'[1차 알림]',reminder:'[2차 알림]',departure:'[교외체험학습 예정 알림]'};
  const combinedCount=stage==='reminder'?rows.filter(row=>combined.includes(row.key)).length:0;
  const title=combinedCount?'[1, 2차 통합 알림]':names[stage];
  let message=stage==='first'?`새 교외체험학습 신청서 ${count}건`:stage==='reminder'?`아직 처리되지 않은 신청서 ${count}건\n(체험 시작 전 5근무일 이내)`:`체험 시작을 앞둔 학생 ${count}명\n(1근무일 전 알림)`;
  if(combinedCount===count)message=`새 교외체험학습 신청서 ${count}건\n(체험 시작 전 5근무일 이내, 빠른 처리 필요)`;
  else if(combinedCount)message+=`\n\n※ ${count}건 중 ${combinedCount}건은 새 신청서임`;
  message+='\n\n'+rows.map(r=>'• '+String(r.studentName||'이름 확인 필요').replace(/[\r\n\t]+/g,' ')+(stage==='departure'?'\n  체험기간: '+String(r.period||r.startDate||'기간 확인 필요').replace(/[\r\n\t]+/g,' '):'')).join('\n');
  try {await logAlert(stage,title,message);} catch {return false;}
  if(!await watchingNeis(connection)){
    try{await chrome.notifications.create('trip-'+stage,{type:'basic',iconUrl:stage==='departure'?'icon-departure.png':'icon.png',title,message,priority:0});}catch{}
  }
  await showPageNotice(connection,`${title}\n${message}`,stage);
  return true;
}
function validatedSnapshot(s) {
  if(!s||!Array.isArray(s.records)||s.records.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.key)||!['접수대기','접수','접수취소'].includes(r.receipt)||typeof r.unsubmitted!=='boolean'||!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate||''))||s.records.filter(r=>r.unsubmitted).length!==s.count||new Set(s.records.map(r=>r.key)).size!==s.records.length)throw Error('조회 결과 형식을 확인할 수 없습니다.');
  if(s.departures!==undefined&&(!Array.isArray(s.departures)||s.departures.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.key)||!/^\d{4}-\d{2}-\d{2}$/.test(r.startDate||''))||new Set(s.departures.map(r=>r.key)).size!==s.departures.length))throw Error('완결 신청서 형식을 확인할 수 없습니다.');
  return s;
}
async function requestSnapshot(connection) {
  if(!await consented())throw Error('1.5.4 개인정보 처리 안내에 동의한 뒤 다시 연결하세요.');
  const response=await chrome.tabs.sendMessage(connection.tabId,{type:'POLL',...connection});
  if(!response?.ok)throw Error(response?.error||'나이스 탭을 새로고침하고 다시 연결하세요.');
  return validatedSnapshot(response.snapshot);
}
async function applySnapshot(s,connection) {
  validatedSnapshot(s);
  await holidaySync.load().catch(()=>{});
  if(s.learnedSchema&&connection.template.schema.pending){
    if(s.learnedSchema.pending||!Array.isArray(s.learnedSchema.path)||!Array.isArray(s.learnedSchema.identity)||typeof s.learnedSchema.approval!=='string'||typeof s.learnedSchema.startDate!=='string')throw Error('학습된 응답 구조를 확인할 수 없습니다.');
    connection.template={...connection.template,schema:s.learnedSchema};
    const saved=await profile();if(saved)await chrome.storage.local.set({watchProfile:{...saved,template:connection.template}});
  }
  if(s.awaitingSchema){
    if(!connection.template.schema.pending)throw Error('잘못된 학습 대기 응답입니다.');
    await chrome.storage.session.set({connection});
    await status({state:'learning',count:null,lastCheck:Date.now(),message:s.needsConfirmation?'신청서 데이터가 발견되었습니다. 전체 건수 확인을 위해 신청서관리에서 연결 시작 후 조회를 한 번 눌러 주세요.':'연결 조건 저장 완료 · 첫 신청서 학습 대기 중입니다.',identityMode:'스키마 미확정'});
    await badge(s.needsConfirmation?'!':'…');return;
  }
  if(connection.template.schema.pending)throw Error('스키마가 아직 확정되지 않았습니다.');
  const c=connection.config, scope=`${connection.identity}:${c.year}:${c.grade}:${c.classNo}`;
  const stored=await chrome.storage.local.get(['alertHistories','history']);
  const histories=stored.alertHistories||{};
  if(!histories[scope]){
    histories[scope]={};
    // Keep the previous version's available first-alert record; intervals never define identity.
    const legacy=stored.history;
    try{
      const oldConfig=JSON.parse(legacy.key.slice(connection.identity.length+1));
      if(legacy.key.startsWith(connection.identity+':')&&['year','grade','classNo'].every(k=>String(oldConfig[k])===String(c[k])))
        for(const key of legacy.keys)if(/^[a-f0-9]{64}$/.test(key))histories[scope][key]={observed:true,firstSent:true};
    }catch{}
  }
  const plan=C.plan(s.records,histories[scope],TripCalendar.today(),c.excludedDates||[],s.departures||[]);
  histories[scope]=plan.history;
  connection.count=s.count;connection.lastCheck=Date.now();
  // Store all observed applications, including completed/canceled ones, across successful empty queries.
  await chrome.storage.local.set({alertHistories:histories});
  await chrome.storage.session.set({connection});
  let alertFailed=false;
  for(const stage of ['first','reminder','departure']){
    const keys=plan[stage];if(!keys.length)continue;
    if(await notify((stage==='departure'?(s.departures||[]):s.records).filter(r=>keys.includes(r.key)),stage,connection,plan.combined)){
      for(const key of keys){
        const entry=histories[scope][key];
        entry[stage+'Sent']=true;
        if(stage==='first'||(stage==='reminder'&&plan.combined.includes(key))){entry.firstSent=true;entry.firstPending=false;}
      }
      await chrome.storage.local.set({alertHistories:histories});
    }else alertFailed=true;
  }
  const nextDates=plan.dueDates.filter(d=>!histories[scope][d.key].reminderSent).map(d=>d.date).sort();
  const message=plan.warnings.length?'감시 중 · 2차 알림 계산 확인 필요: '+plan.warnings.join(' '):alertFailed?'감시 중 · 알림 기록 저장 실패. 다음 조회에서 재시도합니다.':'감시 중 · 미상신 1·2차 / 완결 체험 시작 알림';
  await status({state:'watching',message,count:s.count,total:s.total,lastCheck:connection.lastCheck,identityMode:connection.template.schema.identityMode,nextReminder:nextDates[0]||null,calendarWarning:plan.warnings.length>0});
  await badge(s.count?String(Math.min(s.count,999)):'');
}
async function poll() {
  const connection=await session();
  if(!connection)return;
  try {
    await applySnapshot(await requestSnapshot(connection),connection);
  }catch(e){
    await chrome.alarms.clear(ALARM);
    await chrome.storage.session.remove('connection');
    await status({state:'paused',message:'감시 중지 · '+e.message,count:connection.count,lastCheck:connection.lastCheck});
    await badge('!','#995414');
  }
}
const HOLIDAY_ALARM='holiday-refresh';
async function prepareHolidays(){
  await chrome.alarms.create(HOLIDAY_ALARM,{periodInMinutes:60,delayInMinutes:60});
  await holidaySync.refresh().catch(()=>{});
}
chrome.alarms.onAlarm.addListener(a=>{
  if(a.name===RECOVERY_ALARM)return serial(probeOpenTabs);
  if(a.name===reports.ALARM)return serial(reports.poll);
  if(a.name===ALARM)return serial(poll);
  if(a.name===HOLIDAY_ALARM)return serial(()=>holidaySync.refresh().catch(()=>{}));
});
chrome.runtime.onInstalled.addListener(details=>serial(async()=>{
  await reports.startup();
  const current=await setup();
  const saved=await profile();
  if(current.configured&&saved?.enabled)await waitForNeis('저장된 연결을 유지하고 나이스 감시를 자동으로 재개합니다.');
  else await clearConnection(current.configured?'나이스 신청서관리 화면에서 조회 연결을 시작하세요.':'먼저 알림을 받을 학년도·학년·반을 설정하고 저장하세요.');
  await probeOpenTabs();
  if(details?.reason==='install')await chrome.tabs.create({url:chrome.runtime.getURL('welcome.html')});
  await prepareHolidays();
}));
chrome.runtime.onStartup.addListener(()=>serial(async()=>{
  await reports.startup();
  if((await profile())?.enabled)await waitForNeis('로그인된 나이스 탭을 찾고 있습니다.');
  else await clearConnection('자동 재개가 꺼져 있습니다. 나이스에서 조회를 다시 연결하면 켜집니다.');
  await probeOpenTabs();
  await prepareHolidays();
}));
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{
  if(change.status!=='loading'&&change.status!=='complete')return;
  return serial(async()=>{
    if(change.status==='loading'){
      await reports.removed(tabId);
      if((await session())?.tabId===tabId)await waitForNeis('나이스 화면이 준비되면 저장된 조건으로 자동 연결합니다.');
    }else if(/^https:\/\/[^/]+\.neis\.go\.kr\//.test(tab.url||''))await probeOpenTabs();
  });
});
chrome.tabs.onRemoved.addListener(tabId=>serial(async()=>{
  await reports.removed(tabId);
  if((await session())?.tabId!==tabId)return;
  if((await profile())?.enabled)await waitForNeis('나이스 탭이 다시 열리면 감시를 자동으로 재개합니다.');
  else await clearConnection('연결된 나이스 탭이 닫혔습니다.');
}));

chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  serial(async()=>{
    const internal=sender.id===chrome.runtime.id&&!sender.tab;
    const page=sender.id===chrome.runtime.id&&sender.frameId===0&&/^https:\/\/[^/]+\.neis\.go\.kr\//.test(sender.url||'');
    const reportResult=await reports.handle(message,sender,internal,page);if(reportResult)return reportResult;
    if(message.type==='CAN_IDENTIFY'){
      if(!page)throw Error('잘못된 발신자입니다.');
      const saved=await profile();
      return {ok:true,allowed:!!(await consented()&&saved?.enabled===true&&saved.origin===new URL(sender.url).origin)||await reports.canIdentify(sender.url)};
    }
    if(message.type==='PAGE_READY') {
      if(!page)throw Error('잘못된 발신자입니다.');
      const pending=await chrome.storage.session.get(['arm','reportArm']);
      if([pending.arm,pending.reportArm].some(a=>a?.until>Date.now()))return {ok:true,resumed:false,waitingForCapture:true};
      const application=await resumeFromPage(sender.tab.id,sender.url,message.identity);
      const report=await reports.resume(sender.tab.id,sender.url,message.identity);
      return {ok:true,...application,reportResumed:report.resumed};
    }
    if(message.type==='CAPTURE'||message.type==='CAPTURE_ERROR') {
      if(!page)throw Error('잘못된 발신자입니다.');
      if(!await consented())throw Error('개인정보 처리 안내에 동의한 뒤 연결하세요.');
      const arm=(await chrome.storage.session.get('arm')).arm;
      if(!arm||arm.tabId!==sender.tab.id||Date.now()>arm.until)throw Error('연결 시간이 지났습니다. 다시 시작하세요.');
      if(message.type==='CAPTURE_ERROR'){await status({state:'connecting',message:message.error});return {ok:true};}
      if(message.nonce!==arm.nonce||message.identity!==arm.identity)throw Error('학교·계정 또는 연결 정보가 일치하지 않습니다.');
      C.endpoint(message.template.endpoint,new URL(sender.url).origin);
      const connection={tabId:sender.tab.id,identity:arm.identity,origin:new URL(sender.url).origin,config:arm.config,template:message.template};
      const savedProfile=validatedProfile({identity:connection.identity,origin:connection.origin,config:connection.config,template:connection.template,enabled:true,savedAt:Date.now()});
      validatedSnapshot(message.snapshot);
      await chrome.storage.local.set({watchProfile:savedProfile});
      await applySnapshot(message.snapshot,connection,true);
      await chrome.storage.session.remove('arm');
      await chrome.alarms.create(ALARM,{periodInMinutes:connection.config.interval,delayInMinutes:connection.config.interval});
      return {ok:true};
    }
    if(!internal)throw Error('확장 프로그램에서만 실행할 수 있습니다.');
    if(message.type==='STATE') {
      const reportState=await reports.getState();
      const stored=await chrome.storage.local.get(['status','alertLog','holidayCache']);
      const saved=stored.status;
      const conn=await session();
      const current=await setup();
      const savedProfile=await profile();
      return {ok:true,...current,report:reportState,privacyConsented:await consented(),holidayInfo:{updatedAt:stored.holidayCache?.updatedAt||null,years:stored.holidayCache?.years||[],failed:!!stored.holidayCache?.error},status:!await consented()?{state:'disconnected',message:'개인정보 처리 안내에 동의하고 나이스 조회를 다시 연결하세요.'}:!current.configured?{state:'setup',message:'먼저 알림을 받을 학년도·학년·반을 설정하고 저장하세요.'}:saved?.state==='paused'||saved?.state==='connecting'?saved:!conn&&savedProfile?.enabled?{state:'waiting',message:'로그인된 나이스 탭이 열리면 자동으로 감시를 재개합니다.'}:!conn&&saved?.state==='watching'?{state:'disconnected',message:'연결을 다시 시작하세요.'}:saved,connected:!!conn,autoStart:savedProfile?.enabled===true,alertLog:Array.isArray(stored.alertLog)?stored.alertLog.slice(0,20):[]};
    }
    if(message.type==='SAVE') {
      const next=C.config(message.config);
      await reports.invalidate();
      await chrome.storage.local.set({config:next});
      await chrome.storage.local.remove('watchProfile');
      await clearConnection('설정이 저장되었습니다. 나이스 조회 조건을 맞춘 뒤 다시 연결하세요.');
      return {ok:true};
    }
    if(message.type==='ARM') {
      if(!await consented()){
        if(message.consent!==true)throw Error('개인정보 처리 안내를 읽고 동의해 주세요.');
        await chrome.storage.local.set({privacyConsent:{version:1,acceptedAt:Date.now()}});
      }
      const current=await setup();
      if(!current.configured)throw Error('먼저 학년도·학년·반을 설정하고 저장하세요.');
      const tabs=await chrome.tabs.query({active:true,currentWindow:true});const tab=tabs[0];
      if(!tab?.id||!/^https:\/\/[^/]+\.neis\.go\.kr\//.test(tab.url||''))throw Error('나이스 탭을 활성화한 뒤 연결을 시작하세요.');
      if(!await bridge.ensure(tab))throw Error('나이스 화면이 준비된 뒤 연결 시작을 다시 눌러 주세요.');
      const c=current.config,nonce=crypto.randomUUID();
      const result=await chrome.tabs.sendMessage(tab.id,{type:'ARM',config:c,nonce});
      if(!result.ok)throw Error(result.error);
      await chrome.storage.session.remove('reportArm');
      await clearConnection('연결 준비 중');
      await chrome.storage.session.set({arm:{tabId:tab.id,nonce,identity:result.identity,config:c,until:Date.now()+60000}});
      await status({state:'connecting',message:'60초 안에 나이스의 조회 버튼을 눌러 주세요.'});
      return {ok:true};
    }
    if(message.type==='CHECK') {
      const c=await session();if(!c)throw Error('먼저 조회를 연결하세요.');
      await poll();
      const s=(await chrome.storage.local.get('status')).status;
      if(['watching','learning'].includes(s.state))await chrome.alarms.create(ALARM,{periodInMinutes:c.config.interval,delayInMinutes:c.config.interval});
      return {ok:true};
    }
    if(message.type==='QUERY_TEST') {
      const c=await session();if(!c)throw Error('먼저 조회를 연결하세요.');
      const snapshot=await requestSnapshot(c);
      return {ok:true,count:snapshot.count,total:snapshot.total,awaitingSchema:snapshot.awaitingSchema,needsConfirmation:snapshot.needsConfirmation,checkedAt:Date.now()};
    }
    if(message.type==='STOP'){const p=await profile();if(p)await chrome.storage.local.set({watchProfile:{...p,enabled:false}});await clearConnection('사용자가 감시와 자동 재개를 중지했습니다. 다시 연결하면 재개됩니다.');return {ok:true};}
    if(message.type==='RESET'){await reports.reset();await chrome.storage.local.remove(['history','alertHistories','alertLog']);return {ok:true,connected:!!(await session())};}
    if(message.type==='TEST') {
      const title='[교외체험학습 알림 표시 테스트]',text='실제 신청서 알림이 아닙니다.\n신청서별 알림 이력에는 영향을 주지 않습니다.';
      await logAlert('test',title,text);
      return {ok:true,pageShown:await showPageNotice(await session(),`${title}\n${text}`)};
    }
    throw Error('지원하지 않는 요청입니다.');
  }).then(reply).catch(e=>reply({ok:false,error:e.message}));
  return true;
});
