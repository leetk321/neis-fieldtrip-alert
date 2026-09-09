const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../core.js');

const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const regionalCodes=['sen','pen','dge','ice','gen','dje','use','sje','goe','kwe','cbe','cne','jbe','jje','gbe','gne','jne'];

test('regional NEIS subdomains share permissions and same-origin request support',()=>{
  assert.ok(manifest.host_permissions.includes('https://*.neis.go.kr/*'));
  assert.ok(manifest.content_scripts.every(script=>script.matches.includes('https://*.neis.go.kr/*')));
  for(const code of regionalCodes){
    const origin=`https://${code}.neis.go.kr`;
    assert.equal(C.endpoint('/observed.do',origin),'/observed.do');
    const other=code==='goe'?'sen':'goe';
    assert.throws(()=>C.endpoint(`https://${other}.neis.go.kr/observed.do`,origin));
  }
});
