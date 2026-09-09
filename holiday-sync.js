/* Public holiday data only. No remote executable code. */
(function(root){
  'use strict';
  const URL='https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/basic.json';
  function validate(data){
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('공휴일 JSON 형식 오류');
    const out={},years=Object.keys(data);
    if(!years.length||years.length>150)throw Error('공휴일 연도 범위 오류');
    for(const year of years){
      if(!/^20\d{2}$/.test(year))throw Error('공휴일 연도 오류');
      const rows=data[year];if(!rows||typeof rows!=='object'||Array.isArray(rows))throw Error('공휴일 목록 오류');
      const dates=Object.keys(rows);
      if(dates.length<10||dates.length>70||!dates.includes(year+'-01-01')||!dates.includes(year+'-12-25'))throw Error('불완전한 공휴일 자료');
      for(const iso of dates){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||iso.slice(0,4)!==year||new Date(iso+'T00:00:00Z').toISOString().slice(0,10)!==iso)throw Error('공휴일 날짜 오류');
        if(!Array.isArray(rows[iso])||!rows[iso].length||rows[iso].some(v=>typeof v!=='string'||!v.trim()||v.length>200))throw Error('공휴일 명칭 오류');
      }
      out[year]=dates.map(v=>v.slice(5)).sort();
    }
    return out;
  }
  function create(storage,calendar,fetcher,now=Date.now){
    let active;
    async function load(){
      const saved=(await storage.get('holidayCache')).holidayCache;
      try{if(saved?.data)calendar.useDownloaded(validate(saved.data));}catch{}
    }
    async function run(){
      const saved=(await storage.get('holidayCache')).holidayCache||{};
      let previous={};
      try{if(saved.data){calendar.useDownloaded(validate(saved.data));previous=saved.data;}}catch{}
      const stamp=now(),interval=saved.error?3600000:86400000;
      if(saved.attemptedAt&&stamp>=saved.attemptedAt&&stamp-saved.attemptedAt<interval)return;
      if(typeof fetcher!=='function')return;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
      try{
        const response=await fetcher(URL,{method:'GET',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('공휴일 다운로드 HTTP '+response.status);
        const reader=response.body.getReader(),chunks=[];let size=0;
        while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>524288){await reader.cancel();throw Error('공휴일 자료 크기 초과');}chunks.push(r.value);}
        const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
        const received=JSON.parse(new TextDecoder().decode(bytes));validate(received);
        const data={...previous,...received},parsed=validate(data);
        await storage.set({holidayCache:{data,attemptedAt:stamp,updatedAt:stamp,years:Object.keys(parsed),error:null}});
        calendar.useDownloaded(parsed);
      }catch(e){await storage.set({holidayCache:{...saved,data:previous,attemptedAt:stamp,error:String(e.message).slice(0,180)}});}
      finally{clearTimeout(timer);}
    }
    return {load,refresh(){if(!active)active=run().finally(()=>active=null);return active;}};
  }
  const api={create,validate,URL};root.HolidaySync=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
