const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../core.js'),R=require('../report-core.js');
// Synthetic rows; UI field names were confirmed on the NEIS report page.
const row=(id='1',receipt='접수대기',approval='미상신')=>({rptSn:id,eduActAplySn:'application-'+id,grd:'1',clsCd:'11',clsNo:'1',regDt:'2026.09.11',stuFlnm:'가상학생',eduActPrcsStsNm:receipt,atrzStsNm:approval,experLrnPeriod:'2026.09.07 ~ 2026.09.09'});
const cfg={grade:'1',classNo:'11'};
test('report alert selects exact waiting and unsubmitted after trip dates',()=>{
 const data={rows:[row()]},s=R.learn(data,1),out=R.select(data,s,cfg);
 assert.equal(out.count,1);assert.equal(out.reports[0].studentName,'가상학생');assert.deepEqual(s.identity,['rptSn']);
});
test('all other report workflow states are ignored before dates names and IDs are read',()=>{
 const original=row(),s=R.learn({rows:[original]},1);
 const ignored=['상신(진행)','회수','완결','완결(기결취소)','반려','새 상태',''].map(v=>({eduActPrcsStsNm:'접수대기',atrzStsNm:v}));
 ignored.push(...['접수취소','접수','새 접수상태'].map(v=>({eduActPrcsStsNm:v})));
 const result=R.select({rows:[original,...ignored]},s,cfg);assert.equal(result.count,1);
});
test('schema learning tolerates inactive rows without identifiers or valid dates',()=>{
 const other=row('2','접수취소','미상신');other.rptSn=null;other.experLrnPeriod=null;
 const s=R.learn({rows:[row(),other]},2);assert.equal(R.select({rows:[row(),other]},s,cfg).count,1);
});
test('report pending learning requires verified total and identical path',()=>{
 const pending={...C.pendingSchema({rows:[],totalCount:0},0),kind:'report'};
 assert.equal(R.resolve({rows:[row()],totalCount:1},pending).schema.kind,'report');
 assert.throws(()=>R.resolve({rows:[row()],totalCount:2},pending));
 const unknown=C.pendingSchema({rows:[]},0);assert.equal(R.resolve({rows:[row()]},unknown).needsConfirmation,true);
});
test('report schema and eligible identity corruption still fail closed',()=>{
 const s=R.learn({rows:[row()]},1);
 assert.throws(()=>R.select({rows:[{...row(),rptSn:''}]},s,cfg));
 assert.throws(()=>R.select({rows:[row(),row()]},s,cfg));
 assert.throws(()=>R.learn({rows:[row()]},2));
 const wrong={...row(),clsCd:'12'};assert.equal(R.select({rows:[wrong]},s,cfg).count,0);
});
