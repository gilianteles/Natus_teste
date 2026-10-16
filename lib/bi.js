/* FASE 5 — Indicadores de Qualidade, Giro de Leitos e BI Gerencial
 * Consolida as métricas vitais da maternidade em um período:
 *   - Taxa de Ocupação Hospitalar (atual e média do período);
 *   - Média de Permanência (TMP) — tempo médio entre entrada e desfecho;
 *   - Percentual de Partos Normais x Cesáreas;
 *   - Giro de leitos e Higienização Pendente;
 *   - Alertas de indicadores críticos.
 * Os dados são entregues prontos para exportação (CSV/relatório de auditoria) no front-end.
 */
const { query } = require('./db');
const { criarContexto } = require('./data');
const A = require('./auth');
const R = require('./regras');
const U = require('./util');
const C = require('./calc');
const S = v => String(v == null ? '' : v).trim();
const ehTodos = s => !s || String(s).trim().toUpperCase().indexOf('TODOS') === 0;

const DIA_MS = 86400000;
function primeiroDiaMes() { const d = new Date(); return U.formatarDataStr(new Date(d.getFullYear(), d.getMonth(), 1)); }

// Meses (ano/mês) tocados pelo período — reaproveita os indicadores mensais já consolidados do calc.js.
function mesesNoPeriodo(ini, fim) {
  const a = U.paraData(ini), b = U.paraData(fim);
  const meses = [];
  let y = a.getFullYear(), m = a.getMonth();
  const yf = b.getFullYear(), mf = b.getMonth();
  while (y < yf || (y === yf && m <= mf)) { meses.push({ ano: y, mes: m + 1 }); m++; if (m > 11) { m = 0; y++; } }
  return meses;
}

function mapaStatusLeito(leitos) {
  const m = { Livre: 0, Ocupado: 0, Reservado: 0, Reserva: 0, Bloqueado: 0, Higienizacao: 0 };
  leitos.forEach(l => { const s = S(l.Status); if (m[s] !== undefined) m[s]++; });
  return { livres: m.Livre, ocupados: m.Ocupado, reservados: m.Reservado + m.Reserva, bloqueados: m.Bloqueado, higienizacao: m.Higienizacao };
}

