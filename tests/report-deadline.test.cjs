const {test}=require('node:test'),assert=require('node:assert/strict');
const D=require('../report-deadline-core.js'),C=require('../core.js'),R=require('../report-core.js'),Calendar=require('../calendar.js');
const config={year:'2026',grade:'1',classNo:'10'};
const row=(id='a',state='완결',number='11',period='2026.09.07 00:00 ~ 2026.09.09 23:59')=>({aplySn:id,rptSn:'r'+id,grd:'1',clsCd:'10',clsNo:number,regDt:'20260901',stuFlnm:'가상학생',eduActPrcsStsNm:'접수',atrzStsNm:state,experLrnPeriod:period});
function collect(rows,kind='application'){
 const data={rows,totalCount:rows.length},schema=rows.length?(kind==='report'?R:C).learn(data,rows.length):{...C.pendingSchema(data,0),kind};
 return D.collect(data,D.coverage(data,schema,rows.length),config,kind);
}
test('fifth working day excludes end day, weekends, holidays and custom days',()=>{
 assert.equal(Calendar.addWorkdays('2026-09-09',5),'2026-09-16');
 assert.equal(Calendar.addWorkdays('2026-09-18',5),'2026-09-29');
 assert.equal(Calendar.addWorkdays('2026-09-18',5,['2026-09-28']),'2026-09-30');
 assert.equal(Calendar.addWorkdays('2026-12-28',5),'2027-01-05');
});
test('end-date parsing accepts actual timed DOM format and compact server dates',()=>{
 for(const period of ['2026.09.07 00:00 ~ 2026.09.09 23:59','20260907000000~20260909235900','2026-09-07~2026-09-09'])assert.equal(D.period(period).endDate,'2026-09-09');
 for(const period of ['2026-09-07','2026-09-10~2026-09-09','2026-02-30~2026-03-02','bad'])assert.throws(()=>D.period(period));
});
test('missing report becomes due exactly on fifth workday, with catch-up thereafter',()=>{
 const a=collect([row()]),r=collect([],'report');
 assert.equal(D.plan(a,r,'2026-09-15').rows.length,0);
 for(const date of ['2026-09-16','2026-09-21']){const p=D.plan(a,r,date);assert.equal(p.rows.length,1);assert.equal(p.rows[0].reason,'missing');assert.equal(p.rows[0].dueDate,'2026-09-16');}
});
test('all report states count as existing; only unsubmitted is due',()=>{
 const a=collect([row()]);
 for(const state of ['미상신','완결','상신(진행)','회수','반려','완결(기결취소)','새 상태']){
  const p=D.plan(a,collect([row('different-id',state)],'report'),'2026-09-21');
  assert.equal(p.rows.length,state==='미상신'?1:0,state);
  if(p.rows.length)assert.equal(p.rows[0].reason,'unsubmitted');
 }
});
test('same-name students join by number; a student with multiple trips joins by dates',()=>{
 const a=collect([row('a','완결','1'),row('b','완결','2'),row('c','완결','1','2026.08.03~2026.08.04')]);
 const p=D.plan(a,collect([row('r','완결','1')],'report'),'2026-09-21');
 assert.equal(p.rows.length,2);assert.equal(p.rows.some(r=>r.link===a.rows[0].link),false);
});
test('duplicate applications and duplicate reports are held rather than paired arbitrarily',()=>{
 const empty=collect([],'report');
 assert.equal(D.plan(collect([row('a'),row('b')]),empty,'2026-09-21').ambiguous,2);
 const p=D.plan(collect([row()]),collect([row('r1','미상신'),row('r2','완결')],'report'),'2026-09-21');
 assert.equal(p.rows.length,0);assert.equal(p.ambiguous,1);
});
test('canceled completion and noncompleted applications never become report obligations',()=>{
 for(const state of ['미상신','완결(기결취소)','기결취소','상신(진행)'])assert.equal(D.plan(collect([row('a',state)]),collect([],'report'),'2026-09-21').rows.length,0);
 const r=row();r.eduActPrcsStsNm='접수취소';assert.equal(D.plan(collect([r]),collect([],'report'),'2026-09-21').rows.length,0);
});
test('old full-query schemas upgrade automatically while partial, failed and malformed results are held',()=>{
 const data={rows:[row()],totalCount:1},s=C.learn(data,1),full=D.coverage(data,s,1);
 assert.equal(D.collect(data,s,config,'application').ready,true);
 assert.equal(D.upgrade(data,s).coverage.source,'saved-full-query');assert.equal(s.coverage,undefined);
 for(const broken of [{...data,totalCount:2},{...data,totalCount:null},{...data,error:'failed'},{rows:[]}])assert.equal(D.collect(broken,full,config,'application').ready,false);
 for(const change of [{clsNo:''},{experLrnPeriod:null},{grd:null}]){const bad={rows:[{...row(),...change}],totalCount:1};assert.equal(D.collect(bad,full,config,'application').ready,false);}
 assert.throws(()=>D.plan(collect([row()]),{ready:false,reason:'조회 실패'},'2026-09-21'),/조회 실패/);
});
test('unknown report approval is held; leading zero student numbers pair',()=>{
 const a=collect([row('a','완결','011')]);
 const report=collect([row('r','완결','11')],'report');report.rows[0].known=false;
 const p=D.plan(a,report,'2026-09-21');assert.equal(p.rows.length,0);assert.equal(p.unknown,1);
});
