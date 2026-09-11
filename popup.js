'use strict';
const $=id=>document.getElementById(id);
const sentenceSegmenter=new Intl.Segmenter('ko',{granularity:'sentence'});
// Keep a fitting sentence together; allow short sentences to share a line.
// Explicit newlines remain boundaries, and CSS wraps long sentences at spaces.
function setCopy(element,text){
  const value=String(text??'');
  if(element.dataset.copy===value)return;
  element.dataset.copy=value;
  element.replaceChildren();
  if(!value)return;
  for(const [index,line] of value.split('\n').entries()){
    if(index)element.append(document.createTextNode('\n'));
    const row=document.createElement('span');row.className='copy-line';
    for(const {segment} of sentenceSegmenter.segment(line)){
      const sentence=document.createElement('span');sentence.className='copy-sentence';
      sentence.textContent=segment.trimEnd();row.append(sentence);
      const space=segment.slice(segment.trimEnd().length);
      if(space)row.append(document.createTextNode(space));
    }
    element.append(row);
  }
}
// Plain explanatory paragraphs use the same flow; formatted lists retain their markup.
for(const p of document.querySelectorAll('p'))if(!p.children.length&&p.textContent.trim())setCopy(p,p.textContent);
let initialized=false, dirty=false, configured=false, connected=false, busy=false;
let reportConnected=false;
const labels={learning:'신청서 학습 대기',setup:'처음 설정',watching:'감시 중',paused:'확인 필요',waiting:'나이스 대기',disconnected:'연결 필요',connecting:'연결 중'};
function controls(){
  document.querySelectorAll('button').forEach(b=>b.disabled=busy);
  $('connect').disabled=busy||!configured;
  $('check').disabled=busy||!connected;
  $('queryTest').disabled=busy||!connected;
  $('reportConnect').disabled=busy||!configured;
  $('reportCheck').disabled=busy||!reportConnected;
  $('reportQueryTest').disabled=busy||!reportConnected;
}
function renderAlerts(items){
  const box=$('alertLog');box.replaceChildren();
  if(!Array.isArray(items)||!items.length){const p=document.createElement('p');p.className='alert-empty';p.textContent='표시할 알림이 없습니다.';box.appendChild(p);return;}
  for(const item of items){
    const article=document.createElement('article'),head=document.createElement('div'),title=document.createElement('b'),time=document.createElement('time'),body=document.createElement('p');
    article.dataset.kind=item.kind||'';
    title.textContent=item.title||'교외체험학습 알림';time.textContent=item.createdAt?new Date(item.createdAt).toLocaleString('ko-KR'):'';body.textContent=item.message||'';
    head.append(title,time);article.append(head,body);box.appendChild(article);
  }
}
function renderSummary(id,status,kind){
  const state=status.state;
  const label=state==='learning'?'학습 대기':state==='setup'?'설정 필요':labels[state]||'연결 필요';
  const count=Number.isInteger(status.count)&&status.count>=0
    ?' · '+(state==='watching'?(kind==='report'?'대상 ':'미상신 '):'최근 ')+status.count+'건':'';
  $(id).textContent=label+count;
}
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'확장 프로그램 응답을 확인할 수 없습니다.');return result;}
async function refresh(){
  try {
    const data=await request({type:'STATE'}),s=data.status||{};
    $('consentBox').hidden=data.privacyConsented===true;
    configured=data.configured===true;connected=data.connected===true;
    const report=data.report||{},rs=report.status||{};
    reportConnected=report.connected===true;
    renderSummary('applicationSummary',s,'application');
    renderSummary('reportSummary',rs,'report');
    $('reportConsentBox').hidden=report.privacyConsented===true;
    $('reportState').textContent=(rs.state==='learning'?'보고서 학습 대기':labels[rs.state]||'연결 필요')+(rs.count==null?'':' · '+rs.count+'건');
    setCopy($('reportStatus'),rs.message||'보고서관리에서 조회를 별도로 연결하세요.');
    $('reportChecked').textContent=rs.lastCheck?'마지막 성공 조회 '+new Date(rs.lastCheck).toLocaleString('ko-KR'):'';
    $('reportAuto').textContent='보고서 자동 재개: '+(report.autoStart?'켜짐':'꺼짐');
    $('setupNotice').hidden=configured;
    $('save').textContent=configured?'설정 저장':'설정 완료';
    controls();
    if(!initialized){for(const id of ['year','grade','classNo','interval'])$(id).value=data.config[id];$('excludedDates').value=(data.config.excludedDates||[]).join('\n');initialized=true;}
    $('state').textContent=labels[s.state]||'연결 필요';
    $('count').textContent=s.count==null?'—':s.count+'건';
    setCopy($('status'),s.message||'나이스에서 조회를 연결하세요.');
    $('checked').textContent=s.lastCheck?'마지막 성공 조회 '+new Date(s.lastCheck).toLocaleString('ko-KR'):'';
    $('autoState').textContent=data.autoStart?'브라우저 재실행 시 자동 재개: 켜짐':'브라우저 재실행 시 자동 재개: 꺼짐';
    $('identityMode').textContent=s.identityMode?'중복 비교 기준: '+s.identityMode:'';
    $('nextReminder').textContent=s.nextReminder?'다음 미상신 확인 기준일: '+s.nextReminder:'';
    const h=data.holidayInfo||{};
    $('holidayStatus').textContent=h.updatedAt?'공휴일 최근 갱신: '+new Date(h.updatedAt).toLocaleString('ko-KR')+(h.failed?' · 재조회 실패, 저장 자료로 계속 동작':''):'공휴일: 내장 자료 사용'+(h.failed?' · 다운로드 실패, 감시는 계속 동작':'');
    if(h.years?.length)$('holidayStatus').textContent+='\n저장된 연도: '+h.years.join(', ');
    renderAlerts(data.alertLog);
  }catch(e){setCopy($('globalMessage'),e.message);$('applicationSummary').textContent='확인 필요';$('reportSummary').textContent='확인 필요';}
}
async function action(type,extra={}){
  const message=$(['SAVE','RESET','TEST'].includes(type)?'globalMessage':'message');
  setCopy(message,type==='ARM'?'나이스 연결을 준비하고 있습니다…':'');
  busy=true;controls();
  try{
    const result=await request({type,...extra});await refresh();
    if(type==='ARM')setCopy(message,'연결 준비 완료\n60초 안에 진행해 주세요.\n① 이 팝업을 닫으세요.\n② 나이스의 조회 버튼을 누르세요.');
    if(type==='QUERY_TEST')setCopy(message,result.awaitingSchema?(result.needsConfirmation?'신청서 발견\n전체 건수 확인을 위해 연결 시작 후 나이스에서 조회하세요.':'조회 응답 확인\n아직 신청서 학습 대기 중입니다.'):`조회 성공 · 현재 미상신 ${result.count}건\n확인 일시: ${new Date(result.checkedAt).toLocaleString('ko-KR')}\n알림 이력은 변경하지 않았습니다.`);
    if(type==='SAVE')setCopy(message,'설정을 저장했습니다.\n신청서와 보고서를 각각 다시 연결해 주세요.');
    if(type==='RESET')setCopy(message,'알림 기록만 초기화했습니다. 두 연결은 유지됩니다. 다음 확인에서 조건에 맞는 신청서와 보고서를 다시 알릴 수 있습니다.');
    if(type==='TEST')setCopy(message,result.pageShown?'최근 알림과 나이스 화면에 표시 테스트를 완료했습니다.':'최근 알림에 표시 테스트를 완료했습니다. Windows 알림 설정과 무관하게 확인할 수 있습니다.');
    return true;
  }
  catch(e){setCopy(message,e.message.includes('Receiving end')?'나이스 연결을 확인할 수 없습니다.\n신청서관리 화면에서 다시 연결해 주세요.':e.message);return false;}
  finally{busy=false;controls();if(type==='ARM'||message.id==='globalMessage'){message.focus({preventScroll:true});message.scrollIntoView({block:'center'});}}
}
$('settings').addEventListener('input',()=>dirty=true);
$('settings').addEventListener('submit',async e=>{e.preventDefault();const c={};for(const id of ['year','grade','classNo','interval'])c[id]=$(id).value;c.excludedDates=$('excludedDates').value;if(await action('SAVE',{config:c}))dirty=false;});
$('connect').onclick=()=>{if(dirty){setCopy($('message'),'변경한 설정을 먼저 저장하세요.');$('message').focus({preventScroll:true});$('message').scrollIntoView({block:'center'});}else if(!$('consentBox').hidden&&!$('privacyAgree').checked){setCopy($('message'),'연결 전 개인정보 처리 안내를 읽고 동의해 주세요.');$('consentBox').scrollIntoView({block:'center'});$('privacyAgree').focus();}else action('ARM',{consent:$('privacyAgree').checked});};
for(const [id,type] of [['queryTest','QUERY_TEST'],['check','CHECK'],['stop','STOP'],['test','TEST'],['reset','RESET']])$(id).onclick=()=>action(type);
async function reportAction(type){
  const message=$('reportMessage');
  if(type==='REPORT_ARM'&&dirty){setCopy(message,'변경한 설정을 먼저 저장하세요.');message.focus();return;}
  if(type==='REPORT_ARM'&&!$('reportConsentBox').hidden&&!$('reportAgree').checked){setCopy(message,'보고서 정보 처리 안내를 읽고 동의해 주세요.');$('reportAgree').focus();return;}
  busy=true;controls();setCopy(message,'보고서를 확인하고 있습니다…');
  try{
    const result=await request({type,consent:$('reportAgree').checked});await refresh();
    setCopy(message,type==='REPORT_ARM'?'보고서 연결 준비 완료\n60초 안에 진행해 주세요.\n① 팝업을 닫으세요.\n② 보고서관리 화면의 조회를 누르세요.':type==='REPORT_STOP'?'보고서 감시와 자동 재개를 중지했습니다.':type==='REPORT_QUERY_TEST'?(result.awaitingSchema?(result.needsConfirmation?'보고서 발견\n전체 건수 확인을 위해 다시 연결하세요.':'정상 빈 응답\n첫 보고서 학습 대기'):`보고서 조회 성공 · 접수대기·미상신 ${result.count}건\n알림 이력은 변경하지 않았습니다.`):'보고서 확인을 마쳤습니다. 위 상태와 최근 알림을 확인하세요.');
  }catch(e){setCopy(message,e.message.includes('Receiving end')?'나이스 연결을 확인할 수 없습니다.\n보고서관리 화면에서 다시 연결해 주세요.':e.message);}
  finally{busy=false;controls();message.focus({preventScroll:true});message.scrollIntoView({block:'center'});}
}
for(const [id,type]of [['reportConnect','REPORT_ARM'],['reportCheck','REPORT_CHECK'],['reportQueryTest','REPORT_QUERY_TEST'],['reportStop','REPORT_STOP']])$(id).onclick=()=>reportAction(type);
chrome.storage.onChanged.addListener(()=>refresh());
refresh();
