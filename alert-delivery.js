/* OS acceptance is distinct from an actual Windows banner being visible. */
(function(root){
  'use strict';
  function create({chrome,logAlert,watchingNeis,showPageNotice}){
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
    async function deliver(kind,title,message,connection,keys){
      try{
        const c=connection.config;
        const retryKey=JSON.stringify([connection.origin,connection.identity,c.year,c.grade,c.classNo,kind,[...keys].sort()]);
        const item=await logAlert(kind,title,message,retryKey);
        const watching=await watchingNeis(connection);
        const result=watching?{state:'page',target:'page'}:await requestWindows(item);
        // Content queues hidden alerts and deduplicates/upserts the same ID on retries.
        const pageShown=await showPageNotice(connection,title+'\n'+message,kind,item.id);
        if(watching&&!pageShown)Object.assign(result,{state:'failed',error:'page-unavailable'});
        await saveResult(item,{...result,pageShown});
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
  root.TripAlertDelivery={create};
})(globalThis);
