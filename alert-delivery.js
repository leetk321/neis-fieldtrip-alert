/* OS acceptance is distinct from an actual Windows banner being visible. */
(function(root){
  'use strict';
  function create({chrome,logAlert,watchingNeis,pageNotices}){
    async function permission(){
      try{return await chrome.notifications.getPermissionLevel();}
      catch{return 'unknown';}
    }
    async function saveResult(item,result){
      const stored=(await chrome.storage.local.get('alertLog')).alertLog;
      const items=Array.isArray(stored)?stored:[];
      const found=items.find(i=>i.id===item.id);
      if(!found)throw Error('알림 기록을 확인할 수 없습니다.');
      found.delivery={...result,attemptedAt:Date.now()};
      await chrome.storage.local.set({alertLog:items.slice(0,20)});
    }
    async function requestWindows(item){
      const level=await permission();
      if(level==='denied')return {state:'failed',target:'windows',error:'permission-denied'};
      try{
        // New batches must not replace an earlier notification of the same kind.
        await chrome.notifications.create('trip-'+item.kind+'-'+item.id,{
          type:'basic',
          iconUrl:chrome.runtime.getURL(item.kind==='report'?'icon-report.png':item.kind==='departure'?'icon-departure.png':'icon.png'),
          title:item.title,message:item.message,priority:0
        });
        return {state:'requested',target:'windows'};
      }catch{return {state:'failed',target:'windows',error:'create-failed'};}
    }
    async function deliver(kind,title,message,connection,rows,combined=[]){
      const keys=rows.map(r=>r.key);
      try{
        const c=connection.config;
        const retryKey=JSON.stringify([connection.origin,connection.identity,c.year,c.grade,c.classNo,kind,[...keys].sort()]);
        const item=await logAlert(kind,title,message,retryKey,{version:1,viewedAt:null,combined:combined.filter(key=>keys.includes(key))});
        await pageNotices.register(item,connection,rows,combined);
        const watching=await watchingNeis(connection);
        const result=watching?{state:'page',target:'page'}:await requestWindows(item);
        // Page delivery is durably pending; reconcile it after every stage is registered.
        await saveResult(item,result);
        // The next normal poll re-evaluates eligibility before retrying a failed request.
        return result.state!=='failed';
      }catch{return false;}
    }
    async function test(){
      const item=await logAlert('test','[Windows 알림 테스트]','Windows 알림 확인용입니다.\n실제 신청서·보고서 알림이 아닙니다.');
      const result=await requestWindows(item);
      await saveResult(item,result);
      return result;
    }
    return {deliver,permission,test};
  }
  function copy(stage,rows,combined=[]){
    const count=rows.length;
    if(stage==='report')return {title:'[보고서 알림]',message:`새 교외체험학습 보고서 ${count}건\n\n`+rows.map(r=>'• '+String(r.studentName||'이름 확인 필요').replace(/[\r\n\t]+/g,' ').slice(0,100)).join('\n')};
    const names={first:'[1차 알림]',reminder:'[2차 알림]',departure:'[교외체험학습 예정 알림]'};
    const combinedCount=stage==='reminder'?rows.filter(row=>combined.includes(row.key)).length:0;
    const title=combinedCount?'[1, 2차 통합 알림]':names[stage];
    let message=stage==='first'?`새 교외체험학습 신청서 ${count}건`:stage==='reminder'?`아직 처리되지 않은 신청서 ${count}건\n(체험 시작 전 5근무일 이내)`:`체험 시작을 앞둔 학생 ${count}명\n(1근무일 전 알림)`;
    if(combinedCount===count)message=`새 교외체험학습 신청서 ${count}건\n(체험 시작 전 5근무일 이내, 빠른 처리 필요)`;
    else if(combinedCount)message+=`\n\n※ ${count}건 중 ${combinedCount}건은 새 신청서임`;
    message+='\n\n'+rows.map(r=>'• '+String(r.studentName||'이름 확인 필요').replace(/[\r\n\t]+/g,' ')+(stage==='departure'?'\n  체험기간: '+String(r.period||r.startDate||'기간 확인 필요').replace(/[\r\n\t]+/g,' '):'')).join('\n');
    return {title,message};
  }
  root.TripAlertDelivery={create,copy};
})(globalThis);
