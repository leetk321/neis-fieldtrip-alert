const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto');
const dir=path.resolve(__dirname,'..');
const rec=(key='b',receipt='접수대기',unsubmitted=true,startDate='2026-09-14')=>({key:key.repeat(64),receipt,unsubmitted,startDate});
function harness(savedConfig={year:'2026',grade:'2',classNo:'3',interval:5},denyStorage=false,holidayFetch){
 const data={local:{...(savedConfig?{config:savedConfig}:{}),privacyConsent:{version:1,acceptedAt:1}},session:{}},listeners={},alarms=new Map(),notifications=[],osNotifications=[],pageMessages=[],tabsCreated=[];
 const storage=kind=>({setAccessLevel:async value=>{if(denyStorage)throw Error('storage restriction failed');data.accessLevel=value.accessLevel;},get:async key=>typeof key==='string'?{[key]:structuredClone(data[kind][key])}:structuredClone(data[kind]),set:async values=>{if(kind==='local'&&values.alertLog){if(data.rejectAlertLog)throw Error('alert log unavailable');const item=values.alertLog[0];if(item&&item.kind!=='test'&&!notifications.some(n=>n.id===item.id))notifications.push({...item,n:'trip-'+item.kind});}return Object.assign(data[kind],structuredClone(values));},remove:async keys=>{for(const k of [].concat(keys))delete data[kind][k];}});
 const event=name=>({addListener:fn=>listeners[name]=fn});
 let foreground=true,minimized=false;
 let snapshot={records:[rec()],count:1,total:2},reportSnapshot={reports:[],count:0,total:0},reportFail=false,fail=false,notificationFail=false,whoIdentity='a'.repeat(64),now=Date.parse('2026-09-01T01:00:00Z');
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const chrome={storage:{local:storage('local'),session:storage('session')},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},alarms:{clear:async n=>alarms.delete(n),create:async(n,o)=>alarms.set(n,o),onAlarm:event('alarm')},notifications:{create:async(n,o)=>{if(notificationFail)throw Error('notification unavailable');osNotifications.push({n,...o});},onClicked:event('notification')},windows:{get:async()=>({focused:foreground,state:minimized?'minimized':'normal'}),update:async()=>{}},tabs:{get:async()=>({active:foreground,windowId:1}),query:async()=>[{id:123,url:'https://goe.neis.go.kr/jsp/main.jsp'}],sendMessage:async(id,msg)=>{pageMessages.push(msg);return msg.type==='ARM'?{ok:true,identity:'a'.repeat(64)}:msg.type==='WHO'?{ok:true,identity:whoIdentity}:msg.type==='NOTICE'?{ok:true}:fail?{ok:false,error:'로그인 만료'}:{ok:true,snapshot};},create:async options=>{tabsCreated.push(options);return {id:999,...options};},onRemoved:event('removed'),update:async()=>({windowId:1})},runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onInstalled:event('installed'),onStartup:event('startup'),onMessage:event('message')}};
 const injections=[];
 chrome.runtime.getManifest=()=>({version:'1.8.0'});
 chrome.alarms.get=async name=>alarms.get(name);
 chrome.tabs.onUpdated=event('updated');
 chrome.tabs.query=async()=>data.openTabs||[{id:123,url:'https://goe.neis.go.kr/jsp/main.jsp',status:'complete'}];
 chrome.scripting={executeScript:async options=>{injections.push(options);if(data.injectionFail)throw Error('Cannot access tab');if(options.world==='ISOLATED')data.contentMissing=false;return [];}};
 const originalSend=chrome.tabs.sendMessage;
 chrome.tabs.sendMessage=async(id,msg)=>{
   if(data.contentMissing)throw Error('Could not establish connection. Receiving end does not exist.');
   if(msg.type==='PING')return {ok:true,protocol:2,version:'1.8.0'};
   if(msg.type==='WHO'&&data.loggedOut)return {ok:false,error:'나이스 로그인이 필요합니다.'};
   return msg.type==='POLL'&&msg.kind==='report'?(reportFail?{ok:false,error:'보고서 조회 실패'}:{ok:true,snapshot:reportSnapshot}):originalSend(id,msg);
 };
 const context=vm.createContext({chrome,crypto:webcrypto,URL,console,fetch:holidayFetch,AbortController,TextDecoder,Date:Clock,setTimeout,clearTimeout,structuredClone});
 context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(dir,f),'utf8'),context));
 vm.runInContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),context);
 const send=(message,sender={id:'test-extension'})=>new Promise(resolve=>listeners.message(message,sender,resolve));
 const page={id:'test-extension',frameId:0,url:'https://goe.neis.go.kr/jsp/main.jsp',tab:{id:123}};
 async function connect(){await send({type:'ARM'});const arm=data.session.arm;return send({type:'CAPTURE',nonce:arm.nonce,identity:arm.identity,template:{endpoint:'/observed.do',body:'{"data":{}}',headers:{'content-type':'application/json'},schema:{identityMode:'신청서 식별값'}},snapshot},page);}
 async function connectReport(s=reportSnapshot){
   const prepared=await send({type:'REPORT_ARM',consent:true});assert.equal(prepared.ok,true,prepared.error);
   const a=data.session.reportArm;
   return send({type:'REPORT_CAPTURE',nonce:a.nonce,identity:a.identity,template:{endpoint:'/report.do',body:'{}',headers:{},schema:{kind:'report',identityMode:'보고서 식별값'}},snapshot:s},page);
 }
 return {injections,tabUpdated:(change,tab={id:123,url:'https://goe.neis.go.kr/jsp/main.jsp'})=>listeners.updated(tab.id,change,tab),connectReport,setReportSnapshot:v=>reportSnapshot=v,setReportFail:()=>reportFail=true,osNotifications,setForeground:v=>foreground=v,setMinimized:v=>minimized=v,send,connect,data,alarms,notifications,pageMessages,tabsCreated,page,install:reason=>listeners.installed(reason?{reason}:undefined),startup:()=>listeners.startup(),alarm:name=>listeners.alarm({name}),removeTab:id=>listeners.removed(id),history:()=>Object.values(data.local.alertHistories||{})[0],setRecords:records=>snapshot={records,count:records.filter(r=>r.unsubmitted).length,total:records.length},setDepartures:departures=>snapshot.departures=departures,setSnapshot:v=>snapshot=v,setNow:date=>now=Date.parse(date+'T01:00:00Z'),setFail:()=>fail=true,setWho:value=>whoIdentity=value,setNotificationFail:value=>notificationFail=value};
}
test('connection starts alarm and persists stage flags and automatic profile',async()=>{const h=harness();assert.equal((await h.connect()).ok,true);assert.equal(h.alarms.get('trip-poll').periodInMinutes,5);assert.equal(h.history()['b'.repeat(64)].firstSent,true);assert.equal(h.data.local.connection,undefined);assert.equal(h.data.local.watchProfile.enabled,true);assert.equal(h.data.local.watchProfile.origin,'https://goe.neis.go.kr');assert.equal(h.data.local.watchProfile.template.headers.cookie,undefined);assert.equal(h.notifications.length,1);assert.equal(JSON.stringify(h.history()).includes('2026-09-14'),false);});
test('unchanged polls deduplicate and new application triggers first alert',async()=>{const h=harness();await h.connect();await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);h.setRecords([rec('c')]);await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);});
test('failed poll stops silently, detaches tab, and preserves profile and history',async()=>{const h=harness();await h.connect();h.setFail();await h.send({type:'CHECK'});assert.equal(h.alarms.has('trip-poll'),false);assert.equal(h.data.session.connection,undefined);assert.equal(h.data.local.status.state,'paused');assert.equal(h.data.local.watchProfile.enabled,true);assert.equal(h.history()['b'.repeat(64)].firstSent,true);assert.equal(h.notifications.length,1);});
test('stop disables automatic restart while retaining stage flags and profile',async()=>{const h=harness();await h.connect();await h.send({type:'STOP'});assert.equal(h.data.session.connection,undefined);assert.equal(h.alarms.has('trip-poll'),false);assert.ok(h.history());assert.equal(h.data.local.watchProfile.enabled,false);await h.startup();assert.equal(h.data.session.connection,undefined);});
test('alert reset keeps connection, alarm, and auto profile while clearing alert records',async()=>{const h=harness();await h.connect();const connection=h.data.session.connection;assert.equal(h.data.local.alertLog.length,1);await h.send({type:'RESET'});assert.deepEqual(h.data.session.connection,connection);assert.equal(h.alarms.get('trip-poll').periodInMinutes,5);assert.equal(h.data.local.watchProfile.enabled,true);assert.equal(h.data.local.alertHistories,undefined);assert.equal(h.data.local.alertLog,undefined);await h.send({type:'CHECK'});assert.equal(h.data.local.alertLog.length,1);assert.equal(h.notifications.length,2);});
test('page cannot change settings or invent unsolicited capture',async()=>{const h=harness();assert.equal((await h.send({type:'SAVE',config:{}},h.page)).ok,false);assert.equal((await h.send({type:'CAPTURE'},h.page)).ok,false);});
test('incorrect nonce cannot connect',async()=>{const h=harness();await h.send({type:'ARM'});assert.equal((await h.send({type:'CAPTURE',nonce:'bad',identity:h.data.session.arm.identity},h.page)).ok,false);assert.equal(h.data.session.connection,undefined);});
test('new installation requires setup with no assigned grade or class',async()=>{const h=harness(null);await h.install();const s=await h.send({type:'STATE'});assert.equal(s.configured,false);assert.equal(s.config.grade,'');assert.equal(s.config.classNo,'');assert.equal(s.status.state,'setup');assert.equal(h.data.local.config,undefined);assert.equal(h.alarms.has('trip-poll'),false);});
test('fresh install opens welcome page while an update does not',async()=>{const h=harness(null);await h.install('install');assert.equal(h.tabsCreated.length,1);assert.equal(h.tabsCreated[0].url,'chrome-extension://test-extension/welcome.html');await h.install('update');assert.equal(h.tabsCreated.length,1);});
test('cannot arm before settings are saved',async()=>{const h=harness(null);const r=await h.send({type:'ARM'});assert.equal(r.ok,false);assert.match(r.error,/설정하고 저장/);assert.equal(h.data.session.arm,undefined);});
test('chosen settings complete setup including custom nonworking dates',async()=>{const h=harness(null);assert.equal((await h.send({type:'SAVE',config:{year:'2026',grade:'4',classNo:'7',interval:10,excludedDates:'2026-09-07'}})).ok,true);const s=await h.send({type:'STATE'});assert.equal(s.configured,true);assert.equal(s.config.classNo,'7');assert.equal(s.config.excludedDates[0],'2026-09-07');await h.connect();assert.equal(h.alarms.get('trip-poll').periodInMinutes,10);});
test('update preserves previous settings',async()=>{const h=harness({year:'2026',grade:'5',classNo:'6',interval:15});await h.install();const s=await h.send({type:'STATE'});assert.equal(s.configured,true);assert.equal(s.config.grade,'5');assert.equal(s.config.classNo,'6');assert.equal(s.config.interval,15);});
test('incomplete stored settings return to setup',async()=>{const h=harness({year:'2026',grade:'',classNo:'',interval:5});assert.equal((await h.send({type:'STATE'})).configured,false);assert.equal((await h.send({type:'ARM'})).ok,false);});
test('first pending alert then canceled application gets one deadline alert',async()=>{const h=harness();await h.connect();h.setRecords([rec('b','접수취소')]);h.setNow('2026-09-06');await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);h.setNow('2026-09-07');await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);assert.equal(h.notifications[1].n,'trip-reminder');h.setNow('2026-09-15');await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);});
test('already submitted application skips second alert',async()=>{const h=harness();await h.connect();h.setRecords([rec('b','접수',false)]);h.setNow('2026-09-10');await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);});
test('submitted in progress application produces no first or second alert and no worker error',async()=>{const h=harness();h.setRecords([rec('b','접수대기',false)]);h.setNow('2026-09-10');const result=await h.connect();assert.equal(result.ok,true);assert.equal(h.notifications.length,0);assert.equal(h.data.local.alertLog,undefined);assert.equal(h.data.local.status.state,'watching');assert.equal(h.data.local.status.count,0);});
test('canceled application discovered first gets first and deadline alerts',async()=>{const h=harness();h.setRecords([rec('b','접수취소')]);await h.connect();assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].n,'trip-first');h.setNow('2026-09-07');await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);assert.equal(h.notifications[1].n,'trip-reminder');});
test('empty result, state changes, restart and interval change do not reset sent flags',async()=>{const h=harness();await h.connect();h.setNow('2026-09-08');await h.send({type:'CHECK'});h.setRecords([]);await h.send({type:'CHECK'});h.setRecords([rec()]);await h.send({type:'CHECK'});await h.startup();await h.connect();await h.send({type:'SAVE',config:{year:'2026',grade:'2',classNo:'3',interval:15}});await h.connect();assert.equal(h.notifications.length,2);});
test('two conditions already satisfied at initial connection produce one alert across later checks and restart',async()=>{
 for(const receipt of ['접수대기','접수취소']){
  const h=harness();h.setNow('2026-09-10');h.setRecords([rec('b',receipt)]);await h.connect();
  assert.deepEqual(h.notifications.map(n=>n.n),['trip-reminder']);assert.match(h.notifications[0].title,/1, 2차 통합 알림/);
  const entry=h.history()['b'.repeat(64)];assert.equal(entry.firstSent,true);assert.equal(entry.reminderSent,true);assert.equal(entry.firstPending,false);
  assert.equal(h.data.local.status.nextReminder,null);
  await h.send({type:'CHECK'});delete h.data.session.connection;await h.startup();h.setNow('2026-09-14');await h.send({type:'CHECK'});
  assert.equal(h.notifications.length,1);assert.equal(h.data.local.alertLog.length,1);
 }
});
test('failed combined alert is retried once without prematurely marking either stage sent',async()=>{
 const h=harness();h.setNow('2026-09-10');h.data.rejectAlertLog=true;await h.connect();
 const key='b'.repeat(64);assert.equal(h.notifications.length,0);assert.equal(h.history()[key].firstSent,undefined);assert.equal(h.history()[key].reminderSent,undefined);assert.equal(h.history()[key].firstPending,true);
 h.data.rejectAlertLog=false;await h.send({type:'CHECK'});await h.send({type:'CHECK'});
 assert.equal(h.notifications.length,1);assert.equal(h.history()[key].firstSent,true);assert.equal(h.history()[key].reminderSent,true);
});
test('combined alerts stay consumed after disappearance and date change; reset allows exactly one again',async()=>{
 const h=harness();h.setNow('2026-09-10');await h.connect();h.setRecords([]);await h.send({type:'CHECK'});h.setRecords([rec('b','접수취소',true,'2026-09-21')]);await h.send({type:'CHECK'});h.setNow('2026-09-17');await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);
 await h.send({type:'RESET'});await h.send({type:'CHECK'});await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);assert.equal(h.data.local.alertLog.length,1);
});
test('new due application shares one reminder with previously announced due application without duplicate names',async()=>{
 const h=harness();h.setRecords([{...rec('a'),studentName:'기존학생'}]);await h.connect();
 h.setNow('2026-09-10');h.setRecords([{...rec('a'),studentName:'기존학생'},{...rec('b'),studentName:'새학생'}]);await h.send({type:'CHECK'});
 assert.equal(h.notifications.length,2);const alert=h.notifications[1];assert.equal(alert.n,'trip-reminder');assert.match(alert.message,/※ 2건 중 1건은 새 신청서임/);
 for(const name of ['기존학생','새학생'])assert.equal(alert.message.split(name).length,2);
 await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);
});
test('internal alerts are delivered without Windows notification API',async()=>{const h=harness();h.setNotificationFail(true);await h.connect();assert.equal(h.history()['b'.repeat(64)].firstSent,true);assert.equal(h.data.local.alertLog.length,1);assert.equal(h.notifications.length,1);h.setNotificationFail(false);await h.send({type:'CHECK'});assert.equal(h.data.local.alertLog.length,1);assert.equal(h.notifications.length,1);});
test('alert test writes the internal inbox and shows a banner on the connected NEIS page',async()=>{const h=harness();await h.connect();const before=h.notifications.length;const result=await h.send({type:'TEST'});assert.equal(result.pageShown,true);assert.equal(h.data.local.alertLog[0].kind,'test');assert.match(h.data.local.alertLog[0].message,/실제 신청서 알림이 아닙니다/);assert.equal(h.notifications.length,before);assert.ok(h.pageMessages.some(m=>m.type==='NOTICE'&&m.text.includes('알림 표시 테스트')));});
test('query test fetches current count without changing histories or alerts',async()=>{const h=harness();await h.connect();await h.send({type:'RESET'});const before=h.notifications.length;const result=await h.send({type:'QUERY_TEST'});assert.equal(result.count,1);assert.equal(result.total,2);assert.ok(result.checkedAt);assert.equal(h.data.local.alertHistories,undefined);assert.equal(h.data.local.alertLog,undefined);assert.equal(h.notifications.length,before);});
test('unsupported holiday year keeps one combined deadline notification',async()=>{const h=harness();h.setNow('2028-09-08');h.setRecords([rec('b','접수대기',true,'2028-09-14')]);await h.connect();assert.equal(h.notifications.length,1);assert.match(h.notifications[0].title,/1, 2차 통합 알림/);assert.equal(h.data.local.status.calendarWarning,false);});
test('available legacy first-alert history is migrated without losing second stage',async()=>{const h=harness();h.data.local.history={key:'a'.repeat(64)+':'+JSON.stringify({year:'2026',grade:'2',classNo:'3',interval:5}),keys:['b'.repeat(64)]};await h.connect();assert.equal(h.notifications.length,0);h.setNow('2026-09-08');await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].n,'trip-reminder');});
test('browser startup automatically reconnects a matching open NEIS tab',async()=>{const h=harness();await h.connect();delete h.data.session.connection;h.alarms.clear();await h.startup();assert.equal(h.data.session.connection.automatic,true);assert.equal(h.data.session.connection.tabId,123);assert.equal(h.data.local.status.state,'watching');assert.equal(h.alarms.get('trip-poll').periodInMinutes,5);});
test('different school or account never receives saved query profile',async()=>{const h=harness();await h.connect();delete h.data.session.connection;h.alarms.clear();h.setWho('c'.repeat(64));await h.startup();assert.equal(h.data.session.connection,undefined);assert.equal(h.alarms.has('trip-poll'),false);assert.equal((await h.send({type:'PAGE_READY',identity:'c'.repeat(64)},h.page)).resumed,false);assert.equal(h.data.session.connection,undefined);});
test('matching page ready message reconnects after tab becomes available',async()=>{const h=harness();await h.connect();await h.removeTab(123);assert.equal(h.data.session.connection,undefined);assert.equal(h.data.local.status.state,'waiting');const result=await h.send({type:'PAGE_READY',identity:'a'.repeat(64)},h.page);assert.equal(result.resumed,true);assert.equal(h.data.session.connection.tabId,123);});
test('settings change removes stale saved query and requires one new capture',async()=>{const h=harness();await h.connect();await h.send({type:'SAVE',config:{year:'2026',grade:'2',classNo:'4',interval:5}});assert.equal(h.data.local.watchProfile,undefined);await h.startup();assert.equal(h.data.session.connection,undefined);});

