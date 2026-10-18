// Isolado: sem banco, rede ou dados de pacientes.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'views/painel.html'), 'utf8');
const start = html.indexOf('    let trocaLeitoPendente');
let submit, hide, ok, fail, writes = 0, reads = 0;
const btn = {disabled:false};
const els = { modalTrocaLeito:{addEventListener:(_,f)=>hide=f}, formTrocaLeito:{addEventListener:(_,f)=>submit=f,querySelector:()=>btn}, trocaIdInternacao:{value:'I1'}, trocaNovoLeito:{value:'L2'} };
const run = {withSuccessHandler(f){ok=f;return this;},withFailureHandler(f){fail=f;return this;},trocarLeito(){writes++;}};
vm.runInNewContext(html.slice(start,html.indexOf('\n    function sair()',start)),{
 document:{getElementById:id=>els[id]}, google:{script:{run}}, bootstrap:{Modal:{getOrCreateInstance:()=>({hide(){}})}},
 travarBotao:b=>b.disabled=true,liberarBotao:b=>b.disabled=false,carregarDashboard:()=>reads++,alert(){}
});
const send=()=>submit({preventDefault(){},currentTarget:els.formTrocaLeito});
send();assert.equal(btn.disabled,true);send();assert.equal(writes,1);
let blocked=false;hide({preventDefault(){blocked=true;}});assert.ok(blocked);
ok({success:true});assert.equal(btn.disabled,false);assert.equal(reads,1);
send();assert.equal(writes,2);fail(new Error('rede'));assert.equal(btn.disabled,false);assert.equal(reads,2);assert.equal(writes,2);
send();ok(null);assert.equal(btn.disabled,false);
run.trocarLeito=()=>{throw new Error('sincrono');};send();assert.equal(btn.disabled,false);
console.log('OK: botão após sucesso/segunda troca/erro; submit por Enter; bloqueio duplicado e fechamento pendente; leitura após falha.');
const rpc=fs.readFileSync(path.join(root,'public/natus-rpc.js'),'utf8');
async function test(mode,name='trocarLeito'){
 let timer,cleared=0,calls=0;const window={top:{location:{}}};
 vm.runInNewContext(rpc,{window,document:{querySelector:()=>({content:'csrf-teste'})},location:{search:''},URLSearchParams,AbortController,console,
 setTimeout(f,ms){assert.equal(ms,35000);timer=f;return 1;},clearTimeout(){cleared++;},
 fetch:async(url,opts)=>{calls++;
  const pending=()=>new Promise((res,rej)=>opts.signal.addEventListener('abort',()=>rej(new Error('abort'))));
  if(mode==='timeout')return pending();if(mode==='network')throw new Error('rede');
  return {ok:mode!=='server',status:mode==='server'?400:200,json:()=>{
   if(mode==='body-timeout')return pending();if(mode==='invalid')throw new Error('json');
   return Promise.resolve(mode==='server'?{ok:false,error:'Leito indisponível'}:{ok:true,data:{success:true}});
  }};
 }});
 const result=new Promise(resolve=>window.google.script.run.withSuccessHandler(d=>resolve({d})).withFailureHandler(e=>resolve({e}))[name]({}));
 if(mode.includes('timeout')){await new Promise(resolve=>setImmediate(resolve));timer();}
 const out=await result;assert.equal(calls,1);assert.equal(cleared,name==='trocarLeito'?1:0);
 if(mode==='success')assert.ok(out.d.success);else assert.ok(out.e);
 if(['timeout','body-timeout','network'].includes(mode))assert.match(out.e.message,/pode ter sido concluída/);
}
(async()=>{for(const m of ['success','timeout','body-timeout','network','invalid','server'])await test(m);await test('success','getPainelOperacionalData');console.log('OK: RPC sucesso, timeout conexão/corpo, rede, JSON inválido, regra; gravação única; outros RPCs preservados.');})().catch(e=>{console.error(e);process.exitCode=1;});
