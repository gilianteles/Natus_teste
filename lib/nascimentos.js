const {query,transacao}=require('./db');
const A=require('./auth'), U=require('./util'), B=require('./binomio');
const {registrarLog}=require('./log');
const campos=require('../public/nascimentos-campos.json');
const S=v=>String(v??'').trim();
async function mae(ctx,id,c={query}) {
 const i=(await c.query(`SELECT i.*,p.nome,p.sexo FROM internacoes i JOIN pacientes p USING(id_paciente) WHERE id_internacao=$1`,[S(id)])).rows[0];
 if(!i)throw new Error('Internação não encontrada.');
 A.exigirSetor(ctx,i.setor_nome);
 if(B.tipoInternacao(i)==='RN'||i.sexo!=='F')throw new Error('Selecione a internação da mãe.');
 return i;
}
function validar(d,scope) {
 const out={};
 for(const f of campos.filter(f=>f.scope===scope)) {
  const v=S(d?.[f.key]);
  if(!v){if(f.required)throw new Error(`Informe ${f.label}.`);continue;}
  if(v.length>500)throw new Error(`Texto muito longo: ${f.label}.`);
  if(f.type==='select'&&!f.options.includes(v))throw new Error(`Opção inválida: ${f.label}.`);
  if(f.type==='number'&&(!Number.isFinite(Number(v))||Number(v)<f.min||Number(v)>f.max))throw new Error(`Valor inválido: ${f.label}.`);
  if(f.type==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v))throw new Error('Data inválida.');
  if(f.type==='time'&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error('Hora inválida.');
  out[f.key]=f.type==='number'?Number(v):v;
 }
 return out;
}
async function registrarNascimento(ctx,d) {
 return transacao(async c=>{
  const i=await mae(ctx,d.idInternacao,c);
  if(i.status!=='Ativo'||!['PPP','CCO','CPNI'].includes(i.setor_nome))throw new Error('O nascimento deve ser registrado em internação materna ativa no PPP, CCO ou CPNI.');
  const pd=validar(d.parto,'parto'),rn=validar(d.rn,'rn');
  const ordem=Number(d.ordem);
  if(!Number.isInteger(ordem)||ordem<1||ordem>10)throw new Error('Ordem do RN inválida.');
  const dt=new Date(U.montarDataHora(rn.AS,rn.W));
  if(dt>new Date())throw new Error('Nascimento não pode ser no futuro.');
  if(dt<new Date(i.data_hora_entrada)&&pd.O!=='SIM')throw new Error('Nascimento anterior à admissão: informe parto domiciliar quando aplicável.');
  let parto=(await c.query('SELECT * FROM partos WHERE id_internacao_mae=$1',[i.id_internacao])).rows[0];
  if(!parto){
   // Não cria outro parto ao registrar o segundo RN depois de uma transferência.
   parto=(await c.query(`SELECT p.* FROM partos p JOIN internacoes x ON x.id_internacao=p.id_internacao_mae WHERE p.id_mae=$1 AND x.data_hora_entrada<=$2 AND EXISTS(SELECT 1 FROM nascimentos n WHERE n.id_parto=p.id_parto AND abs(n.data_nascimento-$3::date)<=1)`,[i.id_paciente,i.data_hora_entrada,rn.AS])).rows[0];
  }
  if(!parto){
   const tipo=i.setor_nome==='CCO'?'Cesárea':S(d.tipoParto)||'Normal';
   if(!['Normal','Cesárea'].includes(tipo))throw new Error('Tipo de parto inválido.');
   parto=(await c.query(`INSERT INTO partos(id_parto,id_mae,id_internacao_mae,setor_origem,tipo_parto,dados,criado_por) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[U.novoId('PARTO'),i.id_paciente,i.id_internacao,i.setor_nome,tipo,JSON.stringify(pd),ctx.sessao.nome])).rows[0];
  }
  const existe=(await c.query('SELECT * FROM nascimentos WHERE id_parto=$1 AND ordem=$2',[parto.id_parto,ordem])).rows[0];
  if(existe)throw new Error('Esta ordem de RN já foi registrada neste parto. Consulte os registros antes de repetir.');
  const id=U.novoId('NASC'),pac=U.novoId('PAC');
  await c.query(`INSERT INTO pacientes(id_paciente,nome,data_nascimento,sexo,nome_mae) VALUES($1,$2,$3,$4,$5)`,[pac,S(d.nomeRn)||`RN ${ordem} de ${i.nome}`,rn.AS,rn.AA==='INDEF.'?'I':rn.AA,i.nome]);
  await c.query(`INSERT INTO nascimentos(id_nascimento,id_parto,ordem,id_rn,data_nascimento,hora_nascimento,condicao,dados) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,parto.id_parto,ordem,pac,rn.AS,rn.W,rn.X,JSON.stringify(rn)]);
  await c.query("UPDATE internacoes SET tipo_paciente='MAE' WHERE id_internacao=$1",[i.id_internacao]);
  await registrarLog(c,ctx.sessao.nome,'REGISTRAR_NASCIMENTO',`Nascimento ${id}; parto ${parto.id_parto}; mãe ${i.id_paciente}. Sem internação automática.`);
  return {success:true,idNascimento:id,idPaciente:pac,idParto:parto.id_parto};
 });
}
async function obterNascimentos(ctx,d) {
 const i=await mae(ctx,d.idInternacao);
 return (await query(`SELECT n.*,p.dados AS dados_parto,p.tipo_parto,p.setor_origem,r.nome,
 (SELECT jsonb_build_object('id',x.id_internacao,'setor',x.setor_nome,'status',x.status) FROM internacoes x WHERE x.id_paciente=n.id_rn ORDER BY x.data_hora_entrada DESC LIMIT 1) AS internacao
 FROM partos p JOIN nascimentos n USING(id_parto) JOIN pacientes r ON r.id_paciente=n.id_rn
 WHERE p.id_mae=$1 ORDER BY n.data_nascimento,n.ordem`,[i.id_paciente])).rows;
}
async function registrarAltaBinomio(c,i,dt,rn=null){
 await c.query(`INSERT INTO altas_binomio(id_internacao_mae,id_internacao_rn,setor_nome,data_hora,modalidade) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[i.id_internacao,rn,i.setor_nome,dt,rn?'CONJUNTA':'VINCULADO']);
}
async function registrarAltaVinculado(c,i,dt){
 const r=await c.query(`SELECT 1 FROM partos p JOIN nascimentos n USING(id_parto) WHERE p.id_mae=$1 AND n.condicao='Nascido Vivo' AND n.data_nascimento<=$2::date AND n.data_nascimento>= $3::date - 30 AND NOT EXISTS(SELECT 1 FROM internacoes x WHERE x.id_paciente=n.id_rn) LIMIT 1`,[i.id_paciente,dt,i.data_hora_entrada]);
 if(r.rows.length)await registrarAltaBinomio(c,i,dt);
}
async function obterAltasBinomio(ctx,d){
 A.exigirSetor(ctx,d.setor);
 return (await query(`SELECT count(*)::int total FROM altas_binomio WHERE setor_nome=$1 AND data_hora::date BETWEEN $2::date AND $3::date`,[d.setor,d.inicio,d.fim])).rows[0];
}
module.exports={registrarNascimento,obterNascimentos,registrarAltaBinomio,registrarAltaVinculado,obterAltasBinomio,validar};
function agregar(rows,ano,mes,admissoes=[]) {
 const all=rows.filter(r=>String(r.data_nascimento).slice(0,4)===String(ano));
 const data=all.filter(r=>!mes||Number(String(r.data_nascimento).slice(5,7))===Number(mes));
 const unique=rs=>Array.from(new Map(rs.map(r=>[r.id_parto,r])).values());
 const partoDate=r=>String(r.data_parto||r.data_nascimento);
 const partosAno=unique(all).filter(r=>partoDate(r).slice(0,4)===String(ano));
 const partos=partosAno.filter(r=>!mes||Number(partoDate(r).slice(5,7))===Number(mes)), groups={};
 const group=(key,label,rs,fn)=>{
  const counts={},annual=rs===data?all:partosAno,annualCounts={};
  for(const r of rs){const v=S(fn(r))||'Não informado';counts[v]=(counts[v]||0)+1;}
  for(const r of annual){const v=S(fn(r))||'Não informado';annualCounts[v]=(annualCounts[v]||0)+1;}
  const date=r=>rs===data?String(r.data_nascimento):partoDate(r);
  const series=Object.keys(annualCounts).map(category=>({category,
   dias:Array.from({length:new Date(ano,mes,0).getDate()},(_,j)=>rs.filter(r=>(S(fn(r))||'Não informado')===category&&Number(date(r).slice(8,10))===j+1).length),
   meses:Array.from({length:12},(_,j)=>annual.filter(r=>(S(fn(r))||'Não informado')===category&&Number(date(r).slice(5,7))===j+1).length)
  }));
  groups[key]={label,total:rs.length,counts,annualCounts,annualTotal:annual.length,series};
 };
 group('tipo','Tipo de parto',partos,r=>r.tipo_parto);group('condicao','Condição ao nascer',data,r=>r.condicao);
 for(const f of campos.filter(f=>f.type==='select'||['Y','Z'].includes(f.key)))group(f.key,f.label,f.scope==='rn'?data:partos,r=>(f.scope==='rn'?r.dados:r.dados_parto)?.[f.key]);
 group('idade','Idade materna',partos,r=>{const a=r.dados_parto.F;return a==null?'Não informado':a<18?'≤17 anos':a<=25?'18–25 anos':a<=40?'26–40 anos':'>40 anos';});
 group('peso','Peso ao nascer',data,r=>r.dados.AB==null?'Não informado':r.dados.AB<2500?'<2500 g':'≥2500 g');
 group('turno','Turno de nascimento (07h–18h59 / 19h–06h59)',data,r=>{const h=Number(String(r.hora_nascimento).slice(0,2));return h>=7&&h<19?'Diurno':'Noturno';});
 const serie=(rs)=>({partos:unique(rs).length,nascimentos:rs.length,vivos:rs.filter(r=>r.condicao==='Nascido Vivo').length,mortos:rs.filter(r=>r.condicao==='Nascido Morto').length});
 const mensais=Array.from({length:12},(_,n)=>({mes:n+1,internacoes:admissoes.filter(r=>Number(String(r.data).slice(5,7))===n+1).length,...serie(all.filter(r=>Number(String(r.data_nascimento).slice(5,7))===n+1)),partos:partosAno.filter(r=>Number(partoDate(r).slice(5,7))===n+1).length}));
 const dias=mes?new Date(ano,mes,0).getDate():31;
 const diarios=Array.from({length:dias},(_,n)=>({dia:n+1,internacoes:admissoes.filter(r=>Number(String(r.data).slice(5,7))===Number(mes)&&Number(String(r.data).slice(8,10))===n+1).length,...serie(data.filter(r=>Number(String(r.data_nascimento).slice(8,10))===n+1)),partos:partos.filter(r=>Number(partoDate(r).slice(8,10))===n+1).length}));
 return {kpis:{...serie(data),partos:partos.length,internacoes:admissoes.filter(r=>!mes||Number(String(r.data).slice(5,7))===Number(mes)).length},groups,mensais,diarios};
}
async function obterDashboardNascimentos(ctx,d){
 const setor=S(d.setor);if(!setor||setor==='TODOS')A.exigirAdministrativo(ctx);else A.exigirSetor(ctx,setor);
 const ano=Number(d.ano),mes=Number(d.mes);if(!Number.isInteger(ano)||ano<2000||ano>2100||!Number.isInteger(mes)||mes<1||mes>12)throw new Error('Período inválido.');
 const filtro=(!setor||setor==='TODOS')?null:setor;
 const rows=(await query(`SELECT (SELECT min(nn.data_nascimento)::text FROM nascimentos nn WHERE nn.id_parto=n.id_parto) data_parto,n.id_parto,n.data_nascimento::text,n.hora_nascimento::text,n.condicao,n.dados,p.dados dados_parto,p.tipo_parto FROM nascimentos n JOIN partos p USING(id_parto) WHERE n.data_nascimento >= $1::date AND n.data_nascimento < $2::date AND ($3::text IS NULL OR p.setor_origem=$3)`,[`${ano}-01-01`,`${ano+1}-01-01`,filtro])).rows;
 const ads=(await query(`SELECT data_hora_entrada::date::text data FROM internacoes WHERE setor_nome IN ('PPP','CCO','CPNI') AND ($3::text IS NULL OR setor_nome=$3) AND data_hora_entrada >= $1::date AND data_hora_entrada < $2::date AND upper(tipo_paciente) NOT IN ('RN')`,[`${ano}-01-01`,`${ano+1}-01-01`,filtro])).rows;
 return agregar(rows,ano,mes,ads);
}
module.exports.obterDashboardNascimentos=obterDashboardNascimentos;
module.exports.agregar=agregar;
