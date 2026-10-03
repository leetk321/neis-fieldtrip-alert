/* Report polling obtains a fresh application list; no cached absence decisions. */
(function(root){
  'use strict';
  function create({chrome,core,calendar,application,applicationSnapshot,allowed,delivery,pageNotices,copy,loadHolidays}){
    const local=chrome.storage.local;
    let lastConnection;
    const same=(a,b)=>a&&b&&a.origin===b.origin&&a.identity===b.identity&&
      ['year','grade','classNo'].every(k=>String(a.config[k])===String(b.config[k]))&&
      JSON.stringify(a.config.excludedDates||[])===JSON.stringify(b.config.excludedDates||[]);
    const connection=c=>c?{...c,kind:'deadline'}:null;
    const status=value=>local.set({deadlineStatus:{...value,updatedAt:Date.now()}});
    function validate(s){
      if(!s?.ready)throw Error(s?.reason||'다음 정상 조회에서 보고서 기한 비교 자료를 확인합니다.');
      if(!Array.isArray(s.rows)||s.rows.some(r=>!r||!/^[a-f0-9]{64}$/.test(r.link)||
        (r.key!==null&&!/^[a-f0-9]{64}$/.test(r.key))||typeof r.completed!=='boolean'||
        typeof r.unsubmitted!=='boolean'||typeof r.known!=='boolean'||
        !/^\d{4}-\d{2}-\d{2}$/.test(r.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(r.endDate)||
        r.completed&&!r.key))throw Error('보고서 기한 비교 자료를 확인할 수 없습니다.');
      return s;
    }
    async function pause(message,c=lastConnection){
      if(!c)c=(await chrome.storage.session.get('reportConnection')).reportConnection;
      if(c)await pageNotices.clear(connection(c));
      await status({state:'waiting',message});
    }
    async function apply(reportSnapshot,reportConnection){
      const c=connection(reportConnection);lastConnection=c;
      try{
        const a=await application();
        if(!await allowed()||!same(a,c))throw Error('같은 학교·계정·학년·반의 신청서와 보고서를 모두 연결하면 기한 알림이 시작됩니다.');
        const arming=await chrome.storage.session.get(['arm','reportArm']);
        if([arming.arm,arming.reportArm].some(x=>x?.until>Date.now()))throw Error('조회 연결 완료 후 보고서 기한을 확인합니다.');
        const r=validate(reportSnapshot.deadline);
        const app=await applicationSnapshot(a);
        for(const ctx of [a,c]){
          const who=await chrome.tabs.sendMessage(ctx.tabId,{type:'WHO',origin:ctx.origin});
          if(!who?.ok||who.identity!==ctx.identity)throw Error('조회 중 학교·계정이 변경되어 기한 판단을 보류합니다.');
        }
        await loadHolidays();
        const result=core.plan(validate(app.deadline),r,calendar.today(),c.config.excludedDates||[]);
        const scope=pageNotices.scope(c),saved=await local.get('deadlineHistories'),histories=saved.deadlineHistories||{};
        const history=histories[scope]||{},fresh=result.rows.filter(r=>!history[r.key]?.sent);
        const suppressed=[];let delivered=true;
        if(fresh.length){
          const text=copy('deadline',fresh);
          delivered=await delivery.deliver('deadline',text.title,text.message,c,fresh);
          if(delivered){
            for(const row of fresh){history[row.key]={sent:true};if(row.reportKey)suppressed.push(row.reportKey);}
            histories[scope]=history;await local.set({deadlineHistories:histories});
          }
        }
        await pageNotices.replay(c,{deadlines:result.rows,deadlineHeld:result.heldKeys});
        const held=result.ambiguous+result.unknown;
        await status({state:'watching',count:result.rows.length,lastCheck:Date.now(),held,
          message:!delivered?'기한 알림 전달 실패 · 다음 정상 조회에서 재시도합니다.':
            '종료 후 5번째 근무일부터 미제출·미상신 확인'+(held?` · 연결 중복·상태 불명 ${held}건 보류`:'')});
        return {sent:suppressed,deferred:fresh.map(r=>r.reportKey).filter(Boolean)};
      }catch(e){await pause('기한 알림 대기 · '+e.message,c);return {sent:[],deferred:[]};}
    }
    async function getState(reportConnection){
      const a=await application(),saved=(await local.get('deadlineStatus')).deadlineStatus;
      if(!await allowed()||!same(a,reportConnection))return {state:'waiting',message:'신청서와 보고서를 모두 연결하면 기한 알림이 시작됩니다.'};
      return saved||{state:'waiting',message:'다음 보고서 조회에서 종료 후 기한을 확인합니다.'};
    }
    return {apply,pause,getState,connection};
  }
  root.TripReportDeadlineWatcher={create};
})(globalThis);
