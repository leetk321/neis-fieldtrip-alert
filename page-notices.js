/* Pending work keeps hashes and scope only; student text comes from a fresh query. */
(function(root){
  'use strict';
  const kinds=new Set(['first','reminder','departure','report']);
  function create({chrome,core,calendar,copy}){
    const lane=c=>c.kind==='report'?'report':'application';
    const scope=c=>JSON.stringify([c.origin,c.identity,c.config.year,c.config.grade,c.config.classNo,lane(c)]);
    function valid(p){
      try{
        const context=JSON.parse(p.scope);
        return typeof p.id==='string'&&Array.isArray(context)&&context.length===6&&kinds.has(p.kind)&&
          context[5]===(p.kind==='report'?'report':'application')&&Array.isArray(p.keys)&&p.keys.every(k=>/^[a-f0-9]{64}$/.test(k));
      }catch{return false;}
    }
    const read=async()=>{
      const stored=await chrome.storage.local.get(['pendingPageNotices','alertLog']);
      return {pending:Array.isArray(stored.pendingPageNotices)?stored.pendingPageNotices.filter(valid):[],log:Array.isArray(stored.alertLog)?stored.alertLog.slice(0,20):[]};
    };
    async function send(c,type,extra){
      try{return (await chrome.tabs.sendMessage(c.tabId,{type,...extra}))?.ok===true;}catch{return false;}
    }
    async function clear(c){if(c)await send(c,'NOTICE_CLEAR',{scope:scope(c)});}
    async function register(item,c,rows,combined){
      const {pending,log}=await read(),record=log.find(r=>r.id===item.id);
      if(!record)throw Error('알림 기록을 확인할 수 없습니다.');
      // Legacy logs have no verified page-display state. Never replay them retroactively.
      if(record.page?.version!==1||record.page.registeredAt!==undefined)return;
      pending.push({id:item.id,scope:scope(c),kind:item.kind,keys:rows.map(r=>r.key),combined:combined.filter(k=>rows.some(r=>r.key===k)),createdAt:item.createdAt});
      record.page.registeredAt=Date.now();
      await chrome.storage.local.set({pendingPageNotices:pending,alertLog:log});
    }
    async function replay(c,s){
      // Only a successful, identity-checked complete query may retire or restore work.
      const {pending,log}=await read(),currentScope=scope(c),groups=new Map(),kept=[];
      const plan=lane(c)==='application'?core.plan(s.records,{},calendar.today(),c.config.excludedDates||[],s.departures||[]):null;
      let changed=false;
      for(const entry of pending){
        if(entry.scope!==currentScope){kept.push(entry);continue;}
        const eligible=entry.kind==='report'?s.reports.map(r=>r.key):entry.kind==='first'?[...plan.first,...plan.reminder]:plan[entry.kind];
        const rows=(entry.kind==='report'?s.reports:entry.kind==='departure'?s.departures||[]:s.records).filter(r=>entry.keys.includes(r.key)&&eligible.includes(r.key));
        const keys=rows.map(r=>r.key);
        if(keys.length!==entry.keys.length){changed=true;entry.keys=keys;}
        if(!keys.length){const record=log.find(r=>r.id===entry.id);if(record?.page)record.page.retiredAt=Date.now();continue;}
        kept.push(entry);
        for(const row of rows){
          const kind=entry.kind==='first'&&plan.reminder.includes(row.key)?'reminder':entry.kind;
          if(!groups.has(kind))groups.set(kind,new Map());
          const group=groups.get(kind);
          if(!group.has(row.key))group.set(row.key,{row,refs:[],combined:false});
          const work=group.get(row.key);work.refs.push(entry.id);
          work.combined ||= kind==='reminder'&&(entry.kind==='first'||entry.combined?.includes(row.key));
        }
      }
      if(changed)await chrome.storage.local.set({pendingPageNotices:kept,alertLog:log});
      const items=[];
      for(const kind of ['first','reminder','departure','report']){
        const group=groups.get(kind);if(!group?.size)continue;
        const works=[...group.values()],rows=works.map(w=>w.row),refs=new Map();
        for(const w of works)for(const id of w.refs){if(!refs.has(id))refs.set(id,[]);refs.get(id).push(w.row.key);}
        const references=[...refs].map(([id,keys])=>({id,keys:keys.sort()})).sort((a,b)=>a.id.localeCompare(b.id));
        const input=JSON.stringify([currentScope,kind,references]);
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(v=>v.toString(16).padStart(2,'0')).join('');
        const text=copy(kind,rows,works.filter(w=>w.combined).map(w=>w.row.key));
        items.push({alertId:'page-'+hash,kind,text:text.title+'\n'+text.message,page:{scope:currentScope,identity:c.identity,refs:references}});
      }
      await send(c,'NOTICE_SYNC',{scope:currentScope,items});
    }
    async function viewed(refs,c){
      if(!Array.isArray(refs)||!refs.length||refs.some(r=>!r||typeof r.id!=='string'||!Array.isArray(r.keys)||!r.keys.length||r.keys.some(k=>!/^[a-f0-9]{64}$/.test(k))))return false;
      const {pending,log}=await read(),currentScope=scope(c),kept=[];
      for(const entry of pending){
        const ref=entry.scope===currentScope?refs.find(r=>r.id===entry.id):null;
        if(ref)entry.keys=entry.keys.filter(k=>!ref.keys.includes(k));
        if(entry.keys.length){kept.push(entry);continue;}
        const record=log.find(r=>r.id===entry.id);if(record?.page)record.page.viewedAt=Date.now();
      }
      await chrome.storage.local.set({pendingPageNotices:kept,alertLog:log});return true;
    }
    return {scope,register,replay,viewed,clear};
  }
  root.TripPageNotices={create};
})(globalThis);
