const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../tab-bridge.js'),'utf8');
function fixture(version=null){
 const scripts=[];let failure=false;
 const chrome={runtime:{getManifest:()=>({version:'1.8.0'})},tabs:{sendMessage:async()=>version?{ok:true,protocol:2,version}:{ok:false}},scripting:{executeScript:async input=>{scripts.push(input);if(failure)throw Error('access denied');if(input.world==='ISOLATED')version='1.8.0';return [];}}};
 const context=vm.createContext({chrome,URL});vm.runInContext(code,context);
 return {bridge:context.TripTabBridge.create(chrome),scripts,fail:()=>failure=true};
}
const tab={id:123,url:'https://goe.neis.go.kr/jsp/main.jsp',status:'complete'};
test('ready version uses its existing content script',async()=>{const f=fixture('1.8.0');assert.equal(await f.bridge.ensure(tab),true);assert.equal(f.scripts.length,0);});
test('missing or older content gets packaged top-frame scripts in execution order',async()=>{
 for(const version of [null,'1.7.2']){const f=fixture(version);assert.equal(await f.bridge.ensure(tab),true);assert.equal(f.scripts.length,2);assert.equal(f.scripts[0].world,'MAIN');assert.equal(f.scripts[1].world,'ISOLATED');assert.deepEqual(Array.from(f.scripts[0].target.frameIds),[0]);assert.deepEqual(Array.from(f.scripts[1].files),['calendar.js','core.js','report-core.js','content.js']);await f.bridge.ensure(tab);assert.equal(f.scripts.length,2);}
});
test('invalid origins and unavailable tabs are skipped without injection',async()=>{
 const f=fixture();for(const url of ['https://example.com/','http://goe.neis.go.kr/','https://goe.neis.go.kr.evil.example/','https://goe.neis.go.kr:8443/','https://user@goe.neis.go.kr/'])assert.equal(await f.bridge.ensure({...tab,url}),false);
 for(const state of [{discarded:true},{frozen:true},{status:'loading'}])assert.equal(await f.bridge.ensure({...tab,...state}),false);
 assert.equal(f.scripts.length,0);
});
test('failed injection does not report ready or run remaining files',async()=>{const f=fixture();f.fail();await assert.rejects(()=>f.bridge.ensure(tab),/access denied/);assert.equal(f.scripts.length,1);});