async function obterIndicadoresGerenciais(ctx, filtro) {
  A.exigirAdministrativo(ctx);
  filtro = filtro || {};
  const hoje = new Date();
  const dataInicial = S(filtro.dataInicial) || primeiroDiaMes();
  const dataFinal = S(filtro.dataFinal) || U.formatarDataStr(hoje);
  const ki = Number(dataInicial.replace(/\D/g, '')), kf = Number(dataFinal.replace(/\D/g, ''));
  if (!ki || !kf || ki > kf) throw new Error('Período inválido: a data inicial deve ser anterior ou igual à final.');
  const setorFiltro = S(filtro.setor) || 'TODOS';
  const diasPeriodo = Math.max(1, Math.round((U.paraData(dataFinal).getTime() - U.paraData(dataInicial).getTime()) / DIA_MS) + 1);

  const D = criarContexto();
  const setores = (await D.setores()).map(s => s.Nome_Setor);
  const alvo = ehTodos(setorFiltro) ? setores : setores.filter(s => U.igual(s, setorFiltro));

  // ----- Ocupação (tempo real) -----
  const leitosTodos = await D.leitos();
  const leitosAlvo = ehTodos(setorFiltro) ? leitosTodos : leitosTodos.filter(l => U.igual(l.ID_Setor, setorFiltro));
  const cnt = mapaStatusLeito(leitosAlvo);
  const totalLeitos = leitosAlvo.length;
  const taxaAtual = totalLeitos > 0 ? (cnt.ocupados / totalLeitos) * 100 : 0;
  const porSetorOcup = {};
  leitosTodos.forEach(l => {
    const s = S(l.ID_Setor); porSetorOcup[s] = porSetorOcup[s] || { setor: s, total: 0, ocupados: 0, higienizacao: 0 };
    porSetorOcup[s].total++; if (S(l.Status) === 'Ocupado') porSetorOcup[s].ocupados++; if (S(l.Status) === 'Higienizacao') porSetorOcup[s].higienizacao++;
  });
  const ocupacaoPorSetor = Object.values(porSetorOcup).map(x => ({ ...x, taxa: x.total > 0 ? Math.round((x.ocupados / x.total) * 1000) / 10 : 0 }));

  // ----- Indicadores do PERÍODO EXATO -----
  // Corrige a divergência em que filtros de período parcial eram tratados como meses inteiros:
  // agora cada métrica é recortada exatamente em [dataInicial, dataFinal]. O binômio Mãe+RN do
  // ALCON conta como UMA internação e a ocupação usa leito-dia (sem duplicar Mãe e RN).
  let totalLeitoDia = 0, capacidadeAcumulada = 0, admissoes = 0, altas = 0, obitos = 0, evasoes = 0, transferencias = 0, totalSaidas = 0;
  const partos = { total: 0, Normal: 0, 'Cesárea': 0, 'Fórceps': 0, 'Tratamento Clínico': 0, Outros: 0 };
  for (const s of alvo) {
    const p = await C.calcularIndicadoresPeriodo(D, s, dataInicial, dataFinal);
    totalLeitoDia += p.totalLeitoDia; capacidadeAcumulada += p.capacidadeAcumulada;
    admissoes += p.internacoesMes; altas += p.altasMes; obitos += p.obitosMes; evasoes += p.evasoesMes;
    transferencias += p.transfMes; totalSaidas += p.totalSaidasMes;
    partos.Normal += p.partos.normal || 0;
    partos['Cesárea'] += p.partos.cesarea || 0;
    partos['Fórceps'] += p.partos.forceps || 0;
    partos.Outros += p.partos.outros || 0;
  }
  partos.total = partos.Normal + partos['Cesárea'] + partos['Fórceps'];
  const percNormal = partos.total > 0 ? ((partos.Normal / partos.total) * 100) : 0;
  const percCesarea = partos.total > 0 ? ((partos['Cesárea'] / partos.total) * 100) : 0;
  const taxaOcupacaoPeriodo = capacidadeAcumulada > 0 ? ((totalLeitoDia / capacidadeAcumulada) * 100) : 0;

  // ----- TMP exato no período (entrada da internação x data do desfecho) -----
  const saidas = (await query(`SELECT m.tipo_movimento, m.data_hora_saida, i.data_hora_entrada, i.setor_nome
    FROM movimentacoes m JOIN internacoes i ON i.id_internacao = m.id_internacao
    WHERE m.data_hora_saida >= $1::timestamp AND m.data_hora_saida < ($2::date + interval '1 day')`, [dataInicial + ' 00:00:00', dataFinal])).rows;
  const saidasAlvo = ehTodos(setorFiltro) ? saidas : saidas.filter(m => U.igual(m.setor_nome, setorFiltro));
  let somaPermanencia = 0, comPermanencia = 0;
  const faixas = { '0-5 dias': 0, '6-10 dias': 0, '11-20 dias': 0, '20+ dias': 0 };
  saidasAlvo.forEach(m => {
    const d1 = new Date(m.data_hora_entrada), d2 = new Date(m.data_hora_saida);
    if (isNaN(d1) || isNaN(d2)) return;
    const dias = Math.max(0, (d2 - d1) / DIA_MS);
    somaPermanencia += dias; comPermanencia++;
    if (dias <= 5) faixas['0-5 dias']++; else if (dias <= 10) faixas['6-10 dias']++; else if (dias <= 20) faixas['11-20 dias']++; else faixas['20+ dias']++;
  });
  const tmp = comPermanencia > 0 ? somaPermanencia / comPermanencia : 0;

  // ----- Giro / Higienização -----
  const leitosHigienizacao = leitosTodos.filter(l => S(l.Status) === 'Higienizacao')
    .map(l => ({ idLeito: S(l.ID_Leito), setor: S(l.ID_Setor), numeroLeito: S(l.Numero_Leito) }));
  const taxaGiro = totalLeitos > 0 ? totalSaidas / totalLeitos : 0;

  // ----- Alertas de indicadores críticos -----
  const alertas = [];
  if (taxaAtual >= 90) alertas.push({ nivel: 'critico', titulo: 'Ocupação hospitalar crítica', detalhe: `Taxa de ocupação atual em ${taxaAtual.toFixed(1)}% (${cnt.ocupados}/${totalLeitos} leitos).` });
  else if (taxaAtual >= 80) alertas.push({ nivel: 'atencao', titulo: 'Ocupação elevada', detalhe: `Taxa de ocupação atual em ${taxaAtual.toFixed(1)}% (${cnt.ocupados}/${totalLeitos} leitos).` });
  const lotados = ocupacaoPorSetor.filter(s => s.total > 0 && s.ocupados >= s.total);
  if (lotados.length) alertas.push({ nivel: 'critico', titulo: 'Setores lotados', detalhe: lotados.map(s => `${s.setor} (${s.ocupados}/${s.total})`).join(', ') + '.' });
  if (cnt.higienizacao > 0) alertas.push({ nivel: 'info', titulo: 'Higienização pendente', detalhe: `${cnt.higienizacao} leito(s) aguardando limpeza antes de liberar para uso.` });
  if (obitos > 0) alertas.push({ nivel: 'info', titulo: 'Óbitos no período', detalhe: `${obitos} óbito(s) registrados no período selecionado.` });
  if (comPermanencia > 0 && tmp > 10) alertas.push({ nivel: 'atencao', titulo: 'Permanência prolongada', detalhe: `Tempo médio de permanência de ${tmp.toFixed(1)} dias no período.` });
  const semLeito = (await query(`SELECT count(*)::int n FROM internacoes WHERE status='Ativo' AND coalesce(id_leito,'')=''`)).rows[0].n;
  if (semLeito > 0) alertas.push({ nivel: 'atencao', titulo: 'Pacientes sem leito', detalhe: `${semLeito} paciente(s) com internação ativa ainda sem leito atribuído.` });

  return {
    periodo: { dataInicial, dataFinal, dias: diasPeriodo, meses: mesesNoPeriodo(dataInicial, dataFinal) },
    setor: setorFiltro,
    ocupacao: {
      atual: { totalLeitos, ocupados: cnt.ocupados, livres: cnt.livres, reservados: cnt.reservados, bloqueados: cnt.bloqueados, higienizacao: cnt.higienizacao, taxa: Math.round(taxaAtual * 10) / 10 },
      mediaPeriodo: Math.round(taxaOcupacaoPeriodo * 10) / 10,
      totalLeitoDia, capacidadeAcumulada,
      porSetor: ocupacaoPorSetor
    },
    permanencia: { tmp: Math.round(tmp * 10) / 10, saidas: comPermanencia, faixas },
    partos: { total: partos.total, normal: partos.Normal, cesarea: partos['Cesárea'], forceps: partos['Fórceps'], outros: partos.Outros,
      percNormal: Math.round(percNormal * 10) / 10, percCesarea: Math.round(percCesarea * 10) / 10 },
    movimentacao: { admissoes, altas, obitos, evasoes, transferencias, totalSaidas, taxaGiro: Math.round(taxaGiro * 100) / 100 },
    higienizacao: { pendentes: leitosHigienizacao.length, leitos: leitosHigienizacao },
    alertas,
    geradoEm: U.formatarDataHoraStr(new Date())
  };
}

module.exports = { obterIndicadoresGerenciais };
