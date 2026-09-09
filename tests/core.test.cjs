const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../core.js');
const cfg={year:'2026',grade:'1',classNo:'11',interval:5,excludedDates:[]};
const row=(id,receipt='접수대기',approval='미상신',cls='11')=>({aplySn:id,grd:'1',clsCd:cls,clsNo:1,regDt:'20260909',eduActPrcsStsNm:receipt,atrzStsNm:approval,experLrnPeriod:'20260910~20260911'});
const data={data:{dsMain:[row('test-1'),row('test-2','접수취소'),row('test-3','접수','완결'),row('test-4','접수대기','미상신','1')]}};
test('learns response path and actual approval label field',()=>{const s=C.learn(data,4);assert.deepEqual(s.path,['data','dsMain']);assert.equal(s.approval,'atrzStsNm');assert.deepEqual(s.identity,['aplySn']);});
test('only pending and canceled unsubmitted requests stay in scope',()=>{const result=C.select(data,C.learn(data,4),cfg);assert.equal(result.count,2);assert.equal(result.total,4);assert.equal(result.records.length,2);assert.equal(result.records[1].receipt,'접수취소');});
test('submitted in progress variants are learned and excluded without errors',()=>{for(const status of ['상신(진행)',' 상신（진행） ','상신(진행중)']){const d={dsMain:[row('active','접수대기',status)]};const result=C.select(d,C.learn(d,1),cfg);assert.equal(result.count,0);assert.equal(result.records.length,0);}});
test('other approval workflow states are ignored without errors',()=>{for(const status of ['회수','반려','결재중','임의진행상태']){const d={dsMain:[row('active','접수취소',status)]};const result=C.select(d,C.learn(d,1),cfg);assert.equal(result.count,0);assert.equal(result.records.length,0);}});
test('same counts with replacement application still notify',()=>assert.deepEqual(C.diff(['a'],['b']),['b']));
test('unchanged application does not notify',()=>assert.deepEqual(C.diff(['a'],['a']),[]));
test('application returning after cancellation can notify',()=>{assert.deepEqual(C.diff(['a'],[]),[]);assert.deepEqual(C.diff([],['a']),['a']);});
test('partial response cannot be learned',()=>assert.throws(()=>C.learn(data,5),/총건수/));
test('empty initial response cannot establish schema',()=>assert.throws(()=>C.learn({dsMain:[]},0),/식별/));
test('valid empty later response is zero',()=>{const s=C.learn(data,4);assert.equal(C.select({data:{dsMain:[]}},s,cfg).count,0);});
test('missing response array and changed fields fail closed',()=>{const s=C.learn(data,4);assert.throws(()=>C.select({login:true},s,cfg));assert.throws(()=>C.select({data:{dsMain:[{grd:'1'}]}},s,cfg));});
test('ambiguous application lists fail closed',()=>assert.throws(()=>C.learn({one:data.data.dsMain,two:data.data.dsMain},4),/하나로/));
test('other receipt states are ignored without stopping monitoring',()=>{const s=C.learn(data,4),result=C.select({data:{dsMain:[row('new','알수없음','임의진행상태')]}},s,cfg);assert.equal(result.count,0);assert.equal(result.records.length,0);});
test('duplicate identities stop monitoring',()=>{const s=C.learn(data,4);assert.throws(()=>C.select({data:{dsMain:[row('a'),row('a')]}},s,cfg),/중복/);});
test('stable application ID is required rather than date-based fallback',()=>{const a=row('a');delete a.aplySn;assert.throws(()=>C.learn({dsMain:[a]},1),/고유번호/);});
test('different origin and non-query URLs rejected',()=>{assert.throws(()=>C.endpoint('https://other.example/list.do','https://goe.neis.go.kr'));assert.throws(()=>C.endpoint('/page.html','https://goe.neis.go.kr'));assert.equal(C.endpoint('/observed.do','https://goe.neis.go.kr'),'/observed.do');});
test('leading-zero class codes match exact numeric class',()=>{const d={dsMain:[row('a','접수대기','미상신','011')]};assert.equal(C.select(d,C.learn(d,1),cfg).count,1);});
test('invalid config rejected and valid config normalized',()=>{assert.deepEqual(C.config(cfg),cfg);assert.throws(()=>C.config({...cfg,classNo:'0'}));assert.throws(()=>C.config({...cfg,interval:0.1}));});


