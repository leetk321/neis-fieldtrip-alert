/* Report alerts are independent of application deadlines. */
(function(root){
  'use strict';
  const C=root.TripCore||(typeof require==='function'?require('./core.js'):null);
  const clean=v=>C.normalize(v).replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');
  const candidate=r=>r&&clean(r.eduActPrcsStsNm)==='접수대기';
  const eligible=(r,approval)=>candidate(r)&&clean(r[approval])==='미상신';
  function learn(data,total){
    const lists=[];
    function walk(o,path=[]){
      if(!o||typeof o!=='object'||path.length>7)return;
      if(Array.isArray(o)){
        if(o.length&&o.every(r=>r&&typeof r==='object'&&['grd','clsCd','eduActPrcsStsNm'].every(k=>Object.hasOwn(r,k))))lists.push({path,rows:o});
      }else for(const [k,v] of Object.entries(o))walk(v,[...path,k]);
    }
    if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('서버 오류 응답입니다.');
    walk(data);
    if(lists.length!==1)throw Error('보고서 목록을 하나로 확인할 수 없습니다.');
    const {path,rows}=lists[0];
    if(!Number.isInteger(total)||total!==rows.length)throw Error('화면 총건수와 보고서 응답 건수가 다릅니다.\n전체 목록으로 연결하세요.');
    const keys=[...new Set(rows.flatMap(Object.keys))];
    const named=keys.filter(k=>k!=='eduActPrcsStsNm'&&/(?:atrz|approval|appr).*(?:sts|status).*(?:nm|name)$/i.test(k));
    const observed=keys.filter(k=>k!=='eduActPrcsStsNm'&&rows.some(r=>['미상신','완결','상신(진행)','회수','반려'].includes(clean(r[k]))));
    const approval=named.length===1?named[0]:observed.length===1?observed[0]:null;
    if(!approval)throw Error('보고서 결재상태 필드를 확인할 수 없습니다. 전체 상태로 다시 연결하세요.');
    const active=rows.filter(r=>eligible(r,approval));
    const possible=keys.filter(k=>/(?:report|rpt|rprt|rept|aply|appl|rqst|req|eduAct|experLrn).*(?:sn|id|no)$/i.test(k)&&!/(?:stu|user|prcs|sts|cls|grd)/i.test(k));
    const reportIds=possible.filter(k=>/(?:report|rpt|rprt|rept)/i.test(k));
    const ids=(reportIds.length?reportIds:possible).filter(k=>active.every(r=>C.normalize(r[k])));
    if(!ids.length||new Set(active.map(r=>JSON.stringify(ids.map(k=>r[k])))).size!==active.length)throw Error('보고서 고유번호를 확인할 수 없습니다. 다시 연결하세요.');
    return {kind:'report',path,approval,identity:ids,identityMode:'보고서 식별값'};
  }
  function resolve(data,schema){
    if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('서버 오류 응답입니다.');
    const rows=C.pathGet(data,schema.path);
    if(!Array.isArray(rows))throw Error('보고서 조회 구조가 변경되었습니다. 다시 연결하세요.');
    let total=null;
    if(schema.totalPath){const raw=C.pathGet(data,schema.totalPath);total=Number(raw);if(raw==null||String(raw).trim()===''||!Number.isInteger(total)||total!==rows.length)throw Error('보고서 전체 건수와 응답 행수가 다릅니다.');}
    if(!rows.length)return {pending:true,needsConfirmation:false};
    if(total===null)return {pending:true,needsConfirmation:true};
    const learned=learn(data,total);
    if(JSON.stringify(learned.path)!==JSON.stringify(schema.path))throw Error('보고서 목록 경로가 변경되었습니다.');
    return {pending:false,schema:learned};
  }
  function select(data,schema,config){
    if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('서버 오류 응답입니다.');
    const rows=C.pathGet(data,schema.path);
    if(!Array.isArray(rows))throw Error('보고서 목록 구조가 변경되었습니다. 다시 연결하세요.');
    const reports=[],seen=new Set();
    for(const row of rows){
      if(!row||typeof row!=='object'||!Object.hasOwn(row,'eduActPrcsStsNm'))throw Error('보고서 진행상태 필드가 변경되었습니다.');
      // Unrelated workflow states must not require IDs, dates, or names.
      if(!candidate(row))continue;
      if(!Object.hasOwn(row,schema.approval))throw Error('보고서 결재상태 필드가 변경되었습니다.');
      if(!eligible(row,schema.approval))continue;
      if(!Object.hasOwn(row,'grd')||!Object.hasOwn(row,'clsCd'))throw Error('보고서 학년·반 필드가 변경되었습니다.');
      if(C.numeric(row.grd)!==C.numeric(config.grade)||C.numeric(row.clsCd)!==C.numeric(config.classNo))continue;
      if(schema.identity.some(k=>!C.normalize(row[k])))throw Error('보고서 식별값이 비어 있습니다.');
      const key=JSON.stringify(schema.identity.map(k=>row[k]));if(seen.has(key))throw Error('보고서 식별값이 중복됩니다.');seen.add(key);
      const names=Object.keys(row).filter(k=>/^(?:stu|std|stdnt|student|stdr|stud)(?:nt)?(?:kor|korean|fl|full)?(?:nm|name)$/i.test(k)||k==='성명'||k==='학생명');
      const found=[...new Set(names.map(k=>C.normalize(row[k])).filter(Boolean))];
      reports.push({key,receipt:'접수대기',unsubmitted:true,studentName:found.length===1?found[0].replace(/[\r\n\t]+/g,' ').slice(0,100):'이름 확인 필요'});
    }
    return {reports,count:reports.length,total:rows.length};
  }
  const api={learn,resolve,select};root.TripReportCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
