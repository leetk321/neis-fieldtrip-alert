/* A separate connection, timer, and history prevent report failures from stopping applications. */
(function(root){
  'use strict';
  function create(env){
    const {chrome,core:C,setup,validatedProfile,logAlert,showPageNotice,watchingNeis}=env;
    const ALARM='trip-report-poll';
    const local=chrome.storage.local,sessionStore=chrome.storage.session;
    const read=async(store,key)=>(await store.get(key))[key];
    const profile=()=>read(local,'reportProfile'),connection=()=>read(sessionStore,'reportConnection');
    const consented=async()=>await env.consented()&&(await read(local,'reportConsent'))?.version===1;
    const needsResume=async()=>!!(await consented()&&(await profile())?.enabled&&!await connection());
    const status=s=>local.set({reportStatus:{...s,updatedAt:Date.now()}});
    const schedule=c=>chrome.alarms.create(ALARM,{periodInMinutes:c.config.interval,delayInMinutes:c.config.interval});
    async function disconnect(message,state='disconnected'){
      await chrome.alarms.clear(ALARM);await sessionStore.remove(['reportConnection','reportArm']);await status({state,message});
    }
    function validate(s){
      if(!s||!Array.isArray(s.reports)||s.reports.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.key)||r.receipt!=='접수대기'||r.unsubmitted!==true)||s.count!==s.reports.length||!Number.isInteger(s.total)||s.total<s.count||new Set(s.reports.map(r=>r.key)).size!==s.reports.length)throw Error('보고서 조회 결과 형식을 확인할 수 없습니다.');
      return s;
    }
    async function snapshot(c){
      if(!await consented())throw Error('보고서 개인정보 처리 안내에 동의하고 연결하세요.');
      const result=await chrome.tabs.sendMessage(c.tabId,{...c,type:'POLL',kind:'report'});
      if(!result?.ok)throw Error(result?.error||'나이스 탭을 새로고침한 뒤 보고서를 연결하세요.');
      return validate(result.snapshot);
    }
    async function notify(rows,c){
      const title=`${c.config.grade}학년 ${c.config.classNo}반 · 새 보고서`;
      const message=`새로 확인한 교외체험학습 보고서 ${rows.length}건\n접수대기 · 미상신\n나이스 보고서관리에서 확인해 주세요.\n\n대상 학생\n`+rows.map(r=>'• '+String(r.studentName||'이름 확인 필요').replace(/[\r\n\t]+/g,' ').slice(0,100)).join('\n');
      try{await logAlert('report',title,message);}catch{return false;}
      if(!await watchingNeis(c))try{await chrome.notifications.create('trip-report',{type:'basic',iconUrl:'icon-report.png',title,message,priority:0});}catch{}
      await showPageNotice(c,`${title}\n\n${message}`,'report');return true;
    }
    async function apply(s,c){
      validate(s);
      if(s.learnedSchema&&c.template.schema.pending){
        const x=s.learnedSchema;
        if(x.kind!=='report'||x.pending||!Array.isArray(x.path)||!Array.isArray(x.identity)||!x.identity.length||typeof x.approval!=='string')throw Error('보고서 학습 결과가 올바르지 않습니다.');
        c.template={...c.template,schema:x};const p=await profile();if(p)await local.set({reportProfile:{...p,template:c.template}});
      }
      if(s.awaitingSchema){
        if(!c.template.schema.pending)throw Error('잘못된 보고서 학습 대기 응답입니다.');
        await sessionStore.set({reportConnection:c});await status({state:'learning',count:null,lastCheck:Date.now(),message:s.needsConfirmation?'보고서 발견 · 전체 건수 확인을 위해 보고서 연결 시작 후 나이스에서 조회하세요.':'연결 조건 저장 · 첫 보고서 학습 대기'});return;
      }
      if(c.template.schema.pending)throw Error('보고서 응답 학습이 필요합니다.');
      const scope=`${c.identity}:${c.config.year}:${c.config.grade}:${c.config.classNo}`;
      const histories=(await read(local,'reportHistories'))||{};
      const history=histories[scope]||{};
      const fresh=s.reports.filter(r=>!history[r.key]?.sent);
      let delivered=true;
      if(fresh.length){
        delivered=await notify(fresh,c);
        if(delivered){for(const r of fresh)history[r.key]={sent:true};histories[scope]=history;await local.set({reportHistories:histories});}
      }
      c.count=s.count;c.lastCheck=Date.now();await sessionStore.set({reportConnection:c});
      await status({state:'watching',count:s.count,total:s.total,lastCheck:c.lastCheck,message:delivered?'보고서 감시 중 · 접수대기·미상신 최초 확인 시 1회':'보고서 알림 저장 실패 · 다음 조회에서 재시도'});
    }
    async function poll(){
      const c=await connection();if(!c)return;
      try{await apply(await snapshot(c),c);}catch(e){await disconnect('보고서 확인 필요 · '+e.message,'paused');}
    }
    async function canIdentify(url){
      const p=await profile();return !!(await consented()&&p?.enabled&&p.origin===new URL(url).origin);
    }
    async function resume(tabId,url,identity){
      if(!await canIdentify(url))return {resumed:false};
      let p;try{p=validatedProfile(await profile());}catch(e){await disconnect(e.message);return {resumed:false};}
      if(p.identity!==identity)return {resumed:false};
      const current=await connection();if(current?.tabId===tabId&&current.identity===identity)return {resumed:false,already:true};
      const c={tabId,identity,origin:p.origin,config:p.config,template:p.template,kind:'report',automatic:true};
      await sessionStore.set({reportConnection:c});await poll();
      if(await connection()){await schedule(c);return {resumed:true};}return {resumed:false};
    }
    async function startup(){
      await sessionStore.remove('reportArm');
      const p=await profile();
      if(!p?.enabled){await disconnect('보고서관리에서 조회를 연결하세요.');return;}
      await disconnect('로그인된 나이스 탭을 기다립니다.','waiting');
    }
    async function getState(){
      const p=await profile(),c=await connection(),s=await read(local,'reportStatus');
      return {connected:!!c,autoStart:p?.enabled===true,privacyConsented:await consented(),status:s||{state:'disconnected',message:'보고서관리에서 조회를 연결하세요.'}};
    }
    async function reset(){await local.remove('reportHistories');}
    async function invalidate(){await local.remove('reportProfile');await disconnect('설정 변경 · 보고서 조회를 다시 연결하세요.');}
    async function removed(tabId){if((await connection())?.tabId===tabId)await disconnect('나이스 탭을 기다립니다.','waiting');}
    async function handle(m,sender,internal,page){
      if(!m.type?.startsWith('REPORT_'))return null;
      if(['REPORT_CAPTURE','REPORT_CAPTURE_ERROR'].includes(m.type)){
        if(!page||!await consented())throw Error('허용되지 않은 보고서 연결 응답입니다.');
        const a=await read(sessionStore,'reportArm');
        if(!a||a.tabId!==sender.tab.id||Date.now()>a.until)throw Error('보고서 연결 시간이 지났습니다.');
        if(m.type==='REPORT_CAPTURE_ERROR'){await status({state:'connecting',message:m.error});return {ok:true};}
        if(m.nonce!==a.nonce||m.identity!==a.identity)throw Error('보고서 학교·계정 또는 연결 정보가 다릅니다.');
        if(m.template?.schema?.kind!=='report')throw Error('보고서 화면에서 다시 연결하세요.');
        const c={tabId:a.tabId,identity:a.identity,origin:new URL(sender.url).origin,config:a.config,template:m.template,kind:'report'};
        const p=validatedProfile({...c,enabled:true,savedAt:Date.now()});validate(m.snapshot);
        await local.set({reportProfile:p});await apply(m.snapshot,c);await sessionStore.remove('reportArm');await schedule(c);return {ok:true};
      }
      if(!internal)throw Error('확장 프로그램에서만 실행할 수 있습니다.');
      if(m.type==='REPORT_ARM'){
        const current=await setup();if(!current.configured)throw Error('먼저 학년도·학년·반을 저장하세요.');
        if(!await consented()){
          if(m.consent!==true)throw Error('보고서 개인정보 처리 안내에 동의해 주세요.');
          await local.set({privacyConsent:{version:1,acceptedAt:Date.now()},reportConsent:{version:1,acceptedAt:Date.now()}});
        }
        const tab=(await chrome.tabs.query({active:true,currentWindow:true}))[0];
        if(!tab?.id||!/^https:\/\/[^/]+\.neis\.go\.kr\//.test(tab.url||''))throw Error('나이스 보고서관리 탭을 활성화해 주세요.');
        if(!await env.ensureTab(tab))throw Error('나이스 화면이 준비된 뒤 보고서 연결을 다시 시작하세요.');
        const nonce=crypto.randomUUID(),result=await chrome.tabs.sendMessage(tab.id,{type:'ARM',kind:'report',config:current.config,nonce});
        if(!result?.ok)throw Error(result?.error||'보고서 연결 준비에 실패했습니다.');
        await disconnect('60초 안에 보고서관리에서 조회를 누르세요.','connecting');
        await sessionStore.remove('arm');
        await sessionStore.set({reportArm:{tabId:tab.id,nonce,identity:result.identity,config:current.config,until:Date.now()+60000}});return {ok:true};
      }
      if(m.type==='REPORT_CHECK'){
        const c=await connection();if(!c)throw Error('먼저 보고서를 연결하세요.');await poll();if(await connection())await schedule(c);return {ok:true};
      }
      if(m.type==='REPORT_QUERY_TEST'){
        const c=await connection();if(!c)throw Error('먼저 보고서를 연결하세요.');const s=await snapshot(c);
        return {ok:true,count:s.count,total:s.total,awaitingSchema:s.awaitingSchema,needsConfirmation:s.needsConfirmation,checkedAt:Date.now()};
      }
      if(m.type==='REPORT_STOP'){const p=await profile();if(p)await local.set({reportProfile:{...p,enabled:false}});await disconnect('사용자가 보고서 감시를 중지했습니다.');return {ok:true};}
      throw Error('지원하지 않는 보고서 요청입니다.');
    }
    return {ALARM,handle,poll,startup,resume,canIdentify,getState,reset,invalidate,removed,connection,needsResume};
  }
  root.TripReportWatcher={create};
})(globalThis);