test('approval code never replaces the display name',()=>{const r=row('a');r.atrzStsCd='0';const d={dsMain:[r]};assert.equal(C.learn(d,1).approval,'atrzStsNm');assert.equal(C.select(d,C.learn(d,1),cfg).count,1);delete r.atrzStsNm;assert.throws(()=>C.learn(d,1),/결재상태/);});
test('irrelevant workflows skip absent identifiers and dates after schema learning',()=>{const s=C.learn(data,4);const ignored=row('a','접수취소','회수');delete ignored.aplySn;delete ignored.experLrnPeriod;const d={data:{dsMain:[ignored,row('b')]}};assert.equal(C.select(d,s,cfg).count,1);});

test('only exact completed status enters separate departure list',()=>{const d={dsMain:[row('a','접수','완결'),row('b','접수','상신(진행)'),row('c','접수','회수'),row('d','접수취소','미상신')]};const result=C.select(d,C.learn(d,4),cfg);assert.equal(result.departures.length,1);assert.equal(result.departures[0].startDate,'2026-09-10');assert.equal(result.count,1);assert.equal(result.records[0].receipt,'접수취소');});

test('canceled completed variants are excluded without reading names or dates',()=>{for(const status of ['완결(기결취소)','완결 （ 기결취소 ）','기결취소']){const d={dsMain:[row('a','접수',status)]};const schema=C.learn(d,1);assert.equal(C.select(d,schema,cfg).departures.length,0);}});
test('student names survive selection for both pending and completed records',()=>{const d={dsMain:[{...row('a'),stdntFlnm:'테스트가'},{...row('b','접수','완결'),stdntFlnm:'테스트나'}]};const r=C.select(d,C.learn(d,2),cfg);assert.equal(r.records[0].studentName,'테스트가');assert.equal(r.departures[0].studentName,'테스트나');});

test('completed alerts retain readable full experience period with times',()=>{const d={dsMain:[{...row('p','접수','완결'),stdntNm:'테스트',experLrnPeriod:'20260916000000~20260918235900'}]};const r=C.select(d,C.learn(d,1),cfg);assert.equal(r.departures[0].period,'2026.09.16 00:00~2026.09.18 23:59');});

test('academic year changes on March 1 in Korea, not January 1',()=>{for(const [date,year] of [['2026-03-01','2026'],['2026-12-31','2026'],['2027-01-01','2026'],['2027-02-28','2026'],['2027-03-01','2027'],['2028-02-29','2027']])assert.equal(C.schoolYear(date),year);});
test('empty capture stores provisional path and verified zero total, later learns full response',()=>{const s=C.pendingSchema({data:{dsMain:[],totalCount:0}},0);assert.equal(s.pending,true);assert.deepEqual(s.path,['data','dsMain']);assert.equal(C.resolvePending({data:{dsMain:[],totalCount:0}},s).pending,true);const d={data:{dsMain:[row('a')],totalCount:1}},r=C.resolvePending(d,s);assert.equal(r.pending,false);assert.equal(C.select(d,r.schema,cfg).count,1);});
test('pending schema refuses partial responses and missing totals',()=>{const s=C.pendingSchema({dsMain:[],totalCount:0},0);assert.throws(()=>C.resolvePending({dsMain:[row('a')],totalCount:2},s),/행수/);assert.throws(()=>C.resolvePending({dsMain:[row('a')]},s),/행수/);assert.throws(()=>C.resolvePending({dsMain:[row('a')],totalCount:'bad'},s),/행수/);});
test('without a server total, first data requires screen confirmation and cannot invent a total',()=>{const s=C.pendingSchema({dsMain:[]},0);assert.equal(C.resolvePending({dsMain:[row('a')]},s).needsConfirmation,true);assert.throws(()=>C.learn({dsMain:[row('a')]},2),/총건수/);});
test('empty error, ambiguous lists and nonzero totals cannot establish pending profile',()=>{for(const d of [{error:'expired',dsMain:[]},{a:[],b:[]},{dsMain:[],totalCount:2},{login:true}])assert.throws(()=>C.pendingSchema(d,0));assert.throws(()=>C.pendingSchema({dsMain:[]},1));});
