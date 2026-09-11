(() => {
  'use strict';
  let arm = null;
  const headersAllowed = new Set(['accept', 'content-type', 'x-requested-with', 'ui']);
  const MAX_BODY = 512000, MAX_RESPONSE = 10000000;
  document.addEventListener('neis-trip-arm-v1', event => {
    const d = event.detail;
    if (d && typeof d.nonce === 'string') arm = {nonce:d.nonce, until:Date.now()+60000, clickUntil:0};
  });
  document.addEventListener('click', event => {
    if (!arm || !event.isTrusted || Date.now()>arm.until) return;
    const b = event.target.closest('[role="button"],button');
    if (b && b.textContent.trim() === '조회') arm.clickUntil = Date.now()+4000;
  }, true);
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
    window.postMessage({source:'NEIS_TRIP_CAPTURE_V1', ...t, text}, location.origin);
  }
  const fetchOriginal=window.fetch;
  window.fetch = function(input, init) {
    const method=init?.method || input?.method || 'GET';
    const t=ticket(method, typeof input==='string'?input:input?.url, init?.body, init?.headers || input?.headers);
    return fetchOriginal.apply(this,arguments).then(response=> {
      if(t) response.clone().text().then(text=>send(t,text,response.status)).catch(()=>{});
      return response;
    });
  };
  const proto=XMLHttpRequest.prototype, open=proto.open, sendOriginal=proto.send, setHeader=proto.setRequestHeader;
  const meta=new WeakMap();
  proto.open=function(method,url) {meta.delete(this);if(ticket(method,url,'{}',{}))meta.set(this,{method,url,headers:{}}); return open.apply(this,arguments);};
  proto.setRequestHeader=function(name,value) {const m=meta.get(this);if(m&&headersAllowed.has(String(name).toLowerCase()))m.headers[String(name).toLowerCase()]=value;return setHeader.apply(this,arguments);};
  proto.send=function(body) {
    const m=meta.get(this), t=m && ticket(m.method,m.url,body,m.headers);
    meta.delete(this);
    if(t)this.addEventListener('load',()=> {try {send(t,this.responseType==='json'?JSON.stringify(this.response):this.responseText,this.status);}catch{}},{once:true});
    return sendOriginal.apply(this,arguments);
  };
})();
