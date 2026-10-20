/* Nascimentos: vínculo persistente por paciente, sem criar internação implícita. */
(function(){
'use strict';
const el=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rpc=(fn,...a)=>new Promise((resolve,reject)=>google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...a));
const setor=()=>typeof setorAtualParam!=='undefined'?setorAtualParam:(typeof setorAtual!=='undefined'?setorAtual:(el('filtroSetor')?.value||'TODOS'));
const obst=()=>['PPP','CCO','CPNI'].includes(setor());
let fields,dialog,request=0;
const schema=()=>fields?Promise.resolve(fields):fetch('/nascimentos-campos.json').then(r=>r.json()).then(x=>fields=x);
const box=(title,content)=>`<section class="card p-3 mb-3"><h4>${esc(title)}</h4>${content}</section>`;
const values=(fs,data)=>`<dl class="row">${fs.map(f=>`<dt class="col-md-5">${esc(f.label)}</dt><dd class="col-md-7">${esc(data?.[f.key]??'Não informado')}</dd>`).join('')}</dl>`;
function modal(title,html){
 const div=document.createElement('div');div.className='modal fade';div.tabIndex=-1;
 div.innerHTML=`<div class="modal-dialog modal-fullscreen"><div class="modal-content"><div class="modal-header"><h3>${esc(title)}</h3><button class="btn-close" data-bs-dismiss="modal" aria-label="Fechar"></button></div><div class="modal-body">${html}</div></div></div>`;
 document.body.append(div);const m=new bootstrap.Modal(div);m.show();div.addEventListener('hidden.bs.modal',()=>{m.dispose();div.remove();});return div;
}
function input(f){
 const attrs=`name="${f.scope}_${f.key}" ${f.required?'required':''}`;
 const field=f.type==='select'?`<select class="form-select" ${attrs}><option value="">Não informado</option>${f.options.map(v=>`<option>${esc(v)}</option>`).join('')}</select>`:`<input class="form-control" type="${f.type}" ${attrs} ${f.min!=null?`min="${f.min}" max="${f.max}" step="${['AC','AD','AE','AF'].includes(f.key)?'0.1':'1'}"`:''} maxlength="500">`;
 return `<label class="col-md-4 mb-3">${esc(f.label)} ${f.required?'*':''}${field}</label>`;
}
async function registrar(){
 try{
 const fs=await schema();const moms=(typeof globalInternadosAtivos!=='undefined'?globalInternadosAtivos:[]).filter(x=>x.tipoPaciente!=='RN');
 dialog=modal('Registro de nascimento',`<form id="nascForm"><p>O RN fica vinculado à mãe. A internação, quando necessária, é registrada separadamente. Em gestação múltipla, repita o registro com outra ordem de RN.</p><label>Mãe<select name="idInternacao" class="form-select" required><option value="">Selecione</option>${moms.map(m=>`<option value="${esc(m.idInternacao)}">${esc(m.nome)} — Leito ${esc(m.numeroLeito)}</option>`).join('')}</select></label><div class="row my-3"><label class="col">Tipo de parto<select name="tipoParto" class="form-select">${(setor()==='CCO'?['Cesárea']:['Normal','Cesárea']).map(x=>`<option>${x}</option>`).join('')}</select></label><label class="col">Ordem do RN<input name="ordem" class="form-control" type="number" min="1" max="10" value="1" required></label><label class="col">Nome do RN (opcional)<input name="nomeRn" class="form-control" maxlength="200"></label></div><p>Dados maternos e assistenciais são registrados uma vez por parto; os próximos RNs reutilizam esses dados.</p><h4>Dados da mãe e do parto</h4><div class="row">${fs.filter(f=>f.scope==='parto').map(input).join('')}</div><h4>Dados deste RN</h4><div class="row">${fs.filter(f=>f.scope==='rn').map(input).join('')}</div><p role="status" id="nascStatus"></p><button class="btn btn-primary" type="submit">Salvar nascimento</button></form>`);
 const form=dialog.querySelector('form');form.addEventListener('submit',async e=>{
 e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
 const raw=Object.fromEntries(new FormData(form)),d={idInternacao:raw.idInternacao,tipoParto:raw.tipoParto,ordem:Number(raw.ordem),nomeRn:raw.nomeRn,parto:{},rn:{}};
 fs.forEach(f=>d[f.scope][f.key]=raw[f.scope+'_'+f.key]);
 try{await rpc('registrarNascimento',d);el('nascStatus').textContent='Nascimento salvo. Consulte a ficha da mãe; o RN ainda não está internado.';submit.textContent='Salvo';if(typeof carregarDashboard==='function')carregarDashboard();}
 catch(err){el('nascStatus').textContent=err.message;submit.disabled=false;}
 });
 }catch(e){alert(e.message);}
}
async function detalhes(leito,body){
 const section=document.createElement('section');body.append(section);section.textContent='Carregando dados completos da mãe e do RN…';
 try{
 const fs=await schema();const id=leito.idInternacao;
 const pep=await rpc('obterProntuario',id);
 if(!section.isConnected)return;
 const renderObject=(obj)=>`<dl class="row">${Object.entries(obj||{}).filter(([k,v])=>v!=null&&typeof v!=='object'&&!/^id/i.test(k)).map(([k,v])=>`<dt class="col-md-4">${esc(k)}</dt><dd class="col-md-8">${esc(v)}</dd>`).join('')}</dl>`;
 section.innerHTML=box('Cadastro e internação',renderObject(pep.internacao));
 for(const b of pep.binomio||[])section.insertAdjacentHTML('beforeend',box(`${b.tipoPaciente}: ${b.nome}`,renderObject(b)));
 if(leito.tipoPaciente==='RN'||pep.internacao.sexo!=='F')return;
 const nascs=await rpc('obterNascimentos',{idInternacao:id});
 if(!section.isConnected)return;
 if(!nascs.length){section.insertAdjacentHTML('beforeend','<p>Nenhum registro de nascimento vinculado.</p>');return;}
 const vistos=new Set();
 for(const n of nascs){
 if(!vistos.has(n.id_parto)){vistos.add(n.id_parto);section.insertAdjacentHTML('beforeend',box(`Parto — ${n.tipo_parto} / ${n.setor_origem}`,values(fs.filter(f=>f.scope==='parto'),n.dados_parto)));}
 const card=document.createElement('section');card.className='card p-3 mb-3';
 card.innerHTML=`<h4>${esc(n.nome)} — RN ${esc(n.ordem)}</h4><p>${n.internacao?`Internação: ${esc(n.internacao.status)} / ${esc(n.internacao.setor)}`:'Apenas vinculado à mãe — sem internação'}</p>${values(fs.filter(f=>f.scope==='rn'),n.dados)}`;
 if(n.condicao==='Nascido Vivo'&&n.internacao?.status!=='Ativo'){
 const btn=document.createElement('button');btn.className='btn btn-outline-primary';btn.textContent='Internar este RN';btn.onclick=()=>admitir(n);card.append(btn);}
 section.append(card);
 }
 }catch(e){section.textContent=e.message;}
}
async function admitir(n){
 try{
 bootstrap.Modal.getInstance(el('offcanvasPaciente'))?.hide();
 const beds=await rpc('getLeitosDisponiveisSetor',setor(),'RN');
 const div=modal('Internação do RN vinculado',`<form><p>${esc(n.nome)} — ${esc(setor())}</p><label>Leito<select class="form-select" name="leitoId" required><option value="">Selecione</option>${beds.map(l=>`<option value="${esc(l.ID_Leito)}">${esc(l.Numero_Leito)}</option>`).join('')}</select></label><label>Data<input class="form-control" name="data" type="date" required></label><label>Hora<input class="form-control" name="hora" type="time" required></label><p role="status"></p><button type="submit" class="btn btn-primary mt-3">Confirmar internação</button></form>`);
 div.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await rpc('registrarInternacao',{...Object.fromEntries(new FormData(e.target)),idNascimento:n.id_nascimento,setor:setor(),procedencia:'NASCIDO NA MATERNIDADE'});location.reload();}catch(err){e.target.querySelector('[role=status]').textContent=err.message;b.disabled=false;}};
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
 report.innerHTML='<h4>Relatórios da planilha PPP</h4><p>Expanda um indicador para conferir os totais diários, o comparativo mensal e o percentual anual. Campos vazios aparecem como não informados.</p>'+Object.values(d.groups).map(g=>`<details class="card p-3 mb-2"><summary>${esc(g.label)}</summary><h5 class="mt-3">Diário — mês selecionado</h5><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Categoria</th>${d.diarios.map(r=>`<th>${r.dia}</th>`).join('')}<th>Total</th></tr></thead><tbody>${g.series.map(r=>`<tr><th>${esc(r.category)}</th>${r.dias.map(v=>`<td>${v}</td>`).join('')}<td>${r.dias.reduce((a,b)=>a+b,0)}</td></tr>`).join('')}</tbody></table></div><h5>Comparativo mensal / anual</h5><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Categoria</th>${d.mensais.map(r=>`<th>${r.mes}</th>`).join('')}<th>Total</th><th>% anual</th></tr></thead><tbody>${g.series.map(r=>`<tr><th>${esc(r.category)}</th>${r.meses.map(v=>`<td>${v}</td>`).join('')}<td>${g.annualCounts[r.category]}</td><td>${g.annualTotal?(100*g.annualCounts[r.category]/g.annualTotal).toFixed(1):0}%</td></tr>`).join('')}</tbody></table></div></details>`).join('');area.append(report);
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
window.NatusNascimentos={detalhes,refresh};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
