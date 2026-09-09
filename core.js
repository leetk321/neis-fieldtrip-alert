/* Independent implementation. No student data or authentication values bundled. */
(function (root) {
  'use strict';
  const Calendar=root.TripCalendar||(typeof require==='function'?require('./calendar.js'):null);
  const normalize = value => String(value ?? '').trim();
  const compact = value => normalize(value).replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');
  const approvalStatuses = new Set(['미상신','완결','승인완료','결재중','상신','상신(진행)','반려','회수','기결취소','진행중']);
  const isApprovalStatus = value => approvalStatuses.has(value) || /^상신(?:\([^()]+\))?$/.test(value);
  const numeric = value => normalize(value).replace(/^0+(?=\d)/, '');
  const pathGet = (obj, path) => path.reduce((o, k) => o?.[k], obj);
  function arrays(obj, path = [], result = []) {
    if (path.length > 7 || !obj || typeof obj !== 'object') return result;
    if (Array.isArray(obj)) {
      if (obj.length && obj.every(v => v && typeof v === 'object' && !Array.isArray(v))) result.push({path, rows: obj});
    } else for (const [key, value] of Object.entries(obj)) arrays(value, [...path, key], result);
    return result;
  }
  function schoolYear(date=Calendar.today()){
    const iso=Calendar.parseDate(date);return String(Number(iso.slice(0,4))-(Number(iso.slice(5,7))<3?1:0));
  }
  function pendingSchema(data,total){
    if(total!==0||data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('빈 응답을 검증할 수 없습니다.');
    const lists=[],counts=[];
    function walk(o,path=[]){
      if(path.length>7||!o||typeof o!=='object')return;
      if(Array.isArray(o)){lists.push({path,value:o});return;}
      for(const [k,v] of Object.entries(o)){
        if(/^(totalCount|totalCnt|totalRowCount|totCnt|totCount)$/i.test(k)&&Number.isInteger(Number(v))&&String(v).trim()!==''&&v!==null)counts.push({path:[...path,k],value:Number(v)});
        walk(v,[...path,k]);
      }
    }
    walk(data);
    if(lists.length!==1||lists[0].value.length!==0||counts.some(c=>c.value!==0))throw Error('빈 신청서 목록을 하나로 확인할 수 없습니다. 조회 응답 확인이 필요합니다.');
    return {pending:true,path:lists[0].path,totalPath:counts.length===1?counts[0].path:null,identityMode:'첫 신청서 학습 대기'};
  }
  function resolvePending(data,schema){
    if(data?.error||data?.errorMessage||data?.errMsg||data?.exception)throw Error('서버 오류 응답입니다.');
    const rows=pathGet(data,schema.path);
    if(!Array.isArray(rows))throw Error('대기 중인 조회 응답 구조가 변경되었습니다. 다시 연결하세요.');
    let total=null;
    if(schema.totalPath){
      const raw=pathGet(data,schema.totalPath);total=Number(raw);
      if(raw==null||String(raw).trim()===''||!Number.isInteger(total)||total!==rows.length)throw Error('전체 건수와 응답 행수가 다릅니다. 전체 목록으로 다시 연결하세요.');
    }
    if(!rows.length)return {pending:true,needsConfirmation:false};
    if(total===null)return {pending:true,needsConfirmation:true};
    const learned=learn(data,total);
    if(JSON.stringify(learned.path)!==JSON.stringify(schema.path))throw Error('신청서 목록 경로가 변경되었습니다.');
    return {pending:false,schema:learned};
  }
  function learn(data, total) {
    const matches = arrays(data).filter(({rows}) => rows.every(r =>
      ['grd', 'clsCd', 'clsNo', 'regDt', 'eduActPrcsStsNm'].every(k => Object.hasOwn(r, k))));
    if (matches.length !== 1) throw Error('신청서 응답을 하나로 식별하지 못했습니다. 연결을 다시 시도하세요.');
    const {path, rows} = matches[0];
    if (!Number.isInteger(total) || total !== rows.length) throw Error('화면 총건수와 응답 건수가 다릅니다. 전체 목록을 조회한 뒤 다시 연결하세요.');
    const keys = Object.keys(rows[0]);
    const namedApprovals=keys.filter(k=>k!=='eduActPrcsStsNm'&&/(?:atrz|approval|appr).*(?:sts|status).*(?:nm|name)$/i.test(k));
    const statuses = keys.filter(k => k !== 'eduActPrcsStsNm' && rows.some(r => isApprovalStatus(compact(r[k]))));
    const approval = namedApprovals.length===1?namedApprovals[0]:statuses.length === 1 ? statuses[0] : null;
    if (!approval) throw Error('결재상태 필드를 확인할 수 없습니다. 결재상태 전체로 조회하세요.');
    const ids = keys.filter(k => /(?:aply|appl|rqst|req|eduAct|experLrn).*(?:sn|id|no)$/i.test(k) &&
      !/(?:stu|user|prcs|sts|cls|grd)/i.test(k) && rows.every(r => normalize(r[k])));
    let identity = ids.length && new Set(rows.map(r => JSON.stringify(ids.map(k => r[k])))).size === rows.length ? ids : null;
    let identityMode = '신청서 식별값';
    if (!identity) {
      throw Error('신청서별 2회 알림을 위해 고유번호 필드 확인이 필요합니다. 날짜 조합으로 대신 연결하지 않습니다.');
    }
    const startFields=keys.filter(k=>k==='experLrnPeriod'||/(?:exper|lrn).*(?:bgng|bgn|start|begin).*(?:ymd|dt|date)/i.test(k));
    const startDate=startFields.includes('experLrnPeriod')?'experLrnPeriod':startFields.length===1?startFields[0]:null;
    if(!startDate)throw Error('체험 시작일 필드를 확인하지 못했습니다. 5근무일 전 알림을 위해 필드 확인이 필요합니다.');
    // Validate only records this extension actually monitors; other workflow states are ignored.
    rows.filter(r=>['접수대기','접수취소'].includes(normalize(r.eduActPrcsStsNm))&&compact(r[approval])==='미상신')
      .forEach(r=>Calendar.parseDate(r[startDate]));
    return {path, approval, identity, identityMode, startDate};
  }
  function select(data, schema, config) {
    if (data?.error || data?.errorMessage || data?.errMsg || data?.exception)
      throw Error('서버가 오류 응답을 반환했습니다. 나이스 로그인과 조회 화면을 확인하세요.');
    const rows = pathGet(data, schema.path);
    if (!Array.isArray(rows)) throw Error('조회 응답 구조가 변경되었거나 로그인이 만료되었습니다. 다시 연결하세요.');
    const targets = [], records=[], departures=[], unique = new Set();
    for (const row of rows) {
      if(!row||typeof row!=='object')throw Error('신청서 행 형식을 확인할 수 없습니다.');
      for (const key of ['grd', 'clsCd', 'eduActPrcsStsNm']) {
        if (!Object.hasOwn(row, key)) throw Error('필수 필드가 사라져 감시를 중단했습니다. 다시 연결하세요.');
      }
      if (numeric(row.grd) !== numeric(config.grade) || numeric(row.clsCd) !== numeric(config.classNo)) continue;
      const receipt = normalize(row.eduActPrcsStsNm);
      if (!['접수대기','접수취소','접수'].includes(receipt)) continue;
      if(!Object.hasOwn(row,schema.approval))throw Error('결재상태 필드가 사라져 감시를 중단했습니다. 다시 연결하세요.');
      const approval = compact(row[schema.approval]);
      const completed=approval==='완결'&&!compact(receipt).includes('기결취소');
      const pending=approval==='미상신'&&['접수대기','접수취소'].includes(receipt);
      if(!completed&&!pending)continue;
      const key = JSON.stringify(schema.identity.map(k => row[k]));
      if (schema.identity.some(k => row[k] == null || normalize(row[k]) === ''))
        throw Error('신청서 식별값이 비어 있어 비교할 수 없습니다.');
      if (unique.has(key)) throw Error('신청서 식별값 중복으로 안전하게 비교할 수 없습니다.');
      unique.add(key);
      if(!Object.hasOwn(row,schema.startDate))throw Error('체험 시작일 필드가 사라져 감시를 중단했습니다. 다시 연결하세요.');
      const startDate=Calendar.parseDate(row[schema.startDate]);
      const nameKeys=Object.keys(row).filter(k=>/^(?:stu|std|stdnt|student|stdr|stud)(?:nt)?(?:kor|korean|fl|full)?(?:nm|name)$/i.test(k)||k==='성명'||k==='학생명');
      const foundNames=[...new Set(nameKeys.map(k=>normalize(row[k])).filter(Boolean))];
      const studentName=foundNames.length===1?foundNames[0].replace(/[\r\n\t]+/g,' ').slice(0,100):'이름 확인 필요';
      if(completed){
        const period=normalize(row.experLrnPeriod||row[schema.startDate]).replace(/[\r\n\t]+/g,' ').replace(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:\d{2})?/g,'$1.$2.$3 $4:$5').replace(/(\d{4})(\d{2})(\d{2})/g,'$1.$2.$3').slice(0,200);
        departures.push({key,startDate,studentName,period});continue;
      }
      records.push({key,receipt,unsubmitted:true,startDate,studentName});
      targets.push(key);
    }
    return {keys: targets, records, departures, count: targets.length, total: rows.length};
  }
  function diff(previous, current) {
    const old = new Set(previous || []);
    return current.filter(k => !old.has(k));
  }
  function plan(records,previous={},date=Calendar.today(),excluded=[],completed=[]){
    const history=JSON.parse(JSON.stringify(previous)),first=[],reminder=[],departure=[],warnings=[],dueDates=[];
    for(const row of records){
      if(!['접수대기','접수취소'].includes(row.receipt)||date>row.startDate)continue;
      const old=history[row.key]||{};
      const entry=history[row.key]={...old,observed:true};
      // First alert is sent once when an application first becomes eligible as pending or canceled.
      const firstEligible=row.unsubmitted&&['접수대기','접수취소'].includes(row.receipt);
      if(!old.firstSent&&!old.firstEligibleObserved&&firstEligible)first.push(row.key);
      entry.firstEligibleObserved=old.firstEligibleObserved||firstEligible;
      entry.firstPending=old.firstPending||first.includes(row.key);
      if(!row.unsubmitted)continue;
      try{
        const dueDate=Calendar.subtractWorkdays(row.startDate,5,excluded);
        dueDates.push({key:row.key,date:dueDate});
        if(date>=dueDate&&!old.reminderSent)reminder.push(row.key);
      }catch(e){warnings.push(e.message);}
      // Flags for notifications are committed by the worker after Chrome accepts them.
    }
    // Retry a failed initial delivery while the application is still pending or canceled.
    for(const row of records)if(date<=row.startDate&&row.unsubmitted&&history[row.key]?.firstPending&&!history[row.key].firstSent&&['접수대기','접수취소'].includes(row.receipt)&&!first.includes(row.key))first.push(row.key);
    for(const row of completed){
      const entry=history[row.key]||(history[row.key]={});
      const due=Calendar.subtractWorkdays(row.startDate,1,excluded);
      if(date>=due&&date<=row.startDate&&!entry.departureSent)departure.push(row.key);
    }
    return {history,first,reminder,departure,warnings:[...new Set(warnings)],dueDates};
  }
  function endpoint(url, origin) {
    const u = new URL(url, origin);
    if (u.origin !== origin || !u.pathname.endsWith('.do') || u.username || u.password || u.hash)
      throw Error('같은 나이스 사이트의 조회 요청만 연결할 수 있습니다.');
    return u.pathname + u.search;
  }
  function config(input) {
    const c = {...input};
    if (!/^\d{4}$/.test(String(c.year)) || !/^[1-6]$/.test(String(c.grade)) ||
      !/^\d{1,3}$/.test(String(c.classNo)) || Number(c.classNo) < 1)
      throw Error('학년도, 학년, 반을 올바르게 입력하세요.');
    c.interval = Number(c.interval);
    if (![3, 5, 10, 15].includes(c.interval)) throw Error('조회 간격은 3·5·10·15분 중 선택하세요.');
    return {year: String(c.year), grade: numeric(c.grade), classNo: numeric(c.classNo), interval:c.interval,excludedDates:Calendar.excludedDates(c.excludedDates)};
  }
  const api = {schoolYear,pendingSchema,resolvePending,normalize, numeric, pathGet, learn, select, diff, endpoint, config, plan};
  root.TripCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
