// Testes reais de SQL em PostgreSQL em memória; nenhuma conexão ao banco do hospital.
require('../lib/tz');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');const db=new PGlite(),parsers={};
const q=async(sql,args=[])=>{const ps=args.map(v=>v instanceof Date?`${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')} ${String(v.getHours()).padStart(2,'0')}:${String(v.getMinutes()).padStart(2,'0')}:${String(v.getSeconds()).padStart(2,'0')}`:v);const r=await db.query(sql,ps,{parsers});return {...r,rowCount:r.affectedRows===undefined?r.rows.length:r.affectedRows};};
class Pool{query(...a){return q(...a);}async connect(){return {query:q,release(){}};}on(){}async end(){}}
require.cache[require.resolve('pg')]={loaded:true,exports:{Pool,types:{setTypeParser:(id,fn)=>parsers[id]=fn}}};process.env.DATABASE_URL='isolated-test-only';
const O=require('../lib/operacoes'),C=require('../lib/calc'),D=require('../lib/data'),A=require('../lib/auth'),CL=require('../lib/clinica'),Q=require('../lib/qualidade');
const ctx={sessao:{nome:'Teste',perfil:'NIR',setor:'',administrador:true}};
const report=(s,a,b)=>C.calcularIndicadoresPeriodo(D.criarContexto(),s,a,b),one=async(s,p)=>(await q(s,p)).rows[0];
async function bed(id,s){await q("INSERT INTO leitos(id_leito,setor_nome,numero_leito,status) VALUES($1,$2,$1,'Livre')",[id,s]);}
async function admit(setor,leito,tipo,nome,data='2026-09-01',hora='08:00'){return O.registrarInternacao(ctx,{setor,leitoId:leito,tipoPaciente:tipo,nome,dataNascimento:'2026-09-01',sexo:tipo==='MAE'?'F':'M',procedencia:'DOMICILIO',data,hora,tipoParto:'Normal'});}
async function move(id,tipo,destino,leito,data,hora='10:00',tp=''){return O.registrarMovimentacao(ctx,{idInternacao:id,tipoMovimento:tipo,destino,leitoDestinoId:leito,data,hora,tipoPaciente:tp});}
async function main(){
 await db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
 const migration=fs.readFileSync(path.join(__dirname,'../db/migrations/20261017_alcon_seguranca.sql'),'utf8');
 // Reproduz upgrade a partir de banco que ainda não contém a auditoria.
 await q('DROP TABLE trocas_leito');
 await q("INSERT INTO setores(id_setor,nome_setor) VALUES('UTIN 1','UTIN 1'),('ALCON 1','ALCON 1')");
 await bed('LEGADO','UTIN 1'); await bed('LEGADO-ALCON','ALCON 1');
 const P=require('../lib/painel');
 let legado=await P.getPainelOperacionalData(ctx,'UTIN 1');
 assert.equal(legado.leitos.length,1);assert.equal(legado.avisos.length,1);
 legado=await P.getPainelOperacionalData(ctx,'ALCON 1');
 assert.equal(legado.leitos.length,1);assert.equal(legado.resumo.internacoesHoje,null);
 await assert.rejects(report('ALCON 1','2026-09-01','2026-09-02'),/migração/);
 await db.exec(migration);await db.exec(migration);
 legado=await P.getPainelOperacionalData(ctx,'ALCON 1');assert.equal(legado.avisos.length,0);assert.equal(legado.resumo.internacoesHoje,0);
 await q("DELETE FROM leitos WHERE id_leito IN ('LEGADO','LEGADO-ALCON')");await q("DELETE FROM setores WHERE id_setor IN ('UTIN 1','ALCON 1')");
 console.log('OK: banco legado sem auditoria carrega leitos; KPI dependente indisponível sinalizado; migração completa/repetível restaura histórico.');
 for(const s of ['ALCON 1','ALCON 2','UTI MATERNA','UTIN 1','CCO','PPP'])await q('INSERT INTO setores(id_setor,nome_setor) VALUES($1,$1)',[s]);
 for(const [id,s] of [['A1','ALCON 1'],['A2','ALCON 1'],['B1','ALCON 2'],['B2','ALCON 2'],['M1','UTI MATERNA'],['M2','UTI MATERNA'],['N1','UTIN 1'],['C1','CCO']])await bed(id,s);
 const m=await admit('UTI MATERNA','M1','','Mãe teste');const tr=await move(m.idInternacao,'Transferencia','ALCON 1','A1','2026-09-01','09:00');
 let l=await one("SELECT * FROM leitos WHERE id_leito='A1'");assert.ok(l.id_paciente_mae);assert.equal(l.id_paciente_rn,null);
 assert.equal((await one('SELECT tipo_paciente FROM internacoes WHERE id_internacao=$1',[tr.novaIdInternacao])).tipo_paciente,'MAE');
 const list=await O.obterInfoLeitosSetorDestino(ctx,'ALCON 1','RN');assert.ok(list.livres.some(x=>x.ID_Leito==='A2'));assert.ok(list.complementares.some(x=>x.ID_Leito==='A1'));
 assert.equal((await O.obterInfoLeitosSetorDestino(ctx,'ALCON 1','MAE')).complementares.length,0);
 assert.ok((await O.getLeitosDisponiveisSetor(ctx,'ALCON 1','RN')).some(x=>x.ID_Leito==='A1'));
 const rn=await admit('ALCON 1','A1','RN','RN teste','2026-09-02');
 assert.equal((await report('ALCON 1','2026-09-01','2026-09-02')).internacoesMes,1);assert.equal((await report('ALCON 1','2026-09-02','2026-09-02')).internacoesMes,0);
 assert.equal((await report('ALCON 1','2026-09-01','2026-09-02')).totalLeitoDia,2);
 await assert.rejects(admit('ALCON 1','A1','RN','Duplicado'),/RN internado/);
 assert.equal((await O.obterInfoLeitosSetorDestino(ctx,'ALCON 1','RN')).complementares.length,0);
 const high=await move(tr.novaIdInternacao,'Alta','DOMICILIAR','','2026-09-03');assert.ok(high.altaMaeMantemRN);
 const ind=await report('ALCON 1','2026-09-01','2026-09-04');assert.equal(ind.internacoesMes,2);assert.equal(ind.totalLeitoDia,4);assert.equal(ind.totalPacienteDia,5);
 assert.equal((await report('ALCON 1','2026-09-03','2026-09-03')).internacoesMes,1);
 assert.equal((await C.calcularIndicadoresSetor(D.criarContexto(),'ALCON 1',9,2026)).internacoesMes,2);
 assert.equal(C.obterInternacoesHojeAlcon(await D.criarContexto().internacoes('ALCON 1'),await D.criarContexto().movimentacoes('ALCON 1'),'2026-09-03').length,1);
 const geral=await C.gerarRelatorioGerencial(D.criarContexto(),{setor:'ALCON 1',dataInicial:'2026-09-01',dataFinal:'2026-09-04',indicador:'Geral'});assert.equal(geral.kpis.admissoes,2);assert.equal(geral.kpis.pacienteDia,4);
 console.log('OK: transferência materna; leitos livres/complementares; binômio=1; RN clínico=2; BI parcial; ocupação/relatório sem duplicação.');
 const r2=await admit('ALCON 2','B1','RN','RN primeiro','2026-08-31');const m2=await admit('ALCON 2','B1','MAE','Mãe depois');
 assert.equal((await report('ALCON 2','2026-08-31','2026-09-01')).internacoesMes,1);assert.equal((await report('ALCON 2','2026-09-01','2026-09-01')).internacoesMes,0);
 await O.trocarLeito(ctx,{idInternacao:r2.idInternacao,novoLeitoId:'B2'});
 assert.ok((await one("SELECT * FROM leitos WHERE id_leito='B1'")).id_paciente_mae);assert.equal((await one("SELECT * FROM leitos WHERE id_leito='B1'")).id_paciente_rn,null);
 assert.ok((await one("SELECT * FROM leitos WHERE id_leito='B2'")).id_paciente_rn);assert.equal((await report('ALCON 2','2026-09-01','2026-09-01')).totalLeitoDia,1);
 const mt=await move(m2.idInternacao,'Transferencia','ALCON 1','A2','2026-09-05');assert.ok(mt.transferenciaInterna);assert.equal((await one("SELECT * FROM leitos WHERE id_leito='B1'")).status,'Higienizacao');
 const unknown=await admit('CCO','C1','','Paciente sem tipo');await assert.rejects(move(unknown.idInternacao,'Transferencia','ALCON 2','B1','2026-09-06'),/Informe se o paciente/);
 await O.concluirHigienizacao(ctx,'B1');const um=await move(unknown.idInternacao,'Transferencia','ALCON 2','B1','2026-09-06','10:00','MAE');assert.ok(um.transferenciaInterna);assert.ok((await one("SELECT * FROM leitos WHERE id_leito='B1'")).id_paciente_mae);
 console.log('OK: RN primeiro e virada de mês; histórico após troca; ALCON→ALCON; origem ambígua exige Mãe/RN.');
 await bed('A3','ALCON 1');const wrong=await admit('ALCON 1','A3','RN','Mãe correção');const wrongRow=await one('SELECT * FROM internacoes WHERE id_internacao=$1',[wrong.idInternacao]);
 await O.editarInternacao(ctx,{idInternacao:wrong.idInternacao,idPaciente:wrongRow.id_paciente,nome:'Mãe correção',tipoPaciente:'MAE',dataNascimento:'2000-01-01',sexo:'F'});
 l=await one("SELECT * FROM leitos WHERE id_leito='A3'");assert.equal(l.id_paciente_mae,wrongRow.id_paciente);assert.equal(l.id_paciente_rn,null);
 const qr=await Q.getDashboardIndicadoresQualidade(ctx,'2026-09-02','2026-09-02','ALCON 1');assert.equal(qr.totalRNsInternados,1);
 await Q.salvarContatoPeleAPele(ctx,{idInternacao:rn.idInternacao,dataContato:'2026-09-02',contatoRealizado:'Sim',duracao:60});
 const qr2=await Q.getDashboardIndicadoresQualidade(ctx,'2026-09-02','2026-09-02','ALCON 1');assert.equal(qr2.peleAPele2a4Dia.percentual,100);
 console.log('OK: correção do cadastro sincroniza card; denominador neonatal exclui mães.');
 const ev=await CL.salvarEvolucaoSOAP(ctx,{idInternacao:high.novaIdInternacaoRN,subjetivo:'Original'});
 await CL.salvarEvolucaoSOAP(ctx,{idInternacao:high.novaIdInternacaoRN,idEvolucao:ev.idEvolucao,subjetivo:'Retificado',motivo:'Corrigir transcrição'});
 await CL.excluirEvolucaoSOAP(ctx,ev.idEvolucao,'Registro cancelado por teste');
 const pep=await CL.obterProntuario(ctx,high.novaIdInternacaoRN);const saved=pep.evolucoes.find(x=>x.idEvolucao===ev.idEvolucao);assert.equal(saved.versoes.length,3);assert.equal(saved.versoes[0].dados.subjetivo,'Original');assert.ok(saved.cancelada);
 await assert.rejects(CL.salvarEvolucaoSOAP(ctx,{idInternacao:high.novaIdInternacaoRN,idEvolucao:ev.idEvolucao,subjetivo:'Apagar',motivo:'teste'}),/cancelada/);
 await assert.rejects(q('DELETE FROM evolucoes_soap WHERE id_evolucao=$1',[ev.idEvolucao]),/não podem ser apagadas/);await assert.rejects(q('DELETE FROM evolucoes_soap_versoes WHERE id_evolucao=$1',[ev.idEvolucao]),/imutável/);
 await db.exec(migration);assert.equal((await one('SELECT count(*)::int n FROM evolucoes_soap_versoes WHERE id_evolucao=$1',[ev.idEvolucao])).n,3);
 console.log('OK: SOAP original/retificação/cancelamento; versões imutáveis; migração repetível.');
 await q("INSERT INTO usuarios(nome,perfil,setor,senha_hash,status) VALUES('Teste','NIR','',$1,'Ativo')",[A.hashSenha('senha-teste')]);
 const login=await A.autenticar({},'Teste','senha-teste');assert.ok(login.token);assert.ok((await one("SELECT token FROM sessoes WHERE nome='Teste'")).token.startsWith('sha256$'));assert.equal((await A.validarSessao(login.token)).perfil,'NIR');
 await q("UPDATE usuarios SET perfil='SETOR',setor='UTIN 1' WHERE nome='Teste'");assert.equal(await A.validarSessao(login.token),null);
 const login2=await A.autenticar({},'Teste','senha-teste');assert.equal((await A.validarSessao(login2.token)).setor,'UTIN 1');await A.encerrarSessao({},login2.token);assert.equal(await A.validarSessao(login2.token),null);
 console.log('OK: sessão por hash, permissões atuais, revogação e logout.');
 await require('./http-regression-test')({A,q,ctx});
 await db.close();
}
main().catch(async e=>{console.error(e);try{await db.close();}catch(_){}process.exitCode=1;});
