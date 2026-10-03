/* Join only complete, fresh lists. Raw student numbers never leave the content script. */
(function(root){
  'use strict';
  const C=root.TripCore||(typeof require==='function'?require('./core.js'):null);
  const Calendar=root.TripCalendar||(typeof require==='function'?require('./calendar.js'):null);
  const clean=v=>C.normalize(v).replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');
  function period(value){
    const parts=C.normalize(value).split(/[~～∼]/);
    if(parts.length!==2)throw Error('체험 시작일과 종료일을 확인할 수 없습니다.');
    function endpoint(s){
      s=s.trim();
      if(!/^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{8}(?:\d{4}(?:\d{2})?)?)$/.test(s))throw Error('체험기간 형식 확인이 필요합니다.');
      return Calendar.parseDate(s);
    }
    const startDate=endpoint(parts[0]),endDate=endpoint(parts[1]);
    if(endDate<startDate)throw Error('체험 종료일이 시작일보다 빠릅니다.');
    return {startDate,endDate,period:startDate+' ~ '+endDate};
  }
  // 1.9.3 already captured only all-status, unfiltered, non-paged queries.
  // Preserve that contract when adopting a saved template, without recapturing its UI.
  function coverage(data,schema,total){
    if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('조회 오류로 보고서 기한 판단을 보류합니다.');
    if(!Array.isArray(schema.path))throw Error('저장된 전체 조회 경로를 확인할 수 없습니다.');
    const rows=C.pathGet(data,schema.path);
    if(!Array.isArray(rows)||(total!==undefined&&rows.length!==total))throw Error('전체 목록 건수를 확인할 수 없습니다.');
    const paths=[],parent=schema.path.slice(0,-1),container=C.pathGet(data,parent);
    if(container&&!Array.isArray(container))for(const key of Object.keys(container)){
      if(/^(totalCount|totalCnt|totalRowCount|totCnt|totCount)$/i.test(key))paths.push([...parent,key]);
    }
    if(parent.length)for(const key of Object.keys(data))if(/^(totalCount|totalCnt|totalRowCount|totCnt|totCount)$/i.test(key))paths.push([key]);
    if(schema.totalPath&&!paths.some(p=>JSON.stringify(p)===JSON.stringify(schema.totalPath)))paths.push(schema.totalPath);
    const next={...schema,coverage:{version:1,totalPaths:paths,source:total===undefined?'saved-full-query':'screen'}};
    verifyCounts(data,next,rows.length);return next;
  }
  function validCoverage(value){
    return value?.version===1&&Array.isArray(value.totalPaths)&&value.totalPaths.length<=20&&
      value.totalPaths.every(p=>Array.isArray(p)&&p.length>0&&p.length<=8&&p.every(k=>typeof k==='string'&&k.length<=100));
  }
  function verifyCounts(data,schema,length){
    if(!validCoverage(schema.coverage))throw Error('전체 조회 확인 정보를 확인할 수 없습니다.');
    for(const p of schema.coverage.totalPaths){
      const raw=C.pathGet(data,p);
      if(raw==null||String(raw).trim()===''||!Number.isInteger(Number(raw))||Number(raw)!==length)throw Error('전체 건수와 응답 행수가 달라 보고서 기한 판단을 보류합니다.');
    }
  }
  function upgrade(data,schema){
    return schema.coverage?schema:coverage(data,schema);
  }
  function collect(data,schema,config,kind){
    try{
      schema=upgrade(data,schema);
      if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('조회 오류로 보고서 기한 판단을 보류합니다.');
      const rows=C.pathGet(data,schema.path);
      if(!Array.isArray(rows))throw Error('전체 목록 구조를 확인할 수 없습니다.');
      verifyCounts(data,schema,rows.length);
      if(rows.length&&schema.pending)throw Error('첫 데이터의 전체 목록 확인이 필요합니다.');
      const result=[];
      for(const r of rows){
        if(!r||!['grd','clsCd'].every(k=>Object.hasOwn(r,k)&&/^\d+$/.test(C.numeric(r[k]))&&Number(r[k])>0))throw Error('학년·반 필드를 확인할 수 없습니다.');
        if(C.numeric(r.grd)!==C.numeric(config.grade)||C.numeric(r.clsCd)!==C.numeric(config.classNo))continue;
        const number=C.numeric(r.clsNo);
        if(!/^\d{1,3}$/.test(number)||Number(number)<1)throw Error('학생 번호 필드를 확인할 수 없습니다.');
        const dates=period(r.experLrnPeriod),approval=clean(r[schema.approval]);
        const receipt=clean(r.eduActPrcsStsNm);
        const names=Object.keys(r).filter(k=>/^(?:stu|std|stdnt|student|stdr|stud)(?:nt)?(?:kor|korean|fl|full)?(?:nm|name)$/i.test(k)||k==='성명'||k==='학생명');
        const found=[...new Set(names.map(k=>C.normalize(r[k])).filter(Boolean))];
        const validId=Array.isArray(schema.identity)&&schema.identity.length&&schema.identity.every(k=>C.normalize(r[k]));
        const completed=kind==='application'&&approval==='완결'&&['접수','접수대기'].includes(receipt);
        if(completed&&!validId)throw Error('완결 신청서 식별값을 확인할 수 없습니다.');
        result.push({...dates,link:JSON.stringify([number,dates.startDate,dates.endDate]),
          key:validId?JSON.stringify(schema.identity.map(k=>r[k])):null,completed,
          unsubmitted:approval==='미상신',known:['미상신','완결','승인완료','결재중','상신','상신(진행)','반려','회수','기결취소','완결(기결취소)','진행중'].includes(approval)||/^상신\([^()]+\)$/.test(approval),
          studentName:found.length===1?found[0].replace(/[\r\n\t]+/g,' ').slice(0,100):'이름 확인 필요'});
      }
      return {ready:true,rows:result,total:rows.length};
    }catch(e){return {ready:false,reason:e.message};}
  }
  function plan(applications,reports,date=Calendar.today(),excluded=[]){
    if(!applications?.ready||!reports?.ready)throw Error(applications?.reason||reports?.reason||'신청서와 보고서 전체 목록 확인이 필요합니다.');
    const group=rows=>{const map=new Map();for(const r of rows){if(!map.has(r.link))map.set(r.link,[]);map.get(r.link).push(r);}return map;};
    const apps=group(applications.rows),rpts=group(reports.rows),rows=[];
    const ids=new Map();for(const a of applications.rows)if(a.key)ids.set(a.key,(ids.get(a.key)||0)+1);
    let ambiguous=0,unknown=0;const heldKeys=[];
    for(const a of applications.rows){
      if(!a.completed)continue;
      if(apps.get(a.link).length!==1||ids.get(a.key)!==1||(rpts.get(a.link)||[]).length>1){ambiguous++;heldKeys.push(a.key);continue;}
      const dueDate=Calendar.addWorkdays(a.endDate,5,excluded);
      if(date<dueDate)continue;
      const report=rpts.get(a.link)?.[0];
      if(report&&!report.known){unknown++;heldKeys.push(a.key);continue;}
      if(report&&!report.unsubmitted)continue;
      rows.push({...a,dueDate,reason:report?'unsubmitted':'missing',reportKey:report?.key||null});
    }
    return {rows,ambiguous,unknown,heldKeys};
  }
  const api={period,coverage,validCoverage,verifyCounts,upgrade,collect,plan};root.TripReportDeadlineCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
