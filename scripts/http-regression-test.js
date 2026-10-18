// Chamado pelo teste isolado, com o mesmo banco em memória.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),acorn=require('acorn');
module.exports=async function({A,q,ctx}){
 process.chdir(path.join(__dirname,'..'));
 const page=require('../api/page'),rpc=require('../api/rpc/[fn]'),cadsus=require('../api/cadsus'),SEC=require('../lib/http-security');
 async function invoke(fn,req){const r={headers:{},code:200,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.code=n;return this;},send(v){this.body=v;return this;}};await fn({headers:{},query:{},...req},r);return r;}
 await q("UPDATE usuarios SET perfil='NIR',setor='' WHERE nome='Teste'");
 const base={host:'localhost:3000',origin:'http://localhost:3000','x-natus-request':'1'};
 let r=await invoke(rpc,{method:'POST',query:{fn:'autenticar'},headers:base,body:{args:['Teste','senha-teste']}});
 assert.equal(r.code,200);assert.equal(JSON.parse(r.body).data.success,true);assert.equal(JSON.parse(r.body).data.token,undefined);
 assert.match(r.headers['set-cookie'],/HttpOnly/);assert.match(r.headers['set-cookie'],/SameSite=Lax/);
 const cookie=r.headers['set-cookie'].split(';')[0],token=decodeURIComponent(cookie.split('=')[1]);
 const headers={...base,cookie,'x-natus-csrf':SEC.csrfToken(token)};
 r=await invoke(rpc,{method:'POST',query:{fn:'obterSetores'},headers,body:{args:[]}});assert.equal(r.code,200);
 r=await invoke(rpc,{method:'POST',query:{fn:'obterSetores'},headers:{...headers,'x-natus-csrf':'errado'},body:{args:[]}});assert.equal(r.code,403);
 r=await invoke(rpc,{method:'POST',query:{fn:'obterSetores'},headers:{...headers,origin:'https://outro.site'},body:{args:[]}});assert.equal(r.code,403);
 r=await invoke(rpc,{method:'POST',query:{fn:'obterSetores'},headers:{...base,authorization:'Bearer '+token,'x-natus-csrf':SEC.csrfToken(token)},body:{args:[]}});assert.notEqual(r.code,200);
 r=await invoke(page,{query:{view:'painel',token,setor:'ALCON 1'},headers:{cookie}});assert.equal(r.code,303);assert.ok(!r.headers.location.includes(token));
 r=await invoke(cadsus,{method:'GET',query:{cpf:'00000000000',token},headers:{}});assert.equal(r.code,401);
 r=await invoke(cadsus,{method:'GET',query:{cpf:'00000000000'},headers:{cookie}});assert.notEqual(r.code,401);
 r=await invoke(rpc,{method:'POST',query:{fn:'obterPainelChamadas'},body:{args:[]}});assert.equal(r.code,200);
 const malicious="</script><img src=x onerror=window.__xss=1>'\\\"";
 const views=['painel','dashboard','dashboardgeral','nir','historico','acr','kanban','prontuario','bi','chamada','configuracoes'];
 for(const view of views){
  r=await invoke(page,{query:{view,setor:malicious,id:malicious},headers:{cookie}});assert.equal(r.code,200);assert.ok(!r.body.includes(token));assert.ok(!r.body.includes('<?!='));assert.ok(r.body.includes('/natus-rpc.js?v=20261018-leitos'));
  for(const m of r.body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))acorn.parse(m[1],{ecmaVersion:'latest'});
  assert.ok(!r.body.includes('<img src=x onerror=window.__xss=1>'));
 }
 // Personalização do menu (SSR): ocultar um módulo remove o atalho do trilho, sem afetar a rota.
 await q("INSERT INTO permissoes_menu(perfil,modulo_chave,visivel) VALUES('NIR','dashboardgeral',false) ON CONFLICT (perfil,modulo_chave) DO UPDATE SET visivel=false");
 r=await invoke(page,{query:{view:'nir'},headers:{cookie}});
 assert.ok(r.body.includes('data-modulo="nir"'));assert.ok(!r.body.includes('data-modulo="dashboardgeral"'));
 await q("UPDATE permissoes_menu SET visivel=true WHERE perfil='NIR' AND modulo_chave='dashboardgeral'");
 // Tela de Configurações: exclusiva do Administrador (promove o usuário, reautentica e revalida).
 await q("UPDATE usuarios SET administrador=true WHERE nome='Teste'");
 r=await invoke(rpc,{method:'POST',query:{fn:'autenticar'},headers:base,body:{args:['Teste','senha-teste']}});
 assert.equal(r.code,200);
 const cookieAdm=r.headers['set-cookie'].split(';')[0];
 r=await invoke(page,{query:{view:'configuracoes'},headers:{cookie:cookieAdm}});
 assert.equal(r.code,200);assert.ok(r.body.includes('id="tabela-permissoes-body"'));assert.ok(r.body.includes('data-modulo="configuracoes"'));assert.ok(!r.body.includes('<?!='));
 for(const m of r.body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))acorn.parse(m[1],{ecmaVersion:'latest'});
 await q("UPDATE usuarios SET administrador=false WHERE nome='Teste'");
 // Source parse: todos os JS e scripts inline, inclusive módulos novos preservados.
 function parseDir(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(f.isDirectory())parseDir(path.join(dir,f.name));else if(f.name.endsWith('.js'))acorn.parse(fs.readFileSync(path.join(dir,f.name),'utf8'),{ecmaVersion:'latest'});}}
 for(const dir of ['lib','api','public'])parseDir(dir);
 console.log('OK: API cookie-only, login sem token no JSON, CSRF/origem, URL legada limpa, TV pública, personalização do menu (SSR), tela de Configurações do Administrador e sintaxe/escape das 11 telas.');
 if(process.env.NATUS_PLAYWRIGHT_PATH)await require('./ui-browser-test')({invoke,page,rpc,cookie,headers,q});
};