test('state exposes query failures instead of concealing them as waiting',async()=>{const h=harness();await h.connect();h.setFail();await h.send({type:'CHECK'});const s=await h.send({type:'STATE'});assert.equal(s.status.state,'paused');assert.match(s.status.message,/로그인/);});
test('capture validates snapshot before persisting automatic query profile',async()=>{const h=harness();await h.send({type:'ARM'});const a=h.data.session.arm;const r=await h.send({type:'CAPTURE',nonce:a.nonce,identity:a.identity,template:{endpoint:'/observed.do',body:'{}',headers:{},schema:{}},snapshot:{records:null}},h.page);assert.equal(r.ok,false);assert.equal(h.data.local.watchProfile,undefined);});

test('completed reminder persists independently and uses distinct colors and multiline text',async()=>{const h=harness();h.setRecords([]);h.setDepartures([{key:'d'.repeat(64),startDate:'2026-09-14'}]);h.setNow('2026-09-11');await h.connect();assert.equal(h.notifications.length,1);assert.equal(h.notifications[0].n,'trip-departure');assert.match(h.notifications[0].message,/\n/);assert.equal(h.data.local.alertLog[0].kind,'departure');assert.ok(h.pageMessages.some(m=>m.type==='NOTICE'&&m.kind==='departure'));await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);await h.startup();assert.equal(h.notifications.length,1);await h.send({type:'RESET'});await h.send({type:'CHECK'});assert.equal(h.notifications.length,2);});
test('query test leaves completed reminder history untouched',async()=>{const h=harness();await h.connect();await h.send({type:'RESET'});h.setRecords([]);h.setDepartures([{key:'d'.repeat(64),startDate:'2026-09-14'}]);h.setNow('2026-09-11');await h.send({type:'QUERY_TEST'});assert.equal(h.data.local.alertHistories,undefined);await h.send({type:'CHECK'});assert.equal(h.data.local.alertLog[0].kind,'departure');});

