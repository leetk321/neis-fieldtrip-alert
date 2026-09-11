(() => {
  'use strict';
  const key='__NEIS_TRIP_CONTENT_V2__',version=chrome.runtime.getManifest().version;
  if(globalThis[key]?.version===version)return;
  globalThis[key]?.dispose();
  const C=TripCore;
  let pending=null, captureBusy=false, busy=false, panel;
  let stopped=false,noticeTimer,readyTimer,readyInterval,activeController;
  const visible=e=>!!e && e.getClientRects().length>0 && getComputedStyle(e).visibility!=='hidden';
  const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(v=>v.toString(16).padStart(2,'0')).join('');
  async function send(message){
    if(stopped||!chrome.runtime.id){dispose();throw Error('확장 프로그램이 업데이트되었습니다.');}
    return chrome.runtime.sendMessage(message);
  }
  const notices=[];
  function notice(text,kind='info') {
    if(stopped)return;
    notices.push({text,kind});
    if(!panel)showNextNotice();
  }
  function showNextNotice(){
    const next=notices.shift();if(!next)return;
    const current=document.createElement('div'),previousFocus=document.activeElement;
    panel=current;current.setAttribute('data-neis-trip-notice','');
    Object.assign(current.style,{position:'fixed',right:'24px',bottom:'64px',zIndex:'2147483647',background:next.kind==='report'?'#ad4f15':next.kind==='departure'?'#643da5':'#123c46',color:'white',padding:'16px',borderRadius:'12px',boxSizing:'border-box',maxWidth:'min(410px, calc(100vw - 48px))',maxHeight:'60vh',display:'grid',gridTemplateColumns:'minmax(0, 1fr) 24px',gridTemplateRows:'minmax(0, 1fr)',columnGap:'10px',overflow:'hidden',font:'14px/1.8 sans-serif',boxShadow:'0 8px 30px #0003'});
    const close=document.createElement('button'),body=document.createElement('div');
    close.type='button';close.textContent='x';close.setAttribute('aria-label','알림 닫기');close.title='알림 닫기';
    Object.assign(close.style,{all:'initial',boxSizing:'border-box',gridColumn:'2',gridRow:'1',alignSelf:'start',display:'inline-flex',alignItems:'center',justifyContent:'center',width:'24px',height:'24px',padding:'0',border:'1px solid #ffffff80',borderRadius:'50%',background:'#ffffff1a',color:'white',font:'600 15px/1 sans-serif',cursor:'pointer'});
    body.setAttribute('role','status');body.textContent=next.text;
    // Reserve a separate column beside the text so even wrapped/scrolled content cannot overlap x.
    Object.assign(body.style,{gridColumn:'1',gridRow:'1',minWidth:'0',minHeight:'0',overflowY:'auto',overscrollBehavior:'contain',whiteSpace:'pre-line',overflowWrap:'anywhere'});
    function dismiss(){
      if(panel!==current)return;
      const restoreFocus=document.activeElement===close;
      clearTimeout(noticeTimer);current.remove();panel=null;
      // Only return focus after keyboard dismissal; showing a notice never changes focus.
      if(restoreFocus&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});
      if(!stopped)showNextNotice();
    }
    // Dismissing with the mouse must not blur the teacher's active input.
    close.addEventListener('mousedown',event=>{if(event.button===0)event.preventDefault();event.stopPropagation();});
    close.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();dismiss();});
    close.addEventListener('focus',()=>{close.style.outline='2px solid white';close.style.outlineOffset='2px';});
    close.addEventListener('blur',()=>{close.style.outline='none';});
    for(const type of ['keydown','keyup'])close.addEventListener(type,event=>event.stopPropagation());
    current.append(body,close);document.body.appendChild(current);
    noticeTimer=setTimeout(dismiss,15000);
  }
  async function identity() {
    const bar=document.querySelector('.topbar');
    if(!bar || !Array.from(bar.querySelectorAll('[role="button"],button')).some(e=>e.textContent.trim()==='로그아웃'))
      throw Error('나이스 로그인이 필요합니다.');
    const users=[...new Set(Array.from(bar.querySelectorAll('[title]')).map(e=>e.getAttribute('title')).filter(s=>/\([A-Za-z0-9_.-]+\)/.test(s||'')))];
    const schools=Array.from(bar.querySelectorAll('[role="combobox"]')).map(e=>e.getAttribute('aria-label')||e.textContent.trim());
    if(users.length!==1 || !schools.length) throw Error('현재 학교·계정을 확인할 수 없습니다. 나이스 화면을 확인하세요.');
    return hash(JSON.stringify([location.origin,users,schools]));
  }
  let announcedIdentity='';
  async function announceReady(){
    if(stopped)return;
    try{
      const permission=await send({type:'CAN_IDENTIFY'});
      if(stopped)return;
      if(!permission?.allowed){announcedIdentity='';return;}
      const who=await identity();
      if(who===announcedIdentity)return;
      const result=await send({type:'PAGE_READY',identity:who});
      if(result?.ok)announcedIdentity=who;
    }catch{announcedIdentity='';if(!chrome.runtime.id)dispose();}
  }
  function grid() {
    return Array.from(document.querySelectorAll('[role="grid"]')).find(g=>visible(g) &&
      g.querySelector('[data-target="eduActPrcsStsNm"]') && g.querySelector('[data-target="experLrnPeriod"]'));
  }
  function validateScreen(config,kind='application') {
    const title=kind==='report'?'교외체험학습보고서관리':'교외체험학습신청서관리';
    const heading=Array.from(document.querySelectorAll('[role="heading"],h1,h2,h3,.cl-text')).some(e=>visible(e)&&e.textContent.trim()===title);
    if(!heading || !grid()) throw Error(title+' 화면을 열어 주세요.');
    const read=name=> {
      const options=Array.from(document.querySelectorAll('[role="combobox"]')).filter(visible)
        .map(e=>e.getAttribute('aria-label')||'').filter(s=>s.startsWith(name+','));
      if(options.length!==1) throw Error(name+' 조회 조건을 확인할 수 없습니다.');
      return options[0].slice(name.length+1).trim();
    };
    if(read('학년도')!==config.year || C.numeric(read('학년'))!==config.grade || C.numeric(read('반'))!==config.classNo)
      throw Error(`나이스 조회 조건을 ${config.year}학년도 ${config.grade}학년 ${config.classNo}반으로 맞춰 주세요.`);
    if(read(kind==='report'?'처리상태':'접수상태')!=='전체'||read('결재상태')!=='전체')throw Error('접수상태와 결재상태를 모두 전체로 설정하세요.');
    for(const name of ['번호','학생명']) {
      const input=Array.from(document.querySelectorAll('input')).find(e=>visible(e)&&(e.getAttribute('aria-label')===name || e.getAttribute('placeholder')===name));
      if(input?.value.trim())throw Error('번호와 성명 검색 조건을 비워 주세요.');
    }
  }
  async function normalized(data,schema,config,kind='application') {
    let learnedSchema;
    if(schema.pending){
      const resolved=kind==='report'?TripReportCore.resolve(data,schema):C.resolvePending(data,schema);
      if(resolved.pending)return {records:[],departures:[],reports:[],count:0,total:0,awaitingSchema:true,needsConfirmation:resolved.needsConfirmation};
      schema=resolved.schema;learnedSchema=schema;
    }
    if(kind==='report'){
      const result=TripReportCore.select(data,schema,config);
      return {...result,learnedSchema,reports:await Promise.all(result.reports.map(async r=>({...r,key:await hash(r.key)})))};
    }
    const result=C.select(data,schema,config);
    return {learnedSchema,records:await Promise.all(result.records.map(async r=>({...r,key:await hash(r.key)}))),departures:await Promise.all(result.departures.map(async r=>({...r,key:await hash(r.key)}))),count:result.count,total:result.total};
  }
  async function capture(event){
    const d=event.data;
    if(stopped||event.source!==window||event.origin!==location.origin||!pending||captureBusy||d?.source!=='NEIS_TRIP_CAPTURE_V2'||d.nonce!==pending.nonce||Date.now()>pending.until)return;
    let data;try {data=JSON.parse(d.text);}catch{return;}
    // Other requests made by the screen are ignored; only the observed application schema qualifies.
    const find=o=>o&&typeof o==='object'&&(Array.isArray(o)?o.some(r=>r&&Object.hasOwn(r,'eduActPrcsStsNm')&&Object.hasOwn(r,'grd')):Object.values(o).some(find));
    if(!find(data)){try{C.pendingSchema(data,0);}catch{return;}}
    captureBusy=true;
    try {
      validateScreen(pending.config,pending.kind);
      const who=await identity();if(who!==pending.identity)throw Error('학교·계정이 변경되었습니다. 다시 연결하세요.');
      // Let the page complete its own rendering, then compare total rows.
      await new Promise(r=>setTimeout(r,700));
      if(stopped||!pending)return;
      const total=Number(grid()?.getAttribute('aria-rowcount'))-1;
      const schema=total===0?{...C.pendingSchema(data,total),kind:pending.kind}:pending.kind==='report'?TripReportCore.learn(data,total):C.learn(data,total), endpoint=C.endpoint(d.url,location.origin);
      const parsed=JSON.parse(d.body);
      const hasPaging=o=>o&&typeof o==='object'&&Object.entries(o).some(([k,v])=>
        (/^(pageSize|pageUnit|recordCountPerPage|limit|offset)$/i.test(k)&&Number(v)>0)||hasPaging(v));
      if(hasPaging(parsed))throw Error('페이지 단위 조회가 감지되어 자동 감시 연결을 중단했습니다. 전체 조회 지원 확인이 필요합니다.');
      const snapshot=await normalized(data,schema,pending.config,pending.kind);
      const report=pending.kind==='report';
      const reply=await send({type:report?'REPORT_CAPTURE':'CAPTURE',nonce:pending.nonce,identity:who,template:{endpoint,body:d.body,headers:d.headers,schema},snapshot});
      if(!reply.ok)throw Error(reply.error);
      pending=null;
      if(schema.pending)notice('연결 조건 저장 완료\n첫 신청서 학습 대기 중입니다. 전체 건수 확인이 필요한 경우 팝업에서 안내합니다.');
      else if(report)notice(`보고서 연결 완료 · 접수대기·미상신 ${snapshot.count}건. 새로 확인한 보고서를 한 번 알립니다.`,'report');
      else notice(`연결 완료 · 현재 미상신 ${snapshot.count}건 (접수취소 포함). 접수대기·접수취소 신규 신청과 5근무일 전 알림을 확인합니다.`);
    }catch(error){notice(error.message);await send({type:pending?.kind==='report'?'REPORT_CAPTURE_ERROR':'CAPTURE_ERROR',error:error.message}).catch(()=>{});}
    finally {captureBusy=false;}
  }
  function onMessage(message,sender,reply){
    if(stopped||sender.id!==chrome.runtime.id)return;
    (async()=> {
      if(message.type==='PING')return {ok:true,protocol:2,version};
      if(message.type==='ARM') {
        validateScreen(message.config,message.kind);
        const who=await identity();
        pending={nonce:message.nonce,config:message.config,identity:who,kind:message.kind||'application',until:Date.now()+60000};
        document.dispatchEvent(new CustomEvent('neis-trip-arm-v2',{detail:{nonce:pending.nonce}}));
        notice('연결 준비 완료. 60초 안에 나이스의 조회 버튼을 한 번 눌러 주세요.');
        return {ok:true,identity:who};
      }
      if(message.type==='WHO'){
        if(message.origin&&message.origin!==location.origin)throw Error('나이스 탭의 교육청 주소가 변경되었습니다.');
        return {ok:true,identity:await identity()};
      }
      if(message.type==='POLL') {
        if(busy)throw Error('이미 조회 중입니다.');
        if(await identity()!==message.identity)throw Error('학교·로그인 계정이 변경되었습니다. 다시 연결하세요.');
        if(C.schoolYear()!==message.config.year)throw Error('학년도가 변경되었습니다. 설정 후 다시 연결하세요.');
        busy=true;
        try {
          const t=message.template, endpoint=C.endpoint(t.endpoint,location.origin);
          const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
          activeController=controller;
          try {
            const response=await fetch(endpoint,{method:'POST',credentials:'include',redirect:'error',cache:'no-store',headers:t.headers,body:t.body,signal:controller.signal});
            if(!response.ok)throw Error('조회에 실패했습니다. HTTP '+response.status+' · 나이스 로그인 상태를 확인하세요.');
            const text=await response.text();
            if(text.length>10000000)throw Error('조회 응답이 너무 큽니다.');
            let data;try{data=JSON.parse(text);}catch{throw Error('로그인이 만료되었거나 조회 응답이 변경되었습니다.');}
            if(await identity()!==message.identity)throw Error('조회 중 학교·계정이 변경되었습니다.');
            return {ok:true,snapshot:await normalized(data,t.schema,message.config,message.kind)};
          } finally {clearTimeout(timer);activeController=null;}
        } finally {busy=false;}
      }
      if(message.type==='NOTICE'){notice(message.text,message.kind);return {ok:true};}
      return {ok:false,error:'지원하지 않는 요청입니다.'};
    })().then(reply).catch(e=>reply({ok:false,error:e.message}));
    return true;
  }
  function dispose(){
    stopped=true;pending=null;notices.length=0;
    clearTimeout(noticeTimer);clearTimeout(readyTimer);clearInterval(readyInterval);
    activeController?.abort();panel?.remove();panel=null;
    window.removeEventListener('message',capture);
    try{chrome.runtime.onMessage.removeListener(onMessage);}catch{}
    if(globalThis[key]?.dispose===dispose)delete globalThis[key];
  }
  globalThis[key]={version,dispose};
  window.addEventListener('message',capture);
  chrome.runtime.onMessage.addListener(onMessage);
  readyTimer=setTimeout(announceReady,1000);
  readyInterval=setInterval(announceReady,10000);
})();
