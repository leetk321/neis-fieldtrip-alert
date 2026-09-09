/* Offline fallback calendar. Source and refresh policy: docs/HOLIDAYS.md. */
(function(root){
  'use strict';
  const holidays={
    2025:['01-01','01-27','01-28','01-29','01-30','03-01','03-03','05-05','05-06','06-03','06-06','08-15','10-03','10-05','10-06','10-07','10-08','10-09','12-25'],
    2026:['01-01','02-16','02-17','02-18','03-01','03-02','05-01','05-05','05-24','05-25','06-03','06-06','07-17','08-15','08-17','09-24','09-25','09-26','10-03','10-05','10-09','12-25'],
    2027:['01-01','02-06','02-07','02-08','02-09','03-01','05-01','05-03','05-05','05-13','06-06','07-17','07-19','08-15','08-16','09-14','09-15','09-16','10-03','10-04','10-09','10-11','12-25','12-27']
  };
  let downloaded={};
  function useDownloaded(data){downloaded=data;}
  function parseDate(value){
    const s=String(value??'').trim();
    const m=s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?=$|\D)/)||s.match(/^(\d{4})(\d{2})(\d{2})(?=$|[\sT~\d])/);
    if(!m)throw Error('체험 시작일을 읽을 수 없습니다. 날짜 필드를 확인하세요.');
    const y=Number(m[1]),month=Number(m[2]),day=Number(m[3]),d=new Date(Date.UTC(y,month-1,day));
    if(y<2000||d.getUTCFullYear()!==y||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw Error('올바르지 않은 체험 시작일입니다.');
    return d.toISOString().slice(0,10);
  }
  function today(now=new Date()){
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${value.year}-${value.month}-${value.day}`;
  }
  function subtractWorkdays(value,days=5,extra=[]){
    const date=new Date(parseDate(value)+'T00:00:00Z'), excluded=new Set(extra);
    let left=days;
    while(left>0){
      date.setUTCDate(date.getUTCDate()-1);
      const year=date.getUTCFullYear(),iso=date.toISOString().slice(0,10);
      if(date.getUTCDay()!==0&&date.getUTCDay()!==6&&!(downloaded[year]||holidays[year]||[]).includes(iso.slice(5))&&!excluded.has(iso))left--;
    }
    return date.toISOString().slice(0,10);
  }
  function excludedDates(value){
    const list=Array.isArray(value)?value:String(value||'').split(/[\s,;]+/).filter(Boolean);
    if(list.length>400)throw Error('추가 제외일은 최대 400개까지 설정할 수 있습니다.');
    return [...new Set(list.map(v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))throw Error('추가 제외일은 YYYY-MM-DD 형식으로 입력하세요.');return parseDate(v);} ))].sort();
  }
  const api={useDownloaded,holidays,parseDate,today,subtractWorkdays,excludedDates,checkedAt:'2026-09-09'};
  root.TripCalendar=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