test('all alert categories show only their matching student names',async()=>{
 const h=harness();h.setNow('2026-09-11');h.setRecords([{...rec('a','접수대기',true,'2026-09-21'),studentName:'처음학생'},{...rec('b'),studentName:'기한학생'}]);h.setDepartures([{key:'d'.repeat(64),startDate:'2026-09-14',studentName:'완결학생'}]);await h.connect();
 const names={first:'처음학생',reminder:'기한학생',departure:'완결학생'};
 for(const [kind,name]of Object.entries(names)){const item=h.data.local.alertLog.find(i=>i.kind===kind);assert.ok(item);assert.ok(item.message.includes(name));for(const other of Object.values(names).filter(n=>n!==name))assert.ok(!item.message.includes(other));}
});

test('Windows notifications appear only when the connected NEIS tab is not being watched',async()=>{const h=harness();await h.connect();assert.equal(h.osNotifications.length,0);h.setForeground(false);h.setRecords([rec('c')]);await h.send({type:'CHECK'});assert.equal(h.osNotifications.length,1);h.setForeground(true);h.setMinimized(true);h.setRecords([rec('d')]);await h.send({type:'CHECK'});assert.equal(h.osNotifications.length,2);h.setMinimized(false);h.setRecords([rec('e')]);await h.send({type:'CHECK'});assert.equal(h.osNotifications.length,2);});

