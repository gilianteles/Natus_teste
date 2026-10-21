/* Nascimentos: vínculo persistente por paciente, sem criar internação implícita. */
(function(){
'use strict';
const el=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rpc=(fn,...a)=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...a));
const setor=()=>typeof setorAtualParam!=='undefined'?setorAtualParam:(typeof setorAtual!=='undefined'?setorAtual:(el('filtroSetor')?.value||'TODOS'));
const obst=()=>['PPP','CCO','CPNI'].includes(String(setor()).toUpperCase());
let fields,dialog,request=0;
const schema=()=>fields?Promise.resolve(fields):fetch('/nascimentos-campos.json').then(r=>r.json()).then(x=>fields=x);
const upper=v=>String(v??'').trim().toUpperCase();
/* O CCO tem planilha própria (CCO_CENSO). Campos com "setores" valem apenas nesses setores;
 * os campos históricos (PPP/CPNI) não aparecem no CCO. */
const aplicaSetor=(f,s)=>Array.isArray(f.setores)?f.setores.map(upper).includes(upper(s)):upper(s)!=='CCO';
const camposDe=(fs,s,scope)=>fs.filter(f=>(!scope||f.scope===scope)&&aplicaSetor(f,s));
const obj=v=>{try{return typeof v==='string'?JSON.parse(v):(v||{});}catch(_){return {};}};
const box=(title,content)=>`<section class="card p-3 mb-3"><h4>${esc(title)}</h4>${content}</section>`;
const infoGrid=pairs=>{
 const itens=(pairs||[]).filter(([,v])=>v!=null&&String(v).trim()!=='');
 if(!itens.length)return '<p class="text-muted mb-0">Não informado.</p>';
 return `<div class="row g-3">${itens.map(([l,v])=>`<div class="col-12 col-sm-6 col-lg-4"><div class="small text-muted">${esc(l)}</div><div class="fw-semibold">${esc(v)}</div></div>`).join('')}</div>`;
};
const values=(fs,data)=>{const d=obj(data);return infoGrid((fs||[]).map(f=>[f.label,d[f.key]]));};
function modal(title,html,size){
 const div=document.createElement('div');div.className='modal fade';div.tabIndex=-1;
 div.innerHTML=`<div class="modal-dialog ${size||'modal-fullscreen'}"><div class="modal-content"><div class="modal-header"><h3>${esc(title)}</h3><button class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div><div class="modal-body">${html}</div></div></div>`;
 document.body.append(div);const m=new bootstrap.Modal(div);m.show();div.addEventListener('hidden.bs.modal',()=>{m.dispose();div.remove();});return div;
}
function infoModal(title,html){return modal(title,html,'modal-xl modal-dialog-scrollable');}
function input(f){
 const attrs=`name="${f.scope}_${f.key}" ${f.required?'required':''}`;
 if(f.type==='select'){
  const opts=(f.options||[]).map(v=>`<option>${esc(v)}</option>`).join('');
  return `<label class="col-md-4 mb-3">${esc(f.label)} ${f.required?'*':''}<select class="form-select" ${attrs}><option value="">Não informado</option>${opts}</select></label>`;
 }
 const listId=`dl_${f.scope}_${f.key}`;
 const list=f.datalist&&f.datalist.length?` list="${listId}"`:'';
 const dl=f.datalist&&f.datalist.length?`<datalist id="${listId}">${f.datalist.map(v=>`<option value="${esc(v)}">`).join('')}</datalist>`:'';
 const step=f.step!=null?f.step:(['AC','AD','AE','AF'].includes(f.key)?'0.1':'1');
 const minmax=f.min!=null?`min="${f.min}" max="${f.max}" step="${step}"`:'';
 return `<label class="col-md-4 mb-3">${esc(f.label)} ${f.required?'*':''}<input class="form-control" type="${esc(f.type||'text')}" ${attrs}${list} ${minmax} maxlength="500">${dl}</label>`;
}
function renderCampos(fs){
 const grupos=new Map();
 for(const f of fs){const g=f.grupo||'';if(!grupos.has(g))grupos.set(g,[]);grupos.get(g).push(f);}
 return [...grupos].map(([g,list])=>`${g?`<h5 class="mt-4">${esc(g)}</h5>`:''}<div class="row">${list.map(input).join('')}</div>`).join('');
}
async function registrar(){
 try{
 const fs=await schema(),s=setor(),ehCco=upper(s)==='CCO',doSetor=camposDe(fs,s);
 const moms=(typeof globalInternadosAtivos!=='undefined'?globalInternadosAtivos:[]).filter(x=>upper(x.tipoPaciente)!=='RN');
 const tipoParto=ehCco?'':`<label class="col-md-3">Tipo de parto<select name="tipoParto" class="form-select">${['Normal','Cesárea'].map(x=>`<option>${x}</option>`).join('')}</select></label>`;
 dialog=modal('Registro de nascimento'+(ehCco?' — CCO':''),`<form id="nascForm"><p>O RN fica vinculado à mãe. A internação, quando necessária, é registrada separadamente. Em gestação múltipla, repita o registro com outra ordem de RN.</p><div class="row g-3 align-items-end"><label class="col-md-6">Mãe<select name="idInternacao" class="form-select" required><option value="">Selecione</option>${moms.map(m=>`<option value="${esc(m.idInternacao)}">${esc(m.nome)} — Leito ${esc(m.numeroLeito)}</option>`).join('')}</select></label>${tipoParto}<label class="col-md-3">Ordem do RN<input name="ordem" class="form-control" type="number" min="1" max="10" value="1" required></label></div><div class="row g-3 mt-1"><label class="col-md-6">Nome do RN (opcional)<input name="nomeRn" class="form-control" maxlength="200" placeholder="Em branco: RN DE (nome da mãe)"></label></div><p class="small text-muted">Sem nome informado, o sistema usa <strong>RN DE (nome da mãe)</strong>. Em gemelares, usa <strong>RN 1 DE</strong>, <strong>RN 2 DE</strong>… automaticamente.</p><h4 class="mt-4">${ehCco?'Dados do procedimento':'Dados da mãe e do parto'}</h4>${renderCampos(doSetor.filter(f=>f.scope==='parto'))}<h4 class="mt-4">Dados deste RN</h4>${renderCampos(doSetor.filter(f=>f.scope==='rn'))}<p role="status" id="nascStatus"></p><button class="btn btn-primary" type="submit">Salvar nascimento</button></form>`);
 const form=dialog.querySelector('form');
 if(ehCco){
  const proc=form.querySelector('[name="parto_C_PROC1"]');if(proc)proc.value='Parto Cesárea';
  const fm=form.querySelector('[name="rn_C_FM"]');if(fm)fm.value='NÃO';
  const ig=form.querySelector('[name="rn_C_IG"]'),cl=form.querySelector('[name="rn_C_IGCL"]');
  const calc=()=>{if(!ig||!cl)return;const n=Number(ig.value);cl.value=!n?'':n<28?'PREMATURO EXTREMO':n<32?'MUITO PREMATURO':n<37?'PREMATURO MODERADO':n<42?'TERMO':'PÓS-TERMO';};
  ig&&ig.addEventListener('input',calc);
 }
 form.addEventListener('submit',async e=>{
  e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
  const raw=Object.fromEntries(new FormData(form)),d={idInternacao:raw.idInternacao,tipoParto:raw.tipoParto,ordem:Number(raw.ordem),nomeRn:raw.nomeRn,parto:{},rn:{}};
  doSetor.forEach(f=>d[f.scope][f.key]=raw[f.scope+'_'+f.key]);
  try{await rpc('registrarNascimento',d);el('nascStatus').textContent='Nascimento salvo. Consulte a ficha da mãe; o RN ainda não está internado.';submit.textContent='Salvo';if(typeof carregarDashboard==='function')carregarDashboard();}
  catch(err){el('nascStatus').textContent=err.message;submit.disabled=false;}
 });
 }catch(e){alert(e.message);}
}
function agoraLocal(){
 const d=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus'}).format(new Date());
 const h=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Manaus',hour:'2-digit',minute:'2-digit'}).format(new Date());
 return {data:d,hora:h};
}
async function admitir(n){
 try{
  // A internação pode ser feita em qualquer setor compatível com RN; o cadastro é o mesmo do nascimento.
  document.querySelectorAll('.modal.show').forEach(m=>bootstrap.Modal.getInstance(m)?.hide());
  const lista=(typeof listaSetoresGlobal!=='undefined'&&Array.isArray(listaSetoresGlobal)&&listaSetoresGlobal.length)?listaSetoresGlobal:await rpc('obterSetores');
  const setores=lista.map(x=>String(x)).filter(x=>!['UEN','UTI MATERNA'].includes(upper(x)));
  const atual=setor(),inicial=setores.find(x=>upper(x)===upper(atual))||setores[0]||atual;
  const quando=agoraLocal();
  const div=modal('Internação do RN',`<form><p class="mb-1"><strong>${esc(n.nome)}</strong> — ${esc(n.condicao||'RN')}${n.dados&&n.dados.AB?` · ${esc(n.dados.AB)} g`:''}</p><p class="small text-muted">O RN pode ser internado em outro setor. Nenhum paciente novo é criado; a internação usa o mesmo cadastro do nascimento.</p><div class="row g-3"><label class="col-md-6">Setor de destino<select name="setor" class="form-select" required>${setores.map(x=>`<option${x===inicial?' selected':''}>${esc(x)}</option>`).join('')}</select></label><label class="col-md-6">Leito<select name="leitoId" class="form-select" required><option value="">Carregando…</option></select></label><label class="col-md-6">Data<input class="form-control" name="data" type="date" required value="${quando.data}"></label><label class="col-md-6">Hora<input class="form-control" name="hora" type="time" required value="${quando.hora}"></label></div><p role="status" class="mt-3 mb-0"></p><button type="submit" class="btn btn-primary mt-3">Confirmar internação</button></form>`);
  const form=div.querySelector('form'),selSetor=form.querySelector('[name=setor]'),selLeito=form.querySelector('[name=leitoId]'),status=form.querySelector('[role=status]'),submit=form.querySelector('[type=submit]');
  const carregar=async()=>{
   status.textContent='';selLeito.disabled=true;submit.disabled=true;selLeito.innerHTML='<option value="">Carregando…</option>';
   try{
    const leitos=await rpc('getLeitosDisponiveisSetor',selSetor.value,'RN');
    selLeito.innerHTML=leitos.length?'<option value="">Selecione o leito</option>'+leitos.map(l=>`<option value="${esc(l.ID_Leito)}">${esc(l.Numero_Leito)}${upper(l.Status)==='OCUPADO'?' — OCUPADO (junto à mãe)':''}</option>`).join(''):'<option value="">Nenhum leito compatível neste setor</option>';
    selLeito.disabled=!leitos.length;submit.disabled=!leitos.length;
    if(!leitos.length)status.textContent='Nenhum leito compatível disponível neste setor.';
   }catch(e){status.textContent=e.message;selLeito.innerHTML='<option value="">Erro ao carregar leitos</option>';}
  };
  selSetor.onchange=carregar;await carregar();
  form.onsubmit=async e=>{
   e.preventDefault();submit.disabled=true;status.textContent='Salvando…';
   const raw=Object.fromEntries(new FormData(form));
   try{await rpc('registrarInternacao',{idNascimento:n.id_nascimento,setor:raw.setor,leitoId:raw.leitoId,data:raw.data,hora:raw.hora,procedencia:'NASCIDO NA MATERNIDADE',tipoPaciente:'RN'});location.reload();}
   catch(err){status.textContent=err.message;submit.disabled=false;}
  };
 }catch(e){alert(e.message);}
}
function cartaoBinomio(badge,tone,nome,linha,acoes){
 return `<div class="card border-0 shadow-sm mb-2"><div class="card-body py-3"><div class="d-flex flex-wrap justify-content-between align-items-center gap-2"><div><span class="badge text-bg-${tone} me-1">${esc(badge)}</span><strong>${esc(nome)}</strong>${linha?`<div class="small text-muted mt-1">${esc(linha)}</div>`:''}</div><div class="d-flex flex-wrap gap-2">${acoes}</div></div></div></div>`;
}
function podeInternar(n){return n&&n.condicao==='Nascido Vivo'&&upper(n.internacao&&n.internacao.status)!=='ATIVO';}
async function detalhes(leito,body){
 const host=body.querySelector('#detalhesBinomio')||body;
 host.innerHTML='<div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Carregando informações do binômio…</div>';
 try{
  const fs=await schema(),id=leito.idInternacao;
  if(!id){host.innerHTML='';return;}
  const pep=await rpc('obterProntuario',id);
  if(!host.isConnected)return;
  if(upper(pep.internacao.tipoPaciente)==='RN'){
   const v=await rpc('obterNascimentoDoRn',{idInternacao:id});
   if(!host.isConnected)return;
   const nasc=v&&v.nascimento,mae=v&&v.mae,ativa=nasc&&upper(nasc.internacao&&nasc.internacao.status)==='ATIVO';
   const cond=nasc?nasc.condicao:(pep.internacao.tipoPaciente||'RN'),peso=nasc&&obj(nasc.dados).AB;
   let html='<h6 class="text-uppercase text-muted small fw-bold mb-3">Binômio mãe e RN</h6>';
   html+=cartaoBinomio('RN','info',pep.internacao.nome,`${cond}${peso?' · '+peso+' g':''} · ${ativa?'Internado em '+(nasc.internacao.setor||''):'Apenas registrado (sem internação)'}`,`<button type="button" class="btn btn-sm btn-outline-primary" data-ver-rn>Ver informações do RN</button>${nasc&&!ativa&&nasc.condicao==='Nascido Vivo'?'<button type="button" class="btn btn-sm btn-primary" data-internar-rn>Internar RN</button>':''}`);
   if(mae)html+=cartaoBinomio('Mãe','primary',nasc&&nasc.nome_mae?nasc.nome_mae:'Mãe',`${mae.setor||''}${mae.numeroLeito?' · Leito '+mae.numeroLeito:''}`,'<button type="button" class="btn btn-sm btn-outline-primary" data-ver-mae>Ver informações da Mãe</button>');
   else html+='<p class="text-muted small mb-0">Mãe sem internação ativa no momento.</p>';
   host.innerHTML=html;
   host.querySelector('[data-ver-rn]')?.addEventListener('click',()=>verRn(nasc||{nome:pep.internacao.nome,condicao:cond,dados:{},setor_origem:pep.internacao.setor},fs,pep.internacao.nomeMae));
   host.querySelector('[data-ver-mae]')?.addEventListener('click',()=>verMae(mae.idInternacao,fs));
   host.querySelector('[data-internar-rn]')?.addEventListener('click',()=>admitir(nasc));
  }else{
   const nascs=await rpc('obterNascimentos',{idInternacao:id});
   if(!host.isConnected)return;
   let html='<h6 class="text-uppercase text-muted small fw-bold mb-3">Binômio mãe e RN</h6>';
   html+=cartaoBinomio('Mãe','primary',pep.internacao.nome,`${pep.internacao.setor||''}${pep.internacao.numeroLeito?' · Leito '+pep.internacao.numeroLeito:''}`,'<button type="button" class="btn btn-sm btn-outline-primary" data-ver-mae>Ver informações da Mãe</button>');
   if(nascs.length){
    html+=`<div class="small text-muted fw-semibold mt-3 mb-2">${nascs.length} RN(s) vinculado(s)</div>`;
    html+=nascs.map((n,i)=>cartaoBinomio(`RN ${n.ordem}`,'info',n.nome,`${n.condicao}${obj(n.dados).AB?' · '+obj(n.dados).AB+' g':''} · ${n.internacao?('Internado em '+(n.internacao.setor||'')):'Sem internação'}`,`<button type="button" class="btn btn-sm btn-outline-primary" data-ver-rn="${i}">Ver informações do RN</button>${podeInternar(n)?`<button type="button" class="btn btn-sm btn-primary" data-internar-rn="${i}">Internar RN</button>`:''}`)).join('');
   }else html+=`<p class="text-muted small mb-0">Nenhum RN vinculado. ${obst()?'Use <strong>Registrar nascimento</strong> no topo do painel.':''}</p>`;
   host.innerHTML=html;
   host.querySelector('[data-ver-mae]')?.addEventListener('click',()=>verMae(id,fs));
   host.querySelectorAll('[data-ver-rn]').forEach(b=>b.addEventListener('click',()=>verRn(nascs[Number(b.dataset.verRn)],fs,pep.internacao.nome)));
   host.querySelectorAll('[data-internar-rn]').forEach(b=>b.addEventListener('click',()=>admitir(nascs[Number(b.dataset.internarRn)])));
  }
 }catch(e){host.innerHTML=`<div class="alert alert-warning mb-0">${esc(e.message)}</div>`;}
}
async function verMae(idInternacao,fs0){
 try{
  const fs=fs0||await schema();
  const [pep,nascs]=await Promise.all([rpc('obterProntuario',idInternacao),rpc('obterNascimentos',{idInternacao})]);
  const i=pep.internacao;
  const dados=infoGrid([['Nome',i.nome],['Prontuário',i.numeroProntuario],['Data de nascimento',i.dataNascimento],['Sexo',i.sexo==='F'?'Feminino':i.sexo==='M'?'Masculino':i.sexo],['CPF',i.cpf],['Cartão SUS',i.cartaoSus],['Telefone',i.telefone],['Setor',i.setor],['Leito',i.numeroLeito],['Situação',i.status],['Entrada',i.dataHoraEntrada],['Dias internado',i.diasInternado],['Procedência',i.procedencia],['Tipo de parto',i.tipoParto],['IG',i.ig],['Observação do procedimento',i.observacaoProcedimento]]);
  const uid='mae-'+Math.random().toString(36).slice(2);
  let partosHtml='';
  for(const idParto of [...new Set(nascs.map(n=>n.id_parto))]){
   const rows=nascs.filter(n=>n.id_parto===idParto),n0=rows[0];
   partosHtml+=`<div class="card border-0 shadow-sm mb-3"><div class="card-body"><div class="d-flex flex-wrap justify-content-between gap-2"><h6 class="fw-bold mb-1">Parto — ${esc(n0.tipo_parto)} · ${esc(n0.setor_origem)}</h6><span class="small text-muted">${esc(n0.data_nascimento)}</span></div><details class="mt-2"><summary class="small fw-semibold">Dados do parto</summary><div class="mt-2">${values(camposDe(fs,n0.setor_origem,'parto'),n0.dados_parto)}</div></details></div></div>`;
  }
  const tabela=nascs.length?`<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Ordem</th><th>RN</th><th>Condição</th><th>Peso</th><th>Internação</th><th></th></tr></thead><tbody>${nascs.map((n,j)=>`<tr><td>RN ${esc(n.ordem)}</td><td>${esc(n.nome)}</td><td>${esc(n.condicao)}</td><td>${esc(obj(n.dados).AB||'—')}</td><td>${n.internacao?esc((n.internacao.status||'')+' / '+(n.internacao.setor||'')):'Sem internação'}</td><td><button type="button" class="btn btn-sm btn-outline-primary" data-rn="${j}">Ver</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="text-muted">Nenhum RN vinculado.</p>';
  const html=`<ul class="nav nav-tabs" role="tablist"><li class="nav-item"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#${uid}-dados" type="button">Dados da mãe</button></li><li class="nav-item"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#${uid}-partos" type="button">Partos e RNs</button></li></ul><div class="tab-content pt-3"><div class="tab-pane fade show active" id="${uid}-dados">${dados}</div><div class="tab-pane fade" id="${uid}-partos">${partosHtml||'<p class="text-muted">Nenhum nascimento registrado.</p>'}<h6 class="fw-bold mt-4">RNs vinculados</h6>${tabela}</div></div>`;
  const div=infoModal(`Informações da Mãe — ${i.nome}`,html);
  div.querySelectorAll('[data-rn]').forEach(b=>b.addEventListener('click',()=>verRn(nascs[Number(b.dataset.rn)],fs,i.nome)));
 }catch(e){alert(e.message);}
}
async function verRn(nasc,fs0,maeNome){
 try{
  const fs=fs0||await schema(),dadosRn=obj(nasc.dados),dadosParto=obj(nasc.dados_parto);
  const ativa=upper(nasc.internacao&&nasc.internacao.status)==='ATIVO';
  let pep=null;
  if(ativa&&nasc.internacao&&nasc.internacao.id){try{pep=await rpc('obterProntuario',nasc.internacao.id);}catch(_){}}
  const i=pep&&pep.internacao;
  const infoRn=infoGrid([['Nome',nasc.nome],['Condição ao nascer',nasc.condicao],['Data do nascimento',nasc.data_nascimento],['Hora do nascimento',nasc.hora_nascimento],['Sexo',dadosRn.AA==='F'?'Feminino':dadosRn.AA==='M'?'Masculino':dadosRn.AA],['Peso ao nascer',dadosRn.AB?dadosRn.AB+' g':''],['Nome da mãe',maeNome||nasc.nome_mae],['Setor de nascimento',nasc.setor_origem],['Tipo de parto',nasc.tipo_parto],['Ordem do RN',nasc.ordem]]);
  const internacao=i?`<h6 class="fw-bold mt-4">Internação</h6>${infoGrid([['Setor',i.setor],['Leito',i.numeroLeito],['Situação',i.status],['Entrada',i.dataHoraEntrada],['Dias internado',i.diasInternado],['Procedência',i.procedencia],['Peso (g)',i.pesoGramas],['Apgar 1º / 5º min',[i.apgar1,i.apgar5].filter(v=>v!=null).join(' / ')],['Reanimação',i.reanimacao],['Pulseira',i.pulseira],['Observação',i.observacaoProcedimento]])}`:'<div class="alert alert-light border mt-4 mb-0">RN apenas registrado no nascimento, sem internação ativa.</div>';
  const nascInfo=`<h6 class="fw-bold mt-4">Dados do nascimento</h6>${values(camposDe(fs,nasc.setor_origem,'rn'),dadosRn)}<details class="mt-3"><summary class="small fw-semibold">Dados do parto</summary><div class="mt-2">${values(camposDe(fs,nasc.setor_origem,'parto'),dadosParto)}</div></details>`;
  const acoes=nasc.condicao==='Nascido Vivo'&&!ativa?'<div class="mt-3"><button type="button" class="btn btn-primary" data-internar>Internar este RN</button></div>':'';
  const div=infoModal(`Informações do RN — ${nasc.nome}`,`<div class="d-flex flex-wrap gap-2 mb-3"><span class="badge text-bg-info">${esc(nasc.condicao||'RN')}</span>${dadosRn.AB?`<span class="badge text-bg-light border">${esc(dadosRn.AB)} g</span>`:''}${ativa?'<span class="badge text-bg-success">Internado</span>':'<span class="badge text-bg-secondary">Sem internação</span>'}</div>${infoRn}${internacao}${nascInfo}${acoes}`);
  div.querySelector('[data-internar]')?.addEventListener('click',()=>admitir(nasc));
 }catch(e){alert(e.message);}
}
function altaOption(){
 const wrap=el('altaBinWrap');if(!wrap)return;
 const ativo=typeof globalInternadosAtivos!=='undefined'?globalInternadosAtivos.find(i=>i.idInternacao===el('movPaciente').value):null;
 wrap.hidden=!(setor().startsWith('ALCON')&&el('movTipo').value==='Alta'&&['MAE','MÃE'].includes(ativo?.tipoPaciente));el('movAltaBinomio').checked=false;
}
async function refresh(){
 const id=++request;const s=setor();const isPanel=!!el('grid-leitos');
 if(el('btnNasc'))el('btnNasc').hidden=!obst();
 if(isPanel){
 for(const l of typeof globalDataLeitos!=='undefined'?globalDataLeitos:[]){
 if(l.nascimentosVinculados){const cards=document.querySelectorAll('[onclick^="abrirOffcanvasDetalhes"]');for(const card of cards){if(card.getAttribute('onclick').includes(l.ID_Leito)&&!card.querySelector('.nascIcon')){const badge=document.createElement('span');badge.className='nascIcon badge bg-info';badge.title='RN vinculado ao cadastro da mãe';badge.textContent='👶';card.append(badge);}}}
 }
 }
 const area=el('nascDashboard');if(!area)return;
 const alcon=s.startsWith('ALCON'),eligible=obst()||s==='TODOS'||s.startsWith('Todos');area.hidden=!(alcon||eligible);if(area.hidden)return;
 const now=new Date();const ano=Number(el('filtroAno')?.value)||now.getFullYear(),mes=Number(el('filtroMes')?.value)||now.getMonth()+1;
 try{
 if(alcon){const inicio=isPanel?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Manaus'}).format(now):`${ano}-${String(mes).padStart(2,'0')}-01`;const fim=isPanel?inicio:`${ano}-${String(mes).padStart(2,'0')}-${new Date(ano,mes,0).getDate()}`;const r=await rpc('obterAltasBinomio',{setor:s,inicio,fim});if(id===request)area.innerHTML=box(`Altas de binômio ${isPanel?'hoje':'no mês'}`,`<strong class="fs-2">${r.total}</strong><p>Alta conjunta ou mãe com RN apenas vinculado.</p>`);return;}
 if(isPanel){area.hidden=true;return;}
 const d=await rpc('obterDashboardNascimentos',{setor:s.startsWith('Todos')?'TODOS':s,ano,mes});if(id!==request)return;
 const labels={internacoes:'Internações maternas',partos:'Partos',nascimentos:'Nascimentos',vivos:'Nascidos vivos',mortos:'Nascidos mortos'};
 area.innerHTML='<h3>Partos e nascimentos</h3><p>Por data do nascimento e setor de origem. Gemelares: um parto, dois nascimentos. Internações maternas usam a data de admissão.</p><div class="row">'+Object.entries(d.kpis).map(([k,v])=>`<div class="col">${box(labels[k],`<strong class="fs-2">${v}</strong>`)}</div>`).join('')+'</div><button id="exportNasc" class="btn btn-outline-primary mb-3">Exportar indicadores CSV</button><div id="nascCharts" class="row"></div><h4>Relatório diário</h4><div class="table-responsive"><table class="table"><thead><tr><th>Dia</th><th>Internações maternas</th><th>Partos</th><th>Nascimentos</th><th>Vivos</th><th>Mortos</th></tr></thead><tbody>'+d.diarios.map(r=>`<tr><td>${r.dia}</td><td>${r.internacoes}</td><td>${r.partos}</td><td>${r.nascimentos}</td><td>${r.vivos}</td><td>${r.mortos}</td></tr>`).join('')+'</tbody></table></div>';
 const chart=(label,counts,total)=>{const host=document.createElement('div');host.className='col-lg-6';host.innerHTML=box(label,Object.entries(counts).map(([k,v])=>`<div class="mb-2">${esc(k)}: <b>${v}</b> (${total?(100*v/total).toFixed(1):0}%)<div class="progress" role="img" aria-label="${esc(k)}: ${v}"><div class="progress-bar" style="width:${total?100*v/total:0}%"></div></div></div>`).join(''));el('nascCharts').append(host);};
 chart('Partos por mês (ano selecionado)',Object.fromEntries(d.mensais.map(r=>[r.mes,r.partos])),d.mensais.reduce((s,r)=>s+r.partos,0));
 Object.values(d.groups).forEach(g=>chart(g.label,g.counts,g.total));
 const report=document.createElement('div');
 report.innerHTML='<h4>Relatórios da planilha</h4><p>Expanda um indicador para conferir os totais diários, o comparativo mensal e o percentual anual. Campos vazios aparecem como não informados.</p>'+Object.values(d.groups).map(g=>`<details class="card p-3 mb-2"><summary>${esc(g.label)}</summary><h5 class="mt-3">Diário — mês selecionado</h5><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Categoria</th>${d.diarios.map(r=>`<th>${r.dia}</th>`).join('')}<th>Total</th></tr></thead><tbody>${g.series.map(r=>`<tr><th>${esc(r.category)}</th>${r.dias.map(v=>`<td>${v}</td>`).join('')}<td>${r.dias.reduce((a,b)=>a+b,0)}</td></tr>`).join('')}</tbody></table></div><h5>Comparativo mensal / anual</h5><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Categoria</th>${d.mensais.map(r=>`<th>${r.mes}</th>`).join('')}<th>Total</th><th>% anual</th></tr></thead><tbody>${g.series.map(r=>`<tr><th>${esc(r.category)}</th>${r.meses.map(v=>`<td>${v}</td>`).join('')}<td>${g.annualCounts[r.category]}</td><td>${g.annualTotal?(100*g.annualCounts[r.category]/g.annualTotal).toFixed(1):0}%</td></tr>`).join('')}</tbody></table></div></details>`).join('');area.append(report);
 report.querySelectorAll('details').forEach((detail,index)=>{
  const g=Object.values(d.groups)[index],select=document.createElement('select'),plot=document.createElement('div');select.className='form-select my-2';select.setAttribute('aria-label','Categoria do gráfico mensal');select.innerHTML=g.series.map((r,j)=>`<option value="${j}">${esc(r.category)}</option>`).join('');
  const draw=()=>{const r=g.series[Number(select.value)];if(!r)return;const max=Math.max(1,...r.meses);plot.innerHTML='<h5>Gráfico mensal da categoria</h5>'+r.meses.map((v,j)=>`<div class="d-flex gap-2 align-items-center"><span style="width:2rem">${j+1}</span><div class="progress flex-grow-1"><div class="progress-bar" style="width:${100*v/max}%"></div></div><b style="width:3rem">${v}</b></div>`).join('');};select.onchange=draw;detail.append(select,plot);draw();
 });


 el('exportNasc').onclick=()=>{const rows=[['Indicador','Categoria','Quantidade','Denominador']];Object.values(d.groups).forEach(g=>Object.entries(g.counts).forEach(([k,v])=>rows.push([g.label,k,v,g.total])));Object.values(d.groups).forEach(g=>g.series.forEach(r=>{r.dias.forEach((v,j)=>rows.push([g.label+' diário',r.category+' / dia '+(j+1),v,'']));r.meses.forEach((v,j)=>rows.push([g.label+' mensal',r.category+' / mês '+(j+1),v,'']));}));d.diarios.forEach(r=>rows.push(['Diário',r.dia,r.nascimentos,'']));d.mensais.forEach(r=>rows.push(['Partos mensal',r.mes,r.partos,'']));const csv='\ufeff'+rows.map(r=>r.map(v=>'"'+String(v).replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"').join(';')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`nascimentos_${ano}_${mes}.csv`;a.click();URL.revokeObjectURL(url);};
 }catch(e){if(id===request)area.textContent=e.message;}
}
function init(){
 if(el('grid-leitos')){
 const b=document.createElement('button');b.id='btnNasc';b.className='btn btn-primary';b.textContent='Registrar nascimento';b.onclick=registrar;document.querySelector('.nt-actions')?.prepend(b);
 const wrap=document.createElement('label');wrap.id='altaBinWrap';wrap.hidden=true;wrap.className='form-check my-3';wrap.innerHTML='<input id="movAltaBinomio" type="checkbox" class="form-check-input"> Alta conjunta de mãe e RN internado (desmarcado: somente a mãe)';el('formMovimentacao')?.querySelector('.modal-body')?.append(wrap);
 ['movPaciente','movTipo'].forEach(id=>el(id)?.addEventListener('change',altaOption));el('modalMovimentacao')?.addEventListener('show.bs.modal',altaOption);
 }
 const area=document.createElement('section');area.id='nascDashboard';area.className='my-3';const parent=document.querySelector('.content-wrap, body > .container-fluid');if(el('grid-leitos'))parent?.prepend(area);else parent?.append(area);
 ['seletorSetor','headerSetor','filtroSetor','filtroAno','filtroMes'].forEach(id=>el(id)?.addEventListener('change',()=>setTimeout(refresh,0)));
 refresh();
}
window.NatusNascimentos={detalhes,refresh,registrar,admitir,verMae,verRn};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
