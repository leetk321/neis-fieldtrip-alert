const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../hook.js'),'utf8');
function harness(){
 const events={},posted=[];
 class XHR {open(){}setRequestHeader(){}addEventListener(n,fn){this[n]=fn;}send(){this.status=200;this.responseText='{"dsMain":[]}';this.load?.();}}
 const window={fetch:async()=>({status:200,clone:()=>({text:async()=>'{}'})}),postMessage:p=>posted.push(p)};
 const context=vm.createContext({window,document:{addEventListener:(n,fn)=>events[n]=fn},XMLHttpRequest:XHR,location:{origin:'https://goe.neis.go.kr',href:'https://goe.neis.go.kr/jsp/main.jsp'},URL,Headers,Date,WeakMap,Set,JSON});
 vm.runInContext(code,context);
 function arm(trusted=true){events['neis-trip-arm-v1']({detail:{nonce:'test-nonce'}});events.click({isTrusted:trusted,target:{closest:()=>({textContent:'조회'})}});}
 function xhr(url='/observed.do',headers={}){const x=new XHR();x.open('POST',url);for(const [k,v]of Object.entries(headers))x.setRequestHeader(k,v);x.send('{"data":{"dmSearch":{}}}');}
 return {arm,xhr,posted,window};
}
test('requests are not captured before explicit arm and trusted query click',()=>{const h=harness();h.xhr();assert.equal(h.posted.length,0);h.arm(false);h.xhr();assert.equal(h.posted.length,0);});
test('observed same-origin XHR captured; credential headers excluded',()=>{const h=harness();h.arm();h.xhr('/observed.do',{'Cookie':'fixture','Authorization':'fixture','ui':'eXbuilder','Content-Type':'application/json'});assert.equal(h.posted.length,1);assert.equal(h.posted[0].headers.ui,'eXbuilder');assert.equal(h.posted[0].headers.cookie,undefined);assert.equal(h.posted[0].headers.authorization,undefined);});
test('different-origin requests ignored',()=>{const h=harness();h.arm();h.xhr('https://other.example/list.do');assert.equal(h.posted.length,0);});
test('fetch capture leaves original response usable',async()=>{const h=harness();h.arm();const response=await h.window.fetch('/observed.do',{method:'POST',body:'{}'});await new Promise(r=>setImmediate(r));assert.equal(response.status,200);assert.equal(h.posted.length,1);});