test('completed alert displays the corresponding full period beside each student',async()=>{const h=harness();h.setRecords([]);h.setNow('2026-09-11');h.setDepartures([{key:'d'.repeat(64),startDate:'2026-09-14',studentName:'테스트',period:'2026.09.14 09:00 ~ 2026.09.16 18:00'}]);await h.connect();const msg=h.data.local.alertLog[0].message;assert.match(msg,/테스트\n  체험기간: 2026.09.14 09:00 ~ 2026.09.16 18:00/);assert.ok(!msg.includes('나이스에서 체험기간'));});

test('worker restricts local storage before processing extension messages',async()=>{const h=harness();await h.send({type:'STATE'});assert.equal(h.data.accessLevel,'TRUSTED_CONTEXTS');});
test('pending profile survives restart and promotes only with a learned schema',async()=>{const h=harness();await h.send({type:'ARM'});const a=h.data.session.arm;const template={endpoint:'/observed.do',body:'{}',headers:{},schema:{pending:true,path:['dsMain'],totalPath:['totalCount']}};const empty={records:[],departures:[],count:0,total:0,awaitingSchema:true};h.setSnapshot(empty);assert.equal((await h.send({type:'CAPTURE',nonce:a.nonce,identity:a.identity,template,snapshot:empty},h.page)).ok,true);assert.equal(h.data.local.status.state,'learning');assert.equal(h.notifications.length,0);await h.startup();assert.equal(h.data.local.status.state,'learning');assert.ok(h.alarms.size);h.setSnapshot({records:[rec()],count:1,total:1,learnedSchema:{path:['dsMain'],identity:['aplySn'],approval:'atrzStsNm',startDate:'experLrnPeriod',identityMode:'신청서 식별값'}});await h.send({type:'CHECK'});assert.equal(h.data.local.status.state,'watching');assert.equal(h.data.local.watchProfile.template.schema.pending,undefined);assert.equal(h.notifications.length,1);await h.send({type:'CHECK'});assert.equal(h.notifications.length,1);});

