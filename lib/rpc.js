// Registro das funções expostas ao front-end (mesmos nomes do antigo google.script.run).
const A = require('./auth');
const O = require('./operacoes');
const P = require('./painel');
const Q = require('./qualidade');
const H = require('./historico');
const C = require('./calc');
const ACR = require('./acr');
const K = require('./kanban');
const CLIN = require('./clinica');
const BI = require('./bi');
const { criarContexto } = require('./data');

const ehTodos = s => !s || String(s).trim() === '' || String(s).trim().toUpperCase().indexOf('TODOS') === 0;
const setorEscopo = (ctx, setor) => { if (ehTodos(setor)) A.exigirAdministrativo(ctx); else A.exigirSetor(ctx, setor); };

// O front-end legado envia o token como 1º argumento nestas chamadas; o servidor usa o cabeçalho Authorization.
const semToken = fn => (ctx, _token, ...a) => fn(ctx, ...a);
const PUBLICAS = new Set(['autenticar']);
const FUNCOES = {
  autenticar: A.autenticar,
  encerrarSessao: A.encerrarSessao,
  // painel / NIR
  getPainelOperacionalData: (ctx, setor) => { A.exigirSetor(ctx, setor); return P.getPainelOperacionalData(ctx, setor); },
  obterDadosNIR: (ctx) => { A.exigirAdministrativo(ctx); return P.obterDadosNIR(ctx); },
  // internação / movimentação / leitos
  registrarInternacao: O.registrarInternacao,
  admitirVagaZeroUEN: O.admitirVagaZeroUEN,
  registrarMovimentacaoAtualizarPainel: O.registrarMovimentacaoAtualizarPainel,
  trocarLeito: O.trocarLeito,
  editarInternacao: O.editarInternacao,
  alterarStatusLeito: O.alterarStatusLeito,
  alterarStatusExameExterno: O.alterarStatusExameExterno,
  // FASE 5 — giro de leitos: higienização
  concluirHigienizacao: O.concluirHigienizacao,
  marcarHigienizacao: O.marcarHigienizacao,
  adicionarLeito: O.adicionarLeito,
  removerLeito: O.removerLeito,
  obterInfoLeitosSetorDestino: O.obterInfoLeitosSetorDestino,
  getLeitosDisponiveisSetor: O.getLeitosDisponiveisSetor,
  // setores e usuários
  obterSetores: O.obterSetores,
  criarSetor: O.criarSetor,
  removerSetor: O.removerSetor,
  obterUsuariosAdministrativos: semToken(A.obterUsuariosAdministrativos),
  obterSetoresParaUsuario: semToken(A.obterSetoresParaUsuario),
  obterOpcoesUsuario: semToken(A.obterOpcoesUsuario),
  salvarUsuario: semToken(A.salvarUsuario),
  excluirUsuario: semToken(A.excluirUsuario),
  // FASE 1 — ACR (Acolhimento com Classificação de Risco)
  buscarPacientePorDocumento: ACR.buscarPacientePorDocumento,
  registrarAtendimentoACR: ACR.registrarAtendimentoACR,
  atualizarAtendimentoACR: ACR.atualizarAtendimentoACR,
  listarAtendimentosACR: ACR.listarAtendimentosACR,
  obterResumoACR: ACR.obterResumoACR,
  // FASE 2 — Kanban de regulação do NIR
  obterKanban: K.obterKanban,
  moverCardKanban: K.moverCardKanban,
  criarCardKanban: K.criarCardKanban,
  removerCardKanban: K.removerCardKanban,
  internarCardKanban: K.internarCardKanban,
  // FASE 4 — Assistência Clínica / Prontuário Eletrônico (PEP)
  obterProntuario: CLIN.obterProntuario,
  listarEvolucoesSOAP: CLIN.listarEvolucoesSOAP,
  salvarEvolucaoSOAP: CLIN.salvarEvolucaoSOAP,
  excluirEvolucaoSOAP: CLIN.excluirEvolucaoSOAP,
  listarPrescricoes: CLIN.listarPrescricoes,
  salvarPrescricao: CLIN.salvarPrescricao,
  atualizarStatusPrescricao: CLIN.atualizarStatusPrescricao,
  vincularBinomio: CLIN.vincularBinomio,
  // FASE 5 — Indicadores de qualidade e BI gerencial
  obterIndicadoresGerenciais: BI.obterIndicadoresGerenciais,
  // qualidade
  buscarIndicadoresPorLeito: Q.buscarIndicadoresPorLeito,
  salvarIndicadoresLeito: Q.salvarIndicadoresLeito,
  obterDadosPeleAPelePorLeito: Q.obterDadosPeleAPelePorLeito,
  salvarContatoPeleAPele: Q.salvarContatoPeleAPele,
  getDashboardIndicadoresQualidade: Q.getDashboardIndicadoresQualidade,
  // dashboards e relatórios
  obterEstatisticasDashboard: (ctx, setor, mes, ano) => { A.exigirSetor(ctx, setor); return C.obterEstatisticasDashboard(criarContexto(), setor || 'UTIN 1', mes, ano); },
  obterEstatisticasDashboardGeral: (ctx, setor, mes, ano) => { setorEscopo(ctx, setor); return C.obterEstatisticasDashboardGeral(criarContexto(), setor, mes, ano); },
  gerarRelatorioGerencial: (ctx, dados) => { A.exigirAdministrativo(ctx); return C.gerarRelatorioGerencial(criarContexto(), dados); },
  // histórico
  buscarPacientesPorNome: semToken(H.buscarPacientesPorNome),
  obterHistoricoPaciente: semToken(H.obterHistoricoPaciente)
};

// Erros de regra de negócio (Error simples) vão ao usuário; falhas técnicas ficam só no log.
function mensagemSegura(e) {
  if (e && e.constructor === Error && !e.code) return { status: 400, msg: e.message };
  console.error('[rpc] erro interno:', e);
  return { status: 500, msg: 'Erro interno. Tente novamente em instantes.' };
}
module.exports = { FUNCOES, PUBLICAS, mensagemSegura };
