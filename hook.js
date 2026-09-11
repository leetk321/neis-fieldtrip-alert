(() => {
  'use strict';
  const key='__NEIS_TRIP_HOOK_V2__';
  if(window[key]?.revision===1)return;
  window[key]?.dispose?.();
  let arm = null;
  const headersAllowed = new Set(['accept', 'content-type', 'x-requested-with', 'ui']);
  const MAX_BODY = 512000, MAX_RESPONSE = 10000000;
  const armListener=event => {
    const d = event.detail;
    if (d && typeof d.nonce === 'string') arm = {nonce:d.nonce, until:Date.now()+60000, clickUntil:0};
  };
  const clickListener=event => {
    if (!arm || !event.isTrusted || Date.now()>arm.until) return;
    const b = event.target.closest('[role="button"],button');
    if (b && b.textContent.trim() === '조회') arm.clickUntil = Date.now()+4000;
  };
  // A distinct channel leaves pre-1.8.0 hooks inactive when an existing tab is upgraded.
  document.addEventListener('neis-trip-arm-v2',armListener);
  document.addEventListener('click',clickListener,true);
  function ticket(method, url, body, headers) {
    if (!arm || Date.now()>arm.until || Date.now()>arm.clickUntil || String(method).toUpperCase()!=='POST') return null;
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin || !u.pathname.endsWith('.do') || typeof body!=='string' || body.length>MAX_BODY) return null;
      const parsed = JSON.parse(body);
      if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return null;
      const clean = {};
      new Headers(headers || {}).forEach((v,k)=> { if(headersAllowed.has(k)) clean[k]=v; });
      return {nonce:arm.nonce, url:u.pathname+u.search, body, headers:clean};
    } catch { return null; }
  }
  function send(t, text, status) {
    if (!t || typeof text!=='string' || text.length>MAX_RESPONSE || status<200 || status>=300) return;
    window.postMessage({source:'NEIS_TRIP_CAPTURE_V2', ...t, text}, location.origin);
  }
  const fetchOriginal=window.fetch;
  const fetchWrapped=window.fetch = function(input, init) {
    const method=init?.method || input?.method || 'GET';
    const t=ticket(method, typeof input==='string'?input:input?.url, init?.body, init?.headers || input?.headers);
    return fetchOriginal.apply(this,arguments).then(response=> {
      if(t) response.clone().text().then(text=>send(t,text,response.status)).catch(()=>{});
      return response;
    });
  };
  const proto=XMLHttpRequest.prototype, open=proto.open, sendOriginal=proto.send, setHeader=proto.setRequestHeader;
  const meta=new WeakMap();
  const openWrapped=proto.open=function(method,url) {meta.delete(this);if(ticket(method,url,'{}',{}))meta.set(this,{method,url,headers:{}}); return open.apply(this,arguments);};
  const headerWrapped=proto.setRequestHeader=function(name,value) {const m=meta.get(this);if(m&&headersAllowed.has(String(name).toLowerCase()))m.headers[String(name).toLowerCase()]=value;return setHeader.apply(this,arguments);};
  const sendWrapped=proto.send=function(body) {
    const m=meta.get(this), t=m && ticket(m.method,m.url,body,m.headers);
    meta.delete(this);
    if(t)this.addEventListener('load',()=> {try {send(t,this.responseType==='json'?JSON.stringify(this.response):this.responseText,this.status);}catch{}},{once:true});
    return sendOriginal.apply(this,arguments);
  };
  window[key]={revision:1,dispose(){
    arm=null;
    document.removeEventListener('neis-trip-arm-v2',armListener);
    document.removeEventListener('click',clickListener,true);
    if(window.fetch===fetchWrapped)window.fetch=fetchOriginal;
    if(proto.open===openWrapped)proto.open=open;
    if(proto.send===sendWrapped)proto.send=sendOriginal;
    if(proto.setRequestHeader===headerWrapped)proto.setRequestHeader=setHeader;
    delete window[key];
  }};
})();
