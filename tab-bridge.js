/* Reattach packaged scripts to existing tabs without reloading the user's NEIS page. */
(function(root){
  'use strict';
  function create(chrome){
    const version=chrome.runtime.getManifest().version;
    async function ping(tabId){
      try{
        const result=await chrome.tabs.sendMessage(tabId,{type:'PING'});
        return result?.ok===true&&result.protocol===2&&result.version===version;
      }catch{return false;}
    }
    async function ensure(tab){
      if(!tab?.id||tab.discarded||tab.frozen||tab.status==='loading')return false;
      let url;try{url=new URL(tab.url);}catch{return false;}
      if(url.protocol!=='https:'||!url.hostname.endsWith('.neis.go.kr')||url.port||url.username||url.password)return false;
      if(await ping(tab.id))return true;
      // The caller has either checked stored consent/origin or received an explicit connect action.
      const target={tabId:tab.id,frameIds:[0]};
      await chrome.scripting.executeScript({target,world:'MAIN',files:['hook.js']});
      await chrome.scripting.executeScript({target,world:'ISOLATED',files:['calendar.js','core.js','report-core.js','content.js']});
      return ping(tab.id);
    }
    return {ensure};
  }
  root.TripTabBridge={create};
})(globalThis);
