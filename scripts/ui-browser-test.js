// Opcional: NATUS_PLAYWRIGHT_PATH e NATUS_UI_DEPS apontam para instalações locais de testes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function({invoke,page,rpc,cookie,q}){
 const {chromium}=require(process.env.NATUS_PLAYWRIGHT_PATH);
 const deps=process.env.NATUS_UI_DEPS;
 const packaged = process.env.NATUS_CHROMIUM_MODULE ? (await import(process.env.NATUS_CHROMIUM_MODULE)).default : null;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-gpu','--use-gl=disabled','--no-zygote','--disable-dev-shm-usage'], ...(packaged ? {executablePath:process.env.NATUS_CHROMIUM_EXEC || await packaged.executablePath()} : {})});
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const [name,value]=cookie.split('=');await context.addCookies([{name,value,domain:'natus.test',path:'/'}]);
 const pg=await context.newPage(),errors=[],apiErrors=[];
 pg.on('pageerror',e=>errors.push(e.message));pg.on('dialog',d=>d.dismiss());
 const attack='<img src=x onerror="window.__xss=1"> Nome \' " & <teste>';
 await q("UPDATE pacientes SET nome=$1 WHERE id_paciente=(SELECT id_paciente_mae FROM leitos WHERE id_leito='A3')",[attack]);
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname!=='natus.test'){
   let f='';if(url.pathname.includes('bootstrap.bundle'))f=path.join(deps,'bootstrap/dist/js/bootstrap.bundle.min.js');
   else if(url.pathname.includes('bootstrap.min.css'))f=path.join(deps,'bootstrap/dist/css/bootstrap.min.css');
   else if(url.pathname.includes('chart.umd'))f=path.join(deps,'chart.js/dist/chart.umd.js');
   return route.fulfill({status:200,contentType:f.endsWith('.js')?'application/javascript':'text/css',body:f?fs.readFileSync(f):''});
  }
  const headers={...await req.allHeaders(),host:'natus.test'};
  if(url.pathname.startsWith('/api/rpc/')){
   const r=await invoke(rpc,{method:req.method(),query:{fn:decodeURIComponent(url.pathname.split('/').pop())},headers,body:req.postData()});
   if(r.code!==200)apiErrors.push({fn:url.pathname,body:r.body});
   return route.fulfill({status:r.code,headers:r.headers,body:r.body});
  }
  if(url.pathname==='/'){
   const r=await invoke(page,{headers,query:Object.fromEntries(url.searchParams)});
   return route.fulfill({status:r.code,headers:r.headers,body:r.body});
  }
  const file=path.join(process.cwd(),'public',url.pathname);
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({status:200,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'image/png',body:fs.readFileSync(file)});
  return route.fulfill({status:404,body:''});
 });
 await q('ALTER TABLE internacoes RENAME COLUMN encerrada_em TO encerrada_em_teste');
 await q('ALTER TABLE trocas_leito RENAME TO trocas_leito_teste');
 await pg.goto('http://natus.test/?view=painel&setor=ALCON%201');
 await pg.waitForFunction(()=>typeof globalDataLeitos!=='undefined'&&globalDataLeitos.length===3);
 assert.ok((await pg.locator('#statusAtualizacaoPainel').textContent()).includes('migração'));
 assert.equal(await pg.locator('.nt-rail #statusAtualizacaoPainel').count(),0);
 assert.equal(await pg.locator('#kpi-internacoes-total').textContent(),'—');
 await q('ALTER TABLE internacoes RENAME COLUMN encerrada_em_teste TO encerrada_em');
 await q('ALTER TABLE trocas_leito_teste RENAME TO trocas_leito');
 await pg.reload();
 await pg.waitForFunction(()=>document.getElementById('statusAtualizacaoPainel').hidden);

 await pg.waitForFunction(()=>typeof globalDataLeitos!=='undefined'&&globalDataLeitos.length===3, null, {timeout:10000}).catch(async e=>{console.error('Browser diagnóstico',errors,apiErrors, (await pg.locator('body').textContent()).slice(-500));throw e;});
 assert.equal(await pg.evaluate(()=>window.__xss),undefined);
 assert.ok((await pg.locator('body').textContent()).includes(attack));
 // Edição de classificação existente: o seletor deve estar disponível para a mãe corrigida.
 await pg.evaluate(()=>{const p=globalInternadosAtivos.find(p=>p.nome.includes('<img'));document.getElementById('editSelectPaciente').value=p.idPaciente;carregarDadosEdicao();});
 assert.equal(await pg.locator('#editTipoPaciente').inputValue(),'MAE');
 // Transferência da mãe preserva tipo e lista leito livre/complementar.
 await pg.evaluate(()=>{const p=globalInternadosAtivos.find(p=>p.nome.includes('<img'));document.getElementById('movPaciente').value=p.idInternacao;document.getElementById('movTipo').value='Transferencia';atualizarOpcoesDestino();document.getElementById('movDestino').value='ALCON 2';atualizarLeitosDestinoTransferencia();});
 await pg.waitForFunction(()=>document.getElementById('movLeitoDestino').textContent.includes('B2'));
 assert.ok((await pg.locator('#movLeitoDestino').textContent()).includes('adicionar Mãe'));
 // Textos dos relatórios não se tornam markup nem escapam fragmentos da própria interface.
 for(const view of ['dashboard','dashboardgeral','historico','nir','acr','kanban','bi','chamada']){
  await pg.goto('http://natus.test/?view='+view+'&setor=ALCON%201');
  await pg.waitForLoadState('networkidle');
  assert.equal(await pg.evaluate(()=>window.__xss),undefined);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(apiErrors.filter(e=>!(e.fn.endsWith('/obterEstatisticasDashboard') && e.body.includes('histórico de leitos está pendente'))),[]);
 console.log('OK: Chromium nas telas principais; XSS exibido como texto; edição Mãe/RN; transferência mostra leito complementar correto; nenhuma exceção JS ou falha inesperada da API; aviso de migração fora da barra lateral.');
 await context.close();
 }finally{await browser.close();}
};