test('storage restriction failure blocks actions rather than using unrestricted storage',async()=>{const h=harness(undefined,true);const result=await h.send({type:'SAVE',config:{year:'2026',grade:'1',classNo:'1',interval:5}});assert.equal(result.ok,false);assert.match(result.error,/storage restriction/);assert.equal(h.data.local.config.grade,'2');assert.equal(h.alarms.has('trip-poll'),false);});

test('public holiday download failure never stops NEIS alerts',async()=>{const h=harness(undefined,false,async()=>{throw Error('offline');});await h.install('update');await h.connect();assert.equal(h.data.local.status.state,'watching');assert.equal(h.notifications.length,1);assert.ok(h.data.local.holidayCache.error);assert.equal(h.alarms.has('trip-poll'),true);});

test('holiday prefetch works without NEIS configuration and survives EVPN offline startup',async()=>{let calls=0,offline=false;const dates=Object.fromEntries(['01-01','02-01','02-02','03-01','05-05','06-06','08-15','10-03','10-09','12-25'].map(d=>['2027-'+d,['공휴일']]));const h=harness(null,false,async()=>{calls++;if(offline)throw Error('EVPN offline');return new Response(JSON.stringify({'2027':dates}));});await h.install('install');assert.equal(calls,1);assert.ok(h.data.local.holidayCache.data['2027']);assert.equal(h.data.local.config,undefined);assert.equal(h.alarms.get('holiday-refresh').periodInMinutes,60);await h.alarm('holiday-refresh');assert.equal(calls,1);offline=true;h.setNow('2026-09-03');await h.startup();assert.equal(calls,2);assert.ok(h.data.local.holidayCache.data['2027']);assert.ok(h.data.local.holidayCache.error);assert.equal(h.alarms.has('trip-poll'),false);});

