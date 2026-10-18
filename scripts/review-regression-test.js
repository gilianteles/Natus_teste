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

// Barra lateral retrátil (logo) e visibilidade dinâmica do menu por perfil — isolado, sem DOM real.
const criados=[];
function fakeEl(tag){
 const el={tagName:tag,style:{},dataset:{},attrs:{},handlers:{},_html:'',classes:new Set(),
  classList:{add:c=>el.classes.add(c),remove:c=>el.classes.delete(c),
   toggle:(c,on)=>{if(on===undefined)on=!el.classes.has(c);on?el.classes.add(c):el.classes.delete(c);return on;},
   contains:c=>el.classes.has(c)},
  setAttribute(k,v){el.attrs[k]=String(v);},getAttribute(k){return k in el.attrs?el.attrs[k]:null;},hasAttribute(k){return k in el.attrs;},
  appendChild(c){return c;},addEventListener(t,f){(el.handlers[t]=el.handlers[t]||[]).push(f);},
  querySelector(){return null;},querySelectorAll(){return [];},
  set innerHTML(v){el._html=v;},get innerHTML(){return el._html;}};
 return el;
}
const rail=fakeEl('aside'),logo=fakeEl('div'),bodyEl=fakeEl('body'),rootEl=fakeEl('html'),itensModulo=[];
const store={};
const matchMedia=q=>({matches:true,addEventListener(){},addListener(){}});
const doc={readyState:'complete',documentElement:rootEl,body:bodyEl,
 getElementById:id=>id==='btnToggleSidebar'?logo:(id==='ntSidebarRestore'?criados.filter(e=>e.id===id)[0]||null:null),
 querySelector:sel=>sel.indexOf('nt-rail')>=0?rail:null,
 querySelectorAll:sel=>sel.indexOf('data-modulo')>=0?itensModulo:[],
 createElement:t=>{const e=fakeEl(t);criados.push(e);return e;},addEventListener(){},dispatchEvent(){}};
const win={matchMedia};
vm.runInNewContext(fs.readFileSync(path.join(root,'public/natus-ui.js'),'utf8'),{document:doc,window:win,localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);}},
 getComputedStyle:()=>({getPropertyValue:()=>''}),matchMedia,console,URLSearchParams,CustomEvent:function(t,d){this.type=t;this.detail=d;}});
const UI=win.NatusUI;
assert.equal(typeof UI.alternarSidebar,'function');assert.equal(typeof win.aplicarVisibilidadeMenu,'function');
// Estado recolhido aplicado globalmente e alça de restauração visível.
assert.equal(UI.aplicarSidebarState(true),true);assert.ok(bodyEl.classList.contains('sidebar-collapsed'));assert.ok(rail.classList.contains('collapsed'));
const alca=criados.filter(e=>e.id==='ntSidebarRestore')[0];assert.ok(alca&&alca.classList.contains('show'));
// A logo alterna (e previne navegação estática), gravando a preferência.
assert.ok(logo.handlers.click[0]);logo.handlers.click[0]({preventDefault(){}});
assert.equal(bodyEl.classList.contains('sidebar-collapsed'),false);assert.equal(store['natus_sidebar_collapsed'],'false');assert.equal(alca.classList.contains('show'),false);
logo.handlers.click[0]({preventDefault(){}});
assert.ok(bodyEl.classList.contains('sidebar-collapsed'));assert.equal(store['natus_sidebar_collapsed'],'true');
// Visibilidade por perfil: só oculta o que a regra marcar como falso; restaura os demais.
const a=fakeEl('a');a.attrs['data-modulo']='censo';const b=fakeEl('a');b.attrs['data-modulo']='bi';itensModulo.push(a,b);
win.aplicarVisibilidadeMenu([{modulo_chave:'censo',visivel:true},{modulo_chave:'bi',visivel:false}]);
assert.equal(a.style.display,'');assert.equal(b.style.display,'none');assert.ok(b.classList.contains('nt-menu-hidden'));
win.aplicarVisibilidadeMenu([{modulo_chave:'bi',visivel:true}]);
assert.equal(b.style.display,'');assert.equal(b.classList.contains('nt-menu-hidden'),false);
console.log('OK: barra lateral recolhível pela logo (persistida em localStorage) e visibilidade do menu por perfil.');
