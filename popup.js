'use strict';
const $=id=>document.getElementById(id);
let initialized=false, dirty=false, configured=false, connected=false, busy=false;
const labels={learning:'신청서 학습 대기',setup:'처음 설정',watching:'감시 중',paused:'확인 필요',waiting:'나이스 대기',disconnected:'연결 필요',connecting:'연결 중'};
function controls(){
  document.querySelectorAll('button').forEach(b=>b.disabled=busy);
  $('connect').disabled=busy||!configured;
  $('check').disabled=busy||!connected;
  $('queryTest').disabled=busy||!connected;
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
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'확장 프로그램 응답을 확인할 수 없습니다.');return result;}
async function refresh(){
  try {
    const data=await request({type:'STATE'}),s=data.status||{};
    configured=data.configured===true;connected=data.connected===true;
    $('setupNotice').hidden=configured;
    $('save').textContent=configured?'설정 저장':'설정 완료';
    controls();
    if(!initialized){for(const id of ['year','grade','classNo','interval'])$(id).value=data.config[id];$('excludedDates').value=(data.config.excludedDates||[]).join('\n');initialized=true;}
    $('state').textContent=labels[s.state]||'연결 필요';
    $('count').textContent=s.count==null?'—':s.count+'건';
    $('status').textContent=s.message||'나이스에서 조회를 연결하세요.';
    $('checked').textContent=s.lastCheck?'마지막 성공 조회 '+new Date(s.lastCheck).toLocaleString('ko-KR'):'';
    $('autoState').textContent=data.autoStart?'브라우저 재실행 시 자동 재개: 켜짐':'브라우저 재실행 시 자동 재개: 꺼짐';
    $('identityMode').textContent=s.identityMode?'중복 비교 기준: '+s.identityMode:'';
    $('nextReminder').textContent=s.nextReminder?'다음 미상신 확인 기준일: '+s.nextReminder:'';
    const h=data.holidayInfo||{};
    $('holidayStatus').textContent=h.updatedAt?'공휴일 최근 갱신: '+new Date(h.updatedAt).toLocaleString('ko-KR')+(h.failed?' · 재조회 실패, 저장 자료로 계속 동작':''):'공휴일: 내장 자료 사용'+(h.failed?' · 다운로드 실패, 감시는 계속 동작':'');
    if(h.years?.length)$('holidayStatus').textContent+='\n저장된 연도: '+h.years.join(', ');
    renderAlerts(data.alertLog);
  }catch(e){$('message').textContent=e.message;}
}
async function action(type,extra={}){
  $('message').textContent=type==='ARM'?'나이스 연결을 준비하고 있습니다…':'';
  busy=true;controls();
  try{const result=await request({type,...extra});await refresh();if(type==='ARM')$('message').textContent='연결 준비 완료 · 60초 안에 진행해 주세요.\n① 이 팝업을 닫으세요.\n② 나이스의 조회 버튼을 누르세요.';if(type==='QUERY_TEST')$('message').textContent=result.awaitingSchema?(result.needsConfirmation?'신청서 발견 · 전체 건수 확인을 위해 연결 시작 후 나이스에서 조회하세요.':'조회 응답 확인 · 아직 신청서 학습 대기 중입니다.'):`조회 성공 · 현재 미상신 ${result.count}건 · ${new Date(result.checkedAt).toLocaleString('ko-KR')} · 알림 이력은 변경하지 않았습니다.`;if(type==='RESET')$('message').textContent='알림 기록만 초기화했습니다. 연결은 유지됩니다. 지금 확인을 누르면 현재 신청서를 새 알림처럼 다시 확인합니다.';if(type==='TEST')$('message').textContent=result.pageShown?'최근 알림과 나이스 화면에 표시 테스트를 완료했습니다.':'최근 알림에 표시 테스트를 완료했습니다. Windows 알림 설정과 무관하게 확인할 수 있습니다.';return true;}
  catch(e){$('message').textContent=e.message.includes('Receiving end')?'나이스 탭을 새로고침하고 신청서관리 화면에서 다시 연결하세요.':e.message;return false;}
  finally{busy=false;controls();if(type==='ARM'){ $('message').focus({preventScroll:true});$('message').scrollIntoView({block:'center'}); }}
}
$('settings').addEventListener('input',()=>dirty=true);
$('settings').addEventListener('submit',async e=>{e.preventDefault();const c={};for(const id of ['year','grade','classNo','interval'])c[id]=$(id).value;c.excludedDates=$('excludedDates').value;if(await action('SAVE',{config:c}))dirty=false;});
$('connect').onclick=()=>{if(dirty){$('message').textContent='변경한 설정을 먼저 저장하세요.';$('message').focus({preventScroll:true});$('message').scrollIntoView({block:'center'});}else action('ARM');};
for(const [id,type] of [['queryTest','QUERY_TEST'],['check','CHECK'],['stop','STOP'],['test','TEST'],['reset','RESET']])$(id).onclick=()=>action(type);
chrome.storage.onChanged.addListener(()=>refresh());
refresh();