test('privacy consent blocks identity probes and old sessions until affirmative action',async()=>{
 const h=harness();await h.connect();delete h.data.local.privacyConsent;
 const before=h.pageMessages.length;
 assert.equal((await h.send({type:'CAN_IDENTIFY'},h.page)).allowed,false);
 await h.startup();assert.equal(h.pageMessages.length,before);
 assert.equal((await h.send({type:'ARM'})).ok,false);
 assert.equal((await h.send({type:'STATE'})).privacyConsented,false);
 assert.equal((await h.send({type:'ARM',consent:true})).ok,true);
 assert.equal(h.data.local.privacyConsent.version,1);
});
test('content scripts cannot grant privacy consent',async()=>{
 const h=harness();delete h.data.local.privacyConsent;
 assert.equal((await h.send({type:'ARM',consent:true},h.page)).ok,false);
 assert.equal(h.data.local.privacyConsent,undefined);
});

const reportFixture=(key='b')=>({reports:[{key:key.repeat(64),receipt:'접수대기',unsubmitted:true,studentName:'보고서예시'}],count:1,total:1});

test('extension update reattaches both watchers without recapture or duplicate notifications',async()=>{
 const h=harness();await h.connect();h.setReportSnapshot(reportFixture());await h.connectReport();
 const keep=['config','privacyConsent','reportConsent','watchProfile','reportProfile','alertHistories','reportHistories','alertLog'];
 const before=Object.fromEntries(keep.map(k=>[k,structuredClone(h.data.local[k])]));
 h.data.session={};h.data.contentMissing=true;const arms=h.pageMessages.filter(m=>m.type==='ARM').length;
 await h.install('update');
 assert.equal(h.injections.length,2);assert.deepEqual(h.injections.map(i=>i.world),['MAIN','ISOLATED']);
 assert.ok(h.data.session.connection.automatic);assert.ok(h.data.session.reportConnection.automatic);
 assert.equal(h.alarms.get('trip-poll').periodInMinutes,5);assert.equal(h.alarms.get('trip-report-poll').periodInMinutes,5);
 assert.equal(h.alarms.has('trip-reconnect'),false);
 assert.equal(h.pageMessages.filter(m=>m.type==='ARM').length,arms);
 for(const k of keep)assert.deepEqual(h.data.local[k],before[k],k);
 await h.alarm('trip-poll');await h.alarm('trip-report-poll');assert.equal(h.notifications.length,2);
});
test('update while NEIS is closed waits and recovers after tab loading completes',async()=>{
 const h=harness();await h.connect();h.setReportSnapshot(reportFixture());await h.connectReport();
 h.data.openTabs=[];h.data.contentMissing=true;await h.install('update');assert.equal(h.injections.length,0);assert.ok(h.alarms.has('trip-reconnect'));
 h.data.openTabs=[{id:123,url:'https://goe.neis.go.kr/jsp/main.jsp',status:'loading'}];await h.alarm('trip-reconnect');assert.equal(h.injections.length,0);
 h.data.openTabs[0].status='complete';await h.tabUpdated({status:'complete'});
 assert.equal(h.injections.length,2);assert.ok(h.data.session.connection);assert.ok(h.data.session.reportConnection);assert.equal(h.notifications.length,2);
});
test('temporary injection failure retries from saved profile without erasing consent or history',async()=>{
 const h=harness();await h.connect();h.data.contentMissing=true;h.data.injectionFail=true;await h.install('update');
 assert.equal(h.data.session.connection,undefined);assert.ok(h.data.local.watchProfile.enabled);assert.ok(h.history()['b'.repeat(64)].firstSent);assert.ok(h.alarms.has('trip-reconnect'));
 h.data.injectionFail=false;await h.alarm('trip-reconnect');assert.ok(h.data.session.connection);assert.equal(h.notifications.length,1);assert.equal(h.alarms.has('trip-reconnect'),false);
});
test('login can complete after update and resume both existing connections automatically',async()=>{
 const h=harness();await h.connect();h.setReportSnapshot(reportFixture());await h.connectReport();
 h.data.loggedOut=true;h.data.contentMissing=true;await h.install('update');assert.equal(h.data.session.connection,undefined);assert.equal(h.data.session.reportConnection,undefined);
 h.data.loggedOut=false;await h.alarm('trip-reconnect');assert.ok(h.data.session.connection);assert.ok(h.data.session.reportConnection);assert.equal(h.notifications.length,2);assert.equal(h.injections.length,2);
});
test('update respects independently stopped watchers',async()=>{
 for(const stop of ['STOP','REPORT_STOP']){
  const h=harness();await h.connect();h.setReportSnapshot(reportFixture());await h.connectReport();await h.send({type:stop});h.data.contentMissing=true;await h.install('update');
  assert.equal(!!h.data.session.connection,stop!=='STOP');assert.equal(!!h.data.session.reportConnection,stop!=='REPORT_STOP');assert.equal(h.notifications.length,2);
 }
 const h=harness();await h.connect();await h.send({type:'STOP'});h.data.contentMissing=true;await h.install('update');assert.equal(h.injections.length,0);assert.equal(h.alarms.has('trip-reconnect'),false);
});
test('automatic injection is limited to saved consenting origins and never queries a different account',async()=>{
 const h=harness();await h.connect();h.data.contentMissing=true;h.data.openTabs=[{id:999,url:'https://sen.neis.go.kr/jsp/main.jsp'}];await h.install('update');assert.equal(h.injections.length,0);
 h.data.openTabs=[{id:123,url:'https://goe.neis.go.kr/jsp/main.jsp'}];h.setWho('c'.repeat(64));const polls=h.pageMessages.filter(m=>m.type==='POLL').length;await h.alarm('trip-reconnect');
 assert.equal(h.injections.length,2);assert.equal(h.pageMessages.filter(m=>m.type==='POLL').length,polls);assert.equal(h.data.session.connection,undefined);
 delete h.data.local.privacyConsent;h.data.contentMissing=true;await h.alarm('trip-reconnect');assert.equal(h.injections.length,2);assert.equal(h.alarms.has('trip-reconnect'),false);
});
test('pending schema profiles survive update and remain in learning state without manual recapture',async()=>{
 const h=harness();await h.connect();h.setReportSnapshot(reportFixture());await h.connectReport();
 h.data.local.watchProfile.template.schema={pending:true,path:['rows'],totalPath:['totalCount']};
 h.data.local.reportProfile.template.schema={kind:'report',pending:true,path:['rows'],totalPath:['totalCount']};
 h.setSnapshot({records:[],departures:[],count:0,total:0,awaitingSchema:true});h.setReportSnapshot({reports:[],count:0,total:0,awaitingSchema:true});h.data.contentMissing=true;
 await h.install('update');assert.equal(h.data.local.status.state,'learning');assert.equal(h.data.local.reportStatus.state,'learning');assert.equal(h.data.local.watchProfile.template.schema.pending,true);assert.equal(h.data.local.reportProfile.template.schema.pending,true);assert.equal(h.notifications.length,2);
});
test('recovery does not interrupt an explicit capture or repeatedly reinject healthy tabs',async()=>{
 const h=harness();await h.connect();await h.send({type:'ARM'});h.data.contentMissing=true;await h.alarm('trip-reconnect');assert.equal(h.injections.length,0);assert.ok(h.data.session.arm);
 h.data.session.arm.until=0;await h.alarm('trip-reconnect');assert.equal(h.injections.length,2);await h.alarm('trip-reconnect');assert.equal(h.injections.length,2);
});
test('first manual connection can attach to a tab opened before extension installation',async()=>{
 const h=harness();h.data.contentMissing=true;await h.install('install');assert.equal(h.injections.length,0);await h.connect();assert.equal(h.injections.length,2);assert.ok(h.data.session.connection);
});
test('report connection coexists with applications and deduplicates by independent report history',async()=>{
 const h=harness();await h.connect();h.setReportSnapshot(reportFixture());assert.equal((await h.connectReport()).ok,true);
 assert.ok(h.data.session.connection);assert.ok(h.data.session.reportConnection);
 assert.ok(h.alarms.has('trip-poll'));assert.ok(h.alarms.has('trip-report-poll'));
 assert.equal(h.notifications.filter(n=>n.kind==='report').length,1);
 await h.send({type:'REPORT_CHECK'});assert.equal(h.notifications.filter(n=>n.kind==='report').length,1);
 h.setReportSnapshot({reports:[],count:0,total:0});await h.send({type:'REPORT_CHECK'});
 h.setReportSnapshot(reportFixture());await h.send({type:'REPORT_CHECK'});assert.equal(h.notifications.filter(n=>n.kind==='report').length,1);
 h.setReportSnapshot(reportFixture('c'));await h.alarm('trip-report-poll');assert.equal(h.notifications.filter(n=>n.kind==='report').length,2);
 assert.match(h.notifications.find(n=>n.kind==='report').message,/보고서예시/);
 assert.ok(h.pageMessages.some(m=>m.type==='NOTICE'&&m.kind==='report'));
});
test('report network failures and stopping do not stop application polling',async()=>{
 const h=harness();await h.connect();await h.connectReport();h.setReportFail();await h.send({type:'REPORT_CHECK'});
 assert.ok(h.alarms.has('trip-poll'));assert.ok(h.data.session.connection);assert.equal(h.data.local.reportStatus.state,'paused');
 await h.send({type:'REPORT_STOP'});assert.equal(h.data.local.reportProfile.enabled,false);assert.equal(h.data.local.watchProfile.enabled,true);
});
test('report-only automatic resume verifies origin account and consent',async()=>{
 const h=harness();h.setReportSnapshot(reportFixture());await h.connectReport();
 assert.equal((await h.send({type:'CAN_IDENTIFY'},h.page)).allowed,true);
 await h.startup();assert.equal(h.data.session.reportConnection.automatic,true);assert.equal(h.notifications.length,1);
 h.setWho('d'.repeat(64));await h.startup();assert.equal(h.data.session.reportConnection,undefined);
});
test('report query test never consumes first alert and RESET preserves both connections',async()=>{
 const h=harness();await h.connect();await h.connectReport();h.setReportSnapshot(reportFixture());
 await h.send({type:'REPORT_QUERY_TEST'});assert.equal(h.data.local.reportHistories,undefined);
 await h.send({type:'REPORT_CHECK'});assert.ok(h.data.local.reportHistories);
 await h.send({type:'RESET'});assert.equal(h.data.local.reportHistories,undefined);assert.ok(h.data.session.connection);assert.ok(h.data.session.reportConnection);
 await h.send({type:'REPORT_CHECK'});assert.equal(h.data.local.alertLog[0].kind,'report');
});
test('report consent and capture nonce required; foreign callers cannot opt in',async()=>{
 const h=harness();assert.equal((await h.send({type:'REPORT_ARM'})).ok,false);
 assert.equal((await h.send({type:'REPORT_ARM',consent:true},h.page)).ok,false);
 await h.send({type:'REPORT_ARM',consent:true});const a=h.data.session.reportArm;
 assert.equal((await h.send({type:'REPORT_CAPTURE',nonce:'bad',identity:a.identity},h.page)).ok,false);
 assert.equal(h.data.local.reportProfile,undefined);
});
test('report alert uses orange icon when NEIS tab is not being watched',async()=>{
 const h=harness();h.setForeground(false);h.setReportSnapshot(reportFixture());await h.connectReport();
 assert.equal(h.osNotifications[0].iconUrl,'icon-report.png');assert.equal(h.osNotifications[0].n,'trip-report');
});
test('shared configuration invalidates both saved connections',async()=>{
 const h=harness();await h.connect();await h.connectReport();await h.send({type:'SAVE',config:{year:'2026',grade:'2',classNo:'4',interval:5}});
 assert.equal(h.data.local.reportProfile,undefined);assert.equal(h.data.local.watchProfile,undefined);assert.equal(h.data.session.reportConnection,undefined);
});
test('a report schema learned from empty capture is stored before future automatic checks',async()=>{
 const h=harness();await h.send({type:'REPORT_ARM',consent:true});const a=h.data.session.reportArm;
 const empty={reports:[],count:0,total:0,awaitingSchema:true};h.setReportSnapshot(empty);
 const result=await h.send({type:'REPORT_CAPTURE',nonce:a.nonce,identity:a.identity,template:{endpoint:'/report.do',body:'{}',headers:{},schema:{kind:'report',pending:true,path:['rows'],totalPath:['totalCount']}},snapshot:empty},h.page);
 assert.equal(result.ok,true);assert.equal(h.data.local.reportStatus.state,'learning');
 h.setReportSnapshot({...reportFixture(),learnedSchema:{kind:'report',path:['rows'],identity:['rptSn'],approval:'atrzStsNm'}});
 await h.send({type:'REPORT_CHECK'});assert.equal(h.data.local.reportProfile.template.schema.pending,undefined);assert.equal(h.notifications.length,1);
});
