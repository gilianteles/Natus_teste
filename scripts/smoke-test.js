// Teste de ponta a ponta contra um PostgreSQL real (DATABASE_URL). ATENÇÃO: apaga os dados das tabelas de negócio.
require('../lib/tz');
const assert = require('assert');
const { getPool } = require('../lib/db');
const { hashSenha } = require('../lib/auth');
const { FUNCOES } = require('../lib/rpc');
const { validarSessao } = require('../lib/auth');

const hoje = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
let sess = null;
const call = async (nome, ...a) => FUNCOES[nome]({ sessao: sess }, ...a);
const falha = async (nome, ...a) => { try { await call(nome, ...a); } catch (e) { return e.message; } throw new Error('esperava falha em ' + nome); };
let n = 0; const ok = m => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const p = getPool();
  await p.query('TRUNCATE chamadas, trocas_leito, evolucoes_soap, prescricoes, regulacao_cards, acr_atendimentos, movimentacoes, contato_pele_pele, indicadores_leito, internacoes, pacientes, leitos, setores, usuarios, sessoes, logs RESTART IDENTITY CASCADE');
  for (const s of ['UTIN 1', 'UCINCA', 'ALCON 1', 'UTI MATERNA', 'UEN']) await p.query(`INSERT INTO setores VALUES ($1,$1,'Neonatal',0)`, [s]);
  // FASE 3: um Administrador (único perfil que cadastra usuários), um NIR comum e um perfil de setor.
  await p.query(`INSERT INTO usuarios (nome,perfil,setor,senha_hash,nome_completo,cargo,status,administrador)
    VALUES ('Admin Teste','Administrador','NIR',$1,'Administrador de Testes','Administrador','Ativo',true)`, [hashSenha('abcdef1')]);
  await p.query(`INSERT INTO usuarios (nome,perfil,setor,senha_hash,status)
    VALUES ('NIR Teste','NIR','NIR',$1,'Ativo')`, [hashSenha('abcdef1')]);
  await p.query(`INSERT INTO usuarios (nome,perfil,setor,senha_hash) VALUES ('Enf UTIN','SETOR','UTIN 1','sha256$' || encode(sha256('legado1'::bytea),'hex'))`);

  console.log('Autenticação');
  assert.match(await falha('autenticar', 'NIR Teste', 'errada'), /inválidos/); ok('senha errada recusada');
  const login = await call('autenticar', 'admin teste', 'abcdef1'); sess = await validarSessao(login.token);
  assert.equal(sess.perfil, 'Administrador'); assert.equal(sess.administrador, true); ok('login Administrador (scrypt)');
  const loginNir = await call('autenticar', 'nir teste', 'abcdef1'); assert.ok(loginNir.token); ok('login NIR comum (scrypt)');
  const loginLegado = await call('autenticar', 'Enf UTIN', 'legado1'); assert.ok(loginLegado.token); ok('login legado sha256 aceito');
  assert.match((await p.query(`SELECT senha_hash h FROM usuarios WHERE nome='Enf UTIN'`)).rows[0].h, /^scrypt\$/); ok('hash legado migrado para scrypt');
  const ADMIN = sess; const ENF = await validarSessao(loginLegado.token);

  console.log('Setores e leitos');
  await call('criarSetor', { nome: 'CCO TESTE', tipo: 'Internação', leitosAtivos: 2 }); ok('criarSetor com 2 leitos');
  assert.match(await falha('criarSetor', { nome: 'cco teste' }), /Já existe/); ok('setor duplicado recusado');
  for (const s of ['UTIN 1', 'UCINCA', 'ALCON 1', 'UTI MATERNA']) for (const l of ['L1', 'L2']) await call('adicionarLeito', s, l);
  assert.match(await falha('adicionarLeito', 'UEN', 'X'), /UEN/); ok('leito manual na UEN recusado');
  sess = ENF;
  assert.match(await falha('adicionarLeito', 'UCINCA', 'Z'), /acesso/); ok('usuário de setor não mexe em outro setor');
  let painel = await call('getPainelOperacionalData', 'UTIN 1'); assert.equal(painel.leitos.length, 2); ok('painel UTIN 1 carregado');
  assert.match(await falha('getPainelOperacionalData', 'UCINCA'), /acesso/); ok('painel de outro setor bloqueado');

  console.log('Admissão e saída (UTIN 1)');
  const l1 = painel.leitos[0].ID_Leito;
  const adm = await call('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'RN de Maria', sexo: 'F', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '08:00', tipoParto: 'Cesárea', pesoNascer: '<1500', ig: '30s', horaNascimento: '07:10', numeroProntuario: '123' });
  assert.ok(adm.idInternacao); ok('internação registrada');
  assert.match(await falha('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'X', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '09:00' }), /ocupado/); ok('leito ocupado recusado');
  painel = await call('getPainelOperacionalData', 'UTIN 1');
  assert.equal(painel.resumo.ocupados, 1); assert.equal(painel.resumo.internacoesHoje, 1); assert.equal(painel.resumo.internacoesInternasHoje, 1); ok('KPIs do painel (ocupados=1, internações hoje=1, interna)');
  assert.equal(painel.leitos.find(l => l.ID_Leito === l1).pacienteNome, 'RN de Maria');
  await call('alterarStatusExameExterno', l1, true, ''); ok('exame externo');
  await call('editarInternacao', { idInternacao: adm.idInternacao, idPaciente: painel.leitos.find(l => l.ID_Leito === l1).idPaciente, nome: 'RN de Maria Silva', dataNascimento: hoje(), sexo: 'F', procedencia: 'CCO', tipoParto: 'Cesárea', pesoNascer: '<1500', ig: '31s', horaNascimento: '07:10', numeroProntuario: '123' }); ok('editarInternacao');
  const l2 = painel.leitos[1].ID_Leito;
  await call('trocarLeito', { idInternacao: adm.idInternacao, novoLeitoId: l2 }); ok('trocar leito'); 
  painel = await call('getPainelOperacionalData', 'UTIN 1'); assert.equal(painel.leitos.find(l => l.ID_Leito === l1).Status, 'Livre'); assert.equal(painel.leitos.find(l => l.ID_Leito === l2).Status, 'Ocupado'); ok('origem livre / destino ocupado');
  const r1 = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: adm.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '18:00', aleitamentoExclusivo: 'Sim', etapaCanguru: '2ª etapa' });
  assert.ok(r1.success && r1.painel.resumo.ocupados === 0 && r1.painel.resumo.altasHoje === 1); ok('alta atualiza painel (ocupados=0, altas hoje=1)');
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: adm.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Alta', data: hoje(), hora: '19:00' }), /não encontrada/); ok('alta duplicada recusada');

  console.log('Transferência UTIN 1 -> UEN (leito virtual) e extinção');
  const adm2 = await call('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'RN Beto', sexo: 'M', dataNascimento: hoje(), procedencia: 'PPP', data: hoje(), hora: '10:00' });
  const rt = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: adm2.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Transferencia', destino: 'UEN', data: hoje(), hora: '11:00' });
  assert.ok(rt.transferenciaInterna); ok('transferência para UEN cria leito virtual');
  sess = ADMIN;
  let uen = await call('getPainelOperacionalData', 'UEN'); assert.equal(uen.leitos.length, 1); assert.equal(uen.leitos[0].Numero_Leito, 'LT Extra-01'); ok('UEN: 1 leito "LT Extra-01"');
  const vz = await call('admitirVagaZeroUEN', { nome: 'RN Vaga Zero', data: hoje(), hora: '12:00', sexo: 'F', gravidade: 'Alta' }); assert.equal(vz.leito, 'LT Extra-02'); ok('vaga zero cria LT Extra-02');
  const uenInt = (await p.query(`SELECT id_internacao FROM internacoes WHERE setor_nome='UEN' AND status='Ativo' ORDER BY data_hora_entrada LIMIT 1`)).rows[0].id_internacao;
  await call('registrarMovimentacaoAtualizarPainel', { idInternacao: uenInt, setorAtual: 'UEN', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '14:00' });
  uen = await call('getPainelOperacionalData', 'UEN'); assert.equal(uen.leitos.length, 1); assert.equal(uen.leitos[0].Numero_Leito, 'LT Extra-01'); ok('UEN: leito extinto na saída e renumerado');

  console.log('ALCON (binômio Mãe + RN)');
  const al = (await call('getPainelOperacionalData', 'ALCON 1')).leitos[0].ID_Leito;
  await call('registrarInternacao', { setor: 'ALCON 1', leitoId: al, tipoPaciente: 'MAE', nome: 'Mãe Ana', dataNascimento: '1995-01-01', procedencia: 'CCO', data: hoje(), hora: '07:00', tipoProcedimento: 'Cesárea' });
  const rnAdm = await call('registrarInternacao', { setor: 'ALCON 1', leitoId: al, tipoPaciente: 'RN', nome: 'RN Ana', sexo: 'F', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '07:05', pesoNascer: '≥2500' });
  let a1 = await call('getPainelOperacionalData', 'ALCON 1'); assert.equal(a1.resumo.ocupados, 1); assert.equal(a1.internadosAtivos.length, 2); assert.equal(a1.resumo.internacoesHoje, 1); ok('binômio ocupa 1 leito, 2 internados, 1 internação hoje');
  const maeInt = (await p.query(`SELECT id_internacao FROM internacoes WHERE setor_nome='ALCON 1' AND tipo_paciente='MAE'`)).rows[0].id_internacao;
  const ra = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: maeInt, setorAtual: 'ALCON 1', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '16:00' });
  assert.ok(ra.altaMaeMantemRN); a1 = ra.painel; assert.equal(a1.resumo.ocupados, 1); assert.equal(a1.internadosAtivos.length, 1); assert.equal(a1.internadosAtivos[0].tipoPaciente, 'RN'); ok('alta da Mãe mantém RN com nova internação');
  const rn2 = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: a1.internadosAtivos[0].idInternacao, setorAtual: 'ALCON 1', tipoMovimento: 'Evasao', data: hoje(), hora: '17:00' });
  assert.equal(rn2.painel.resumo.ocupados, 0); assert.equal(rn2.painel.resumo.evasoesHoje, 1); ok('evasão do RN libera o leito ALCON');
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: uenInt, setorAtual: 'UEN', tipoMovimento: 'Evasao', data: hoje(), hora: '17:00' }), /não encontrada/);

  console.log('Qualidade / pele a pele');
  const q = (await call('getPainelOperacionalData', 'UCINCA')).leitos[0].ID_Leito;
  const ua = await call('registrarInternacao', { setor: 'UCINCA', leitoId: q, nome: 'RN Canguru', sexo: 'M', dataNascimento: hoje(), procedencia: 'UTIN 1', data: hoje(), hora: '09:00', pesoNascer: '1500-1799' });
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: ua.idInternacao, setorAtual: 'UCINCA', tipoMovimento: 'Alta', destino: 'Domiciliar (Capital)', data: hoje(), hora: '20:00' }), /peso/); ok('UCINCA exige peso na alta');
  const pl = await call('buscarIndicadoresPorLeito', q); assert.equal(pl.idInternacao, ua.idInternacao);
  await call('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: hoje(), contatoRealizado: 'Sim', duracao: 45 });
  await call('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: hoje(), contatoRealizado: 'Sim', duracao: 60 });
  assert.equal((await p.query('SELECT count(*)::int n FROM contato_pele_pele')).rows[0].n, 1); ok('pele a pele: upsert por internação+dia');
  assert.match(await falha('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: '2000-01-01', contatoRealizado: 'Sim' }), /anterior/); ok('pele a pele anterior ao nascimento recusado');
  await call('salvarIndicadoresLeito', { idInternacao: ua.idInternacao, data: hoje(), extracaoLeite: 'Sim', visitaMae: 'Sim' });
  await call('salvarIndicadoresLeito', { idInternacao: ua.idInternacao, data: hoje(), extracaoLeite: 'Sim', visitaMae: 'Sim', visitaPai: 'Sim' });
  const d = new Date(), mes = d.getMonth() + 1, ano = d.getFullYear();
  const qual = await call('getDashboardIndicadoresQualidade', `${ano}-${String(mes).padStart(2, '0')}-01`, hoje(), 'TODOS');
  assert.equal(qual.totalRegistros, 1); assert.equal(qual.visitacao.pai.sim, 1); assert.equal(qual.peleAPele1Dia.sim, 1); assert.equal(qual.aleitamentoExclusivoAlta.sim, 1); ok('dashboard de qualidade consolidado');

  console.log('Dashboards e relatórios');
  const est = await call('obterEstatisticasDashboard', 'UTIN 1', mes, ano);
  assert.equal(est.kpis.admissoesMes, 2); assert.equal(est.kpis.altasMes, 1); ok('dashboard UTIN 1: 2 admissões, 1 alta');
  const estUen = await call('obterEstatisticasDashboard', 'UEN', mes, ano); assert.equal(estUen.ehUEN, true); assert.equal(estUen.kpis.admissoesMes, 2); ok('dashboard UEN');
  const geral = await call('obterEstatisticasDashboardGeral', 'Todos os Setores', mes, ano); assert.ok(geral.ehGeral && geral.porSetor.length >= 5); ok('dashboard geral agregado');
  const rel = await call('gerarRelatorioGerencial', { setor: 'Todos os Setores', dataInicial: `${ano}-${String(mes).padStart(2, '0')}-01`, dataFinal: hoje(), indicador: 'Geral' });
  assert.ok(rel.kpis.admissoes >= 5); ok('relatório gerencial (Geral)');
  for (const ind of ['Admissoes', 'Altas', 'Obitos', 'Transferencias', 'Internados']) await call('gerarRelatorioGerencial', { setor: 'UTIN 1', dataInicial: hoje(), dataFinal: hoje(), indicador: ind });
  ok('relatório gerencial (demais indicadores)');
  const nirD = await call('obterDadosNIR'); assert.ok(nirD.find(x => x.setor === 'UTIN 1')); ok('painel NIR');

  console.log('Histórico');
  const busca = await call('buscarPacientesPorNome', 'x', 'maria'); assert.equal(busca.length, 1);
  const hist = await call('obterHistoricoPaciente', 'x', busca[0].idPaciente); assert.equal(hist.internacoes[0].tipoSaida, 'Alta'); assert.ok(hist.internacoes[0].leito); ok('busca e linha do tempo');
  const belo = await call('buscarPacientesPorNome', 'x', "%%"); assert.equal(belo.length, 0); ok('curinga LIKE escapado');

  console.log('FASE 1 — ACR (busca por CPF / Cartão SUS)');
  sess = ENF;   // qualquer colaborador autenticado pode usar o acolhimento
  const atend = await call('registrarAtendimentoACR', { nome: 'Mãe ACR Teste', dataNascimento: '1994-05-10', sexo: 'F',
    cpf: '529.982.247-25', cartaoSus: '700000000000000', telefone: '92988887777', queixa: 'trabalho de parto', risco: 'Laranja', destino: 'PPP' });
  assert.ok(atend.idPaciente && atend.idAtendimento); ok('atendimento ACR registrado');
  const buscaCpf = await call('buscarPacientePorDocumento', { tipo: 'CPF', documento: '52998224725' });
  assert.ok(buscaCpf.encontrado && buscaCpf.paciente.nome === 'Mãe ACR Teste'); ok('busca por CPF localiza a paciente');
  const buscaSus = await call('buscarPacientePorDocumento', { tipo: 'SUS', documento: '700000000000000' });
  assert.ok(buscaSus.encontrado && buscaSus.atendimentoACR && buscaSus.atendimentoACR.risco === 'Laranja'); ok('busca por Cartão SUS + atendimento aberto');
  const buscaNada = await call('buscarPacientePorDocumento', { tipo: 'CPF', documento: '111.111.111-11' });
  assert.equal(buscaNada.encontrado, false); ok('documento sem cadastro devolve "não encontrado"');
  assert.match(await falha('buscarPacientePorDocumento', { tipo: 'CPF', documento: '' }), /CPF|Cartão/); ok('busca sem documento recusada');
  const fila = await call('listarAtendimentosACR', { data: hoje() });
  assert.ok(fila.some(a => a.idAtendimento === atend.idAtendimento)); ok('fila do ACR lista o atendimento do dia');
  const resumoAcr = await call('obterResumoACR', hoje());
  assert.equal(resumoAcr.porRisco.Laranja, 1); assert.equal(resumoAcr.porStatus.Aguardando, 1); ok('resumo do ACR por risco/situação');
  await call('atualizarAtendimentoACR', { idAtendimento: atend.idAtendimento, status: 'Em Atendimento' }); ok('situação do atendimento atualizada');

  console.log('FASE 2 — Kanban de regulação do NIR');
  sess = ADMIN;   // Administrador
  let kb = await call('obterKanban', {});
  let colAguard = kb.colunas.find(c => c.id === 'aguardando');
  let cardAcr = colAguard.cards.find(c => c.nome === 'Mãe ACR Teste');
  assert.ok(cardAcr); ok('card do ACR entra em "Aguardando Avaliação"');
  assert.ok(kb.colunas.find(c => c.id === 'internado').cards.length >= 1); ok('internações ativas viram cards em "Internado / Ativo"');
  assert.match(await falha('moverCardKanban', { idCard: cardAcr.idCard, coluna: 'internado' }), /leito/); ok('bloqueia "Internado / Ativo" sem internação ativa');
  // FASE 5: uma saída deixa o leito em "Higienização Pendente"; a equipe de higienização o
  // devolve como Disponível (concluirHigienizacao) antes de uma nova admissão.
  let painelKb = await call('getPainelOperacionalData', 'UTIN 1');
  assert.ok(painelKb.leitos.some(l => l.Status === 'Higienizacao')); ok('FASE 5: leito fica em Higienização Pendente após a alta');
  for (const l of painelKb.leitos.filter(x => x.Status === 'Higienizacao')) await call('concluirHigienizacao', l.ID_Leito);
  painelKb = await call('getPainelOperacionalData', 'UTIN 1');
  const leitoKb = painelKb.leitos.find(l => l.Status === 'Livre');
  assert.ok(leitoKb); ok('FASE 5: concluir higienização libera o leito como Disponível');
  // O CPF liga a internação ao cadastro criado pelo ACR (mesma paciente), promovendo o card.
  await call('registrarInternacao', { setor: 'UTIN 1', leitoId: leitoKb.ID_Leito, nome: 'Mãe ACR Teste', sexo: 'F', dataNascimento: '1994-05-10', procedencia: 'PPP', data: hoje(), hora: '13:30', cpf: '529.982.247-25' });
  kb = await call('obterKanban', {});
  colAguard = kb.colunas.find(c => c.id === 'aguardando');
  assert.ok(!colAguard.cards.some(c => c.nome === 'Mãe ACR Teste')); ok('card sai do ACR ao ganhar leito');
  const cardInt = kb.colunas.find(c => c.id === 'internado').cards.find(c => c.nome === 'Mãe ACR Teste');
  assert.ok(cardInt && cardInt.idInternacao); ok('card vinculado à internação em tempo real');
  const mv = await call('moverCardKanban', { idCard: cardInt.idCard, coluna: 'alta', responsavel: 'Regulador Teste', observacao: 'Giro de leito iminente' });
  assert.ok(mv.success && /alta/i.test(mv.statusRegulacao)); ok('drag & drop move o card e grava o status operacional');
  const stReg = (await p.query('SELECT status_regulacao s FROM internacoes WHERE id_internacao=$1', [cardInt.idInternacao])).rows[0].s;
  assert.match(stReg, /alta/i); ok('status_regulacao espelhado na internação');
  kb = await call('obterKanban', {});
  assert.ok(kb.colunas.find(c => c.id === 'alta').cards.some(c => c.idCard === cardInt.idCard)); ok('quadro persiste a coluna escolhida');
  await call('registrarMovimentacaoAtualizarPainel', { idInternacao: cardInt.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '22:00' });
  kb = await call('obterKanban', {});
  assert.ok(!kb.colunas.some(c => c.cards.some(x => x.idCard === cardInt.idCard))); ok('card sai do quadro quando a internação encerra');
  sess = ENF;
  assert.match(await falha('obterKanban', {}), /restrito/); ok('Kanban restrito aos perfis de gestão');

  console.log('FASE 3 — cadastro de usuários (somente Administrador)');
  sess = ADMIN;   // Administrador
  const usuarioCompleto = { nome: 'Novo', perfil: 'Setor', setor: 'UTIN 1', senha: 'segredo1', nomeCompleto: 'Novo Colaborador',
    cpf: '168.995.350-09', email: 'novo.colaborador@mab.org', telefone: '92999990000', cargo: 'Recepcionista', status: 'Ativo' };
  await call('salvarUsuario', 'x', usuarioCompleto); ok('Administrador cadastra usuário com dados completos');
  const uNovo = (await p.query(`SELECT nome_completo, cpf, email, telefone, cargo, status, administrador FROM usuarios WHERE lower(nome)='novo'`)).rows[0];
  assert.equal(uNovo.nome_completo, 'Novo Colaborador'); assert.equal(uNovo.cargo, 'Recepcionista'); assert.equal(uNovo.administrador, false); ok('novos campos gravados na tabela');
  assert.match(await falha('salvarUsuario', 'x', { ...usuarioCompleto, nome: 'SemCpf', cpf: '123' }), /CPF/); ok('CPF inválido recusado');
  assert.match(await falha('salvarUsuario', 'x', { ...usuarioCompleto, nome: 'SemEmail', email: 'invalido' }), /e-mail/); ok('e-mail inválido recusado');
  assert.match(await falha('salvarUsuario', 'x', { ...usuarioCompleto, nome: 'SemCargo', cargo: '' }), /Cargo/); ok('cargo obrigatório validado');
  sess = await validarSessao(loginNir.token);   // perfil NIR comum
  assert.match(await falha('salvarUsuario', 'x', { ...usuarioCompleto, nome: 'Bloqueado' }), /Administrador/); ok('perfil NIR bloqueado de cadastrar usuário');
  assert.match(await falha('excluirUsuario', 'x', 'Novo'), /Administrador/); ok('perfil NIR bloqueado de excluir usuário');
  assert.ok((await call('obterUsuariosAdministrativos', 'x')).length >= 3); ok('perfil NIR mantém apenas a consulta (leitura)');
  sess = ADMIN;
  assert.match(await falha('excluirUsuario', 'x', ADMIN.nome), /própria/); ok('não exclui a própria conta');
  await call('excluirUsuario', 'x', 'Novo'); ok('Administrador exclui usuário');
  assert.match(await falha('salvarUsuario', 'x', { nome: 'SemSenha', perfil: 'Operador', setor: 'UTIN 1', nomeCompleto: 'Sem Senha', cpf: '390.533.447-05', email: 'semsenha@mab.org', telefone: '92999990000', cargo: 'Recepcionista', status: 'Ativo' }), /senha/); ok('senha inicial obrigatória em novo cadastro');
  // usuário inativo não entra no sistema
  await call('salvarUsuario', 'x', { ...usuarioCompleto, nome: 'Inativo', status: 'Inativo', cpf: '390.533.447-05', email: 'inativo@mab.org' });
  assert.match(await falha('autenticar', 'Inativo', 'segredo1'), /inativo/i); ok('usuário inativo bloqueado no login');
  sess = ENF;
  assert.match(await falha('obterUsuariosAdministrativos', 'x'), /restrito/); assert.match(await falha('gerarRelatorioGerencial', {}), /restrito/); ok('perfil SETOR sem acesso administrativo');
  const buscaNome = await call('buscarPacientesPorNome', 'x', 'Mãe ACR'); assert.equal(buscaNome.length, 1); ok('paciente do ACR disponível no histórico');
  assert.match(await falha('obterEstatisticasDashboardGeral', 'Todos', 1, 2026), /restrito/); ok('dashboard geral restrito ao perfil de setor');

  console.log('FASE 4 — Prontuário Eletrônico (PEP): SOAP, prescrições e binômio Mãe-Bebê');
  sess = ADMIN;
  // Giro de leitos: concluir higienização devolve o leito à operação.
  let pUtin = await call('getPainelOperacionalData', 'UTIN 1');
  const hig = pUtin.leitos.find(l => l.Status === 'Higienizacao');
  assert.ok(hig); ok('FASE 5: leito em Higienização Pendente disponível na UTIN 1');
  await call('concluirHigienizacao', hig.ID_Leito); ok('FASE 5: concluir higienização devolve o leito');
  await call('marcarHigienizacao', hig.ID_Leito);
  assert.equal((await call('getPainelOperacionalData', 'UTIN 1')).leitos.find(l => l.ID_Leito === hig.ID_Leito).Status, 'Higienizacao'); ok('FASE 5: marcar higienização volta a bloquear o leito');
  await call('concluirHigienizacao', hig.ID_Leito);
  const leitoPep = (await call('getPainelOperacionalData', 'UTIN 1')).leitos.find(l => l.Status === 'Livre');
  const pepAdm = await call('registrarInternacao', { setor: 'UTIN 1', leitoId: leitoPep.ID_Leito, nome: 'RN PEP', sexo: 'M', dataNascimento: hoje(), procedencia: 'CCO',
    data: hoje(), hora: '06:00', tipoParto: 'Normal', ig: '32s', horaNascimento: '05:50', apgar1: 8, apgar5: 9, pesoGramas: 1520, reanimacao: 'Não', pulseira: 'RN-001' });
  const bd = (await p.query('SELECT apgar_1min a1, apgar_5min a5, peso_gramas pg, reanimacao r, pulseira pl FROM internacoes WHERE id_internacao=$1', [pepAdm.idInternacao])).rows[0];
  assert.equal(bd.a1, 8); assert.equal(bd.a5, 9); assert.equal(bd.pg, 1520); assert.equal(bd.r, 'Não'); assert.equal(bd.pl, 'RN-001');
  ok('dados ao nascer gravados (APGAR 1º/5º, peso em gramas, reanimação, pulseira)');

  let pront = await call('obterProntuario', pepAdm.idInternacao);
  assert.equal(pront.internacao.nome, 'RN PEP'); assert.equal(pront.internacao.apgar1, 8); assert.equal(pront.internacao.pesoGramas, 1520);
  assert.ok(pront.opcoes.categorias.length >= 5 && pront.opcoes.tiposPrescricao.length >= 5); ok('prontuário carregado com dados ao nascer e opções do PEP');

  const ev1 = await call('salvarEvolucaoSOAP', { idInternacao: pepAdm.idInternacao, categoria: 'Médico', profissional: 'Dra. Teste', data: hoje(), hora: '08:00',
    subjetivo: 'RN ativo, bom padrão respiratório', objetivo: 'FR 48, SpO2 96%', avaliacao: 'Evolução estável', plano: 'Manter suporte' });
  assert.ok(ev1.idEvolucao); ok('evolução clínica SOAP registrada');
  assert.match(await falha('salvarEvolucaoSOAP', { idInternacao: pepAdm.idInternacao, categoria: 'Médico' }), /ao menos um campo/); ok('evolução sem nenhum campo recusada');
  assert.match(await falha('salvarEvolucaoSOAP', { idInternacao: pepAdm.idInternacao, categoria: 'Invenção', subjetivo: 'x' }), /Categoria/); ok('categoria profissional inválida recusada');
  assert.equal((await call('listarEvolucoesSOAP', { idInternacao: pepAdm.idInternacao })).length, 1); ok('evolução SOAP listada no prontuário');

  const pr1 = await call('salvarPrescricao', { idInternacao: pepAdm.idInternacao, tipo: 'Medicamento', descricao: 'Cafeína citrato', dose: '20 mg', via: 'EV', frequencia: '24/24h', status: 'Ativa', data: hoje(), hora: '08:10' });
  assert.ok(pr1.idPrescricao); ok('prescrição registrada');
  assert.match(await falha('salvarPrescricao', { idInternacao: pepAdm.idInternacao, tipo: 'Medicamento', descricao: '' }), /prescrição/i); ok('prescrição sem descrição recusada');
  await call('atualizarStatusPrescricao', { idPrescricao: pr1.idPrescricao, status: 'Suspensa' });
  assert.equal((await call('listarPrescricoes', { idInternacao: pepAdm.idInternacao }))[0].status, 'Suspensa'); ok('situação da prescrição atualizada (Ativa → Suspensa)');
  await call('excluirEvolucaoSOAP', ev1.idEvolucao);
  assert.equal((await call('listarEvolucoesSOAP', { idInternacao: pepAdm.idInternacao })).length, 0); ok('evolução SOAP excluída');

  // FIX 1 (servidor): a Mãe (UTI Materna) não guarda faixa de peso.
  const leitoMae = (await call('getPainelOperacionalData', 'UTI MATERNA')).leitos.find(l => l.Status === 'Livre');
  const admMae = await call('registrarInternacao', { setor: 'UTI MATERNA', leitoId: leitoMae.ID_Leito, nome: 'Mãe Binômio', sexo: 'F', dataNascimento: '1993-02-02', procedencia: 'CCO', data: hoje(), hora: '05:40', pesoNascer: '<1500' });
  const pesoMae = (await p.query('SELECT peso_nascer p FROM internacoes WHERE id_internacao=$1', [admMae.idInternacao])).rows[0].p;
  assert.equal(pesoMae, ''); ok('FIX 1: faixa de peso ignorada na internação da Mãe (UTI Materna)');
  await call('vincularBinomio', { idInternacaoMae: admMae.idInternacao, idInternacaoRn: pepAdm.idInternacao });
  pront = await call('obterProntuario', admMae.idInternacao);
  assert.equal(pront.binomio.length, 2); assert.ok(pront.binomio.some(b => b.idInternacao === pepAdm.idInternacao)); ok('binômio Mãe-Bebê vincula os dois prontuários');
  const binsAlcon = (await p.query(`SELECT count(DISTINCT id_binomio)::int n FROM internacoes WHERE setor_nome='ALCON 1' AND id_binomio<>''`)).rows[0].n;
  assert.equal(binsAlcon, 1); ok('ALCON gera um único binômio automático para Mãe e RN');

  console.log('FASE 5 — Indicadores de qualidade e BI gerencial');
  const bi = await call('obterIndicadoresGerenciais', { dataInicial: `${ano}-${String(mes).padStart(2, '0')}-01`, dataFinal: hoje(), setor: 'TODOS' });
  assert.ok(bi.ocupacao.porSetor.length >= 5); ok('BI: taxa de ocupação por setor (tempo real)');
  assert.ok(typeof bi.permanencia.tmp === 'number'); ok('BI: tempo médio de permanência (TMP)');
  assert.ok(bi.partos.total >= 1 && bi.partos.normal >= 1 && bi.partos.cesarea >= 1); ok('BI: percentual de partos normais x cesáreas');
  assert.ok(Array.isArray(bi.alertas) && bi.higienizacao.pendentes >= 1); ok('BI: alertas de indicadores críticos e higienização pendente');
  sess = ENF;
  assert.match(await falha('obterIndicadoresGerenciais', { setor: 'TODOS' }), /restrito/); ok('BI gerencial restrito aos perfis de gestão');

  console.log('FASE 6 — Consulta de CPF (CADSUS), painel de chamadas e correções de cálculo');
  sess = ENF;   // qualquer colaborador autenticado usa a consulta e o painel
  // CADSUS: sem fonte externa configurada, o proxy cai para a base interna do Natus.
  const cadsus = await call('buscarCadsusPorCpf', { cpf: '529.982.247-25' });
  assert.ok(cadsus.encontrado && cadsus.paciente.nome === 'Mãe ACR Teste' && cadsus.origem === 'local'); ok('CADSUS: CPF localizado na base interna (fallback do proxy)');
  assert.match(await falha('buscarCadsusPorCpf', { cpf: '123' }), /11 dígitos/); ok('CADSUS: CPF incompleto recusado');
  assert.match(await falha('buscarCadsusPorCpf', { cpf: '111.111.111-11' }), /inválido/); ok('CADSUS: CPF inválido recusado');
  assert.equal((await call('buscarCadsusPorCpf', { cpf: '390.533.447-05' })).encontrado, false); ok('CADSUS: CPF sem registro devolve "não encontrado"');
  // O nome da mãe preenchido pela consulta é persistido no cadastro da paciente.
  await call('registrarAtendimentoACR', { idPaciente: atend.idPaciente, nome: 'Mãe ACR Teste', dataNascimento: '1994-05-10', sexo: 'F', nomeMae: 'Dona Filiação', risco: 'Verde' });
  assert.equal((await p.query(`SELECT nome_mae m FROM pacientes WHERE id_paciente=$1`, [atend.idPaciente])).rows[0].m, 'Dona Filiação'); ok('nome da mãe (CADSUS/cadastro) gravado na paciente');

  // Painel de chamadas (TV/recepção): leitura PÚBLICA + operação autenticada.
  sess = ADMIN;
  const cham = await call('chamarProximo', { idAtendimento: atend.idAtendimento, setor: 'Consultório 1', consultorio: 'Consultório 1' });
  assert.ok(cham.senha); ok('painel: "chamar próxima" gera uma senha de chamada');
  const pub = await FUNCOES.obterPainelChamadas({ sessao: null }, {});   // público, sem sessão
  assert.ok(pub.atual && pub.atual.senha === cham.senha); ok('painel: leitura pública funciona sem login');
  assert.ok(pub.atual.nome.indexOf('Mãe') === 0 && pub.atual.nome.indexOf('ACR') < 0); ok('painel: privacidade — exibe apenas primeiro nome + inicial');
  assert.ok(Array.isArray((await call('listarFilaChamada')).fila)); ok('painel: fila do operador carregada');
  await call('rechamar', { idChamada: cham.idChamada });
  assert.equal((await FUNCOES.obterPainelChamadas({ sessao: null }, {})).atual.repeticoes, 2); ok('painel: "chamar novamente" incrementa as repetições');
  await call('finalizarChamada', { idChamada: cham.idChamada, status: 'Atendida' });
  const pub3 = await FUNCOES.obterPainelChamadas({ sessao: null }, {});
  assert.ok(!pub3.atual || pub3.atual.idChamada !== cham.idChamada); ok('painel: chamada finalizada sai do ar');

  // Troca de leito auditada: preserva origem/destino para a reconstrução histórica da ocupação.
  const trocas = (await p.query('SELECT count(*)::int n FROM trocas_leito')).rows[0].n;
  assert.ok(trocas >= 1); ok(`troca de leito registrada em auditoria (${trocas} registro(s))`);

  // BI: filtro de período PARCIAL é recortado exatamente (não conta meses inteiros).
  const biDia = await call('obterIndicadoresGerenciais', { dataInicial: hoje(), dataFinal: hoje(), setor: 'TODOS' });
  assert.equal(biDia.periodo.dias, 1); ok('BI: período parcial recortado exatamente (1 dia, sem inflar o mês)');
  assert.ok(biDia.movimentacao.admissoes >= 1); ok('BI: admissões do recorte exato do dia');

  // Binômio ALCON: a admissão conjunta Mãe+RN conta como UMA internação (não duplica).
  const estAlcon = await call('obterEstatisticasDashboard', 'ALCON 1', mes, ano);
  assert.equal(estAlcon.kpis.admissoesMes, 1); ok('ALCON: Mãe + RN contam como 1 internação (binômio)');
  assert.ok(estAlcon.estatisticas.peso && typeof estAlcon.estatisticas.peso.menor1500 === 'number'); ok('ALCON/neonatal: faixa de peso do RN calculada sem a Mãe no denominador');

  await p.query(`UPDATE sessoes SET expira_em = now() - interval '1 minute'`);
  assert.equal(await validarSessao(loginLegado.token), null); ok('sessão expirada é rejeitada');
  const logs = (await p.query('SELECT count(*)::int n FROM logs')).rows[0].n; assert.ok(logs > 20); ok(`auditoria registrada (${logs} eventos)`);
  console.log(`\nTODOS OS ${n} TESTES PASSARAM`);
  await p.end();
})().catch(e => { console.error('\nFALHOU:', e.stack || e.message); process.exit(1); });
