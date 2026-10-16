const { query, transacao, selectCols } = require('./db');
const { criarContexto } = require('./data');
const U = require('./util');
const { registrarLog } = require('./log');
const { exigirSetor, exigirAdministrativo } = require('./auth');
const { formatarDataStr, formatarDataHoraStr, paraData, upper, novoId } = U;
const S = v => String(v == null ? '' : v).trim();
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

function calcularDiaVidaPeleAPele(dataNascimento, dataContato) {
  const nasc = paraData(dataNascimento), contato = paraData(dataContato);
  if (!nasc || !contato) return '';
  nasc.setHours(0, 0, 0, 0); contato.setHours(0, 0, 0, 0);
  const dias = Math.round((contato.getTime() - nasc.getTime()) / 86400000) + 1;
  if (dias === 1) return '1º Dia de Vida';
  if (dias >= 2 && dias <= 4) return '2º ao 4º Dia de Vida';
  if (dias > 4) return `${dias}º Dia de Vida`;
  return 'Data anterior ao nascimento';
}
const limparDatas = o => { Object.keys(o).forEach(k => { if (o[k] instanceof Date) o[k] = formatarDataHoraStr(o[k]); }); return o; };

/* Internação ativa vinculada ao leito (mesmo critério do painel: paciente + status Ativo). */
async function internacaoAtivaDoLeito(idLeito) {
  const l = (await query('SELECT setor_nome, status, id_paciente_atual FROM leitos WHERE id_leito=$1', [S(idLeito)])).rows[0];
  if (!l) throw new Error('Leito não encontrado.');
  if (S(l.status) !== 'Ocupado' || !l.id_paciente_atual) return { leito: l, intInfo: null };
  const i = (await query(`SELECT id_internacao, id_paciente, setor_nome FROM internacoes WHERE id_paciente=$1 AND status='Ativo' ORDER BY data_hora_entrada DESC LIMIT 1`, [l.id_paciente_atual])).rows[0];
  return { leito: l, intInfo: i || null };
}

async function obterDadosPeleAPelePorLeito(ctx, idLeito) {
  const { leito, intInfo } = await internacaoAtivaDoLeito(idLeito);
  exigirSetor(ctx, leito.setor_nome);
  if (!intInfo) return { idInternacao: '', paciente: '', dataNascimento: '', registro: null, historico: [] };
  const p = (await query('SELECT nome, data_nascimento FROM pacientes WHERE id_paciente=$1', [intInfo.id_paciente])).rows[0];
  const historico = (await query(`SELECT ${selectCols('contato_pele_pele')} FROM contato_pele_pele WHERE id_internacao=$1 ORDER BY data_contato`, [intInfo.id_internacao])).rows
    .map(r => limparDatas({ ...r, Data_Contato: formatarDataStr(r.Data_Contato) }));
  const hoje = formatarDataStr(new Date());
  return { idInternacao: intInfo.id_internacao, paciente: p ? p.nome : '', dataNascimento: p ? formatarDataStr(p.data_nascimento) : '',
    registro: historico.find(r => r.Data_Contato === hoje) || null, historico };
}

async function salvarContatoPeleAPele(ctx, dados) {
  const idInternacao = S(dados.idInternacao), dataContato = S(dados.dataContato);
  if (!idInternacao) throw new Error('Internação não informada.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataContato)) throw new Error('Informe a data do contato/avaliação.');
  return transacao(async c => {
    const it = (await c.query('SELECT id_paciente, id_leito, setor_nome FROM internacoes WHERE id_internacao=$1', [idInternacao])).rows[0];
    if (!it) throw new Error('Internação não encontrada.');
    exigirSetor(ctx, it.setor_nome);
    const p = (await c.query('SELECT data_nascimento FROM pacientes WHERE id_paciente=$1', [it.id_paciente])).rows[0];
    if (!p) throw new Error('Paciente não encontrado.');
    const diaVida = calcularDiaVidaPeleAPele(p.data_nascimento, dataContato);
    if (!diaVida || diaVida === 'Data anterior ao nascimento') throw new Error('A data do contato não pode ser anterior ao nascimento do RN.');
    const realizado = S(dados.contatoRealizado || 'Não') === 'Sim' ? 'Sim' : 'Não';
    await c.query(`INSERT INTO contato_pele_pele (id_pele_pele,id_internacao,id_paciente,id_leito,setor_nome,data_contato,contato_realizado,duracao_min,dia_vida,registrado_por,data_hora_registro)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() AT TIME ZONE 'America/Manaus')
      ON CONFLICT (id_internacao, data_contato) DO UPDATE SET contato_realizado=EXCLUDED.contato_realizado, duracao_min=EXCLUDED.duracao_min,
        dia_vida=EXCLUDED.dia_vida, registrado_por=EXCLUDED.registrado_por, data_hora_registro=EXCLUDED.data_hora_registro`,
      [novoId('PP'), idInternacao, it.id_paciente, it.id_leito, it.setor_nome, dataContato, realizado, realizado === 'Sim' ? (Math.max(0, Number(dados.duracao)) || 0) : 0, diaVida, usuarioDe(ctx)]);
    await registrarLog(c, usuarioDe(ctx), 'CONTATO_PELE_A_PELE', `Contato pele a pele diário registrado para Internação ${idInternacao} em ${dataContato}: ${realizado} (${diaVida}).`);
    return { success: true, diaVida };
  });
}

async function salvarIndicadoresLeito(ctx, dados) {
  const idInternacao = S(dados.idInternacao), data = S(dados.data);
  if (!idInternacao) throw new Error('Internação não informada.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data do registro não informada.');
  const sn = v => (S(v) === 'Sim' ? 'Sim' : 'Não');
  return transacao(async c => {
    const it = (await c.query('SELECT id_paciente, id_leito, setor_nome FROM internacoes WHERE id_internacao=$1', [idInternacao])).rows[0];
    if (!it) throw new Error('Internação não encontrada.');
    exigirSetor(ctx, it.setor_nome);
    await c.query(`INSERT INTO indicadores_leito (id_indicador,id_internacao,id_paciente,id_leito,setor_nome,data,extracao_leite_beira_leito,visita_mae,visita_pai,visita_irmao,visita_avos,registrado_por,data_hora_registro)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() AT TIME ZONE 'America/Manaus')
      ON CONFLICT (id_internacao, data) DO UPDATE SET extracao_leite_beira_leito=EXCLUDED.extracao_leite_beira_leito, visita_mae=EXCLUDED.visita_mae,
        visita_pai=EXCLUDED.visita_pai, visita_irmao=EXCLUDED.visita_irmao, visita_avos=EXCLUDED.visita_avos, registrado_por=EXCLUDED.registrado_por,
        data_hora_registro=EXCLUDED.data_hora_registro`,
      [novoId('IND'), idInternacao, it.id_paciente, it.id_leito, it.setor_nome, data, sn(dados.extracaoLeite), sn(dados.visitaMae), sn(dados.visitaPai), sn(dados.visitaIrmao), sn(dados.visitaAvos), usuarioDe(ctx)]);
    await registrarLog(c, usuarioDe(ctx), 'INDICADORES_LEITO', `Indicadores de qualidade registrados para Internação ${idInternacao} em ${data}.`);
    return { success: true };
  });
}

async function buscarIndicadoresPorLeito(ctx, idLeito) {
  const { leito, intInfo } = await internacaoAtivaDoLeito(idLeito);
  exigirSetor(ctx, leito.setor_nome);
  if (!intInfo) return { idInternacao: '', hoje: null, historico: [] };
  const historico = (await query(`SELECT ${selectCols('indicadores_leito')} FROM indicadores_leito WHERE id_internacao=$1 ORDER BY data`, [intInfo.id_internacao])).rows
    .map(r => limparDatas({ ...r, Data: formatarDataStr(r.Data), Data_Hora_Registro: formatarDataHoraStr(r.Data_Hora_Registro) }));
  const hojeStr = formatarDataStr(new Date());
  const p = (await query('SELECT data_nascimento FROM pacientes WHERE id_paciente=$1', [intInfo.id_paciente])).rows[0];
  const historicoPele = (await query(`SELECT ${selectCols('contato_pele_pele')} FROM contato_pele_pele WHERE id_internacao=$1 ORDER BY data_contato`, [intInfo.id_internacao])).rows
    .map(r => limparDatas({ ...r, Data_Contato: formatarDataStr(r.Data_Contato), Data_Hora_Registro: formatarDataHoraStr(r.Data_Hora_Registro) }));
  return { idInternacao: intInfo.id_internacao, hoje: historico.find(r => r.Data === hojeStr) || null, historico,
    dataNascimentoISO: p ? formatarDataStr(p.data_nascimento) : '', peleHoje: historicoPele.find(r => r.Data_Contato === hojeStr) || null, historicoPele };
}

/* Dashboard de qualidade do leito (Método Canguru / Linha Amigável) — regras do original. */
async function getDashboardIndicadoresQualidade(ctx, filtroDataInicio, filtroDataFim, setor) {
  const setorFiltro = upper(setor || 'TODOS');
  if (setorFiltro === 'TODOS') exigirAdministrativo(ctx); else exigirSetor(ctx, setor);
  const D = criarContexto();
  const dtIni = paraData(filtroDataInicio), dtFim = paraData(filtroDataFim);
  if (dtIni) dtIni.setHours(0, 0, 0, 0);
  const dtFimEx = dtFim ? new Date(dtFim.getFullYear(), dtFim.getMonth(), dtFim.getDate() + 1) : null;
  const noPeriodo = v => { const d = paraData(v); if (!d) return false; d.setHours(0, 0, 0, 0); return !((dtIni && d < dtIni) || (dtFimEx && d >= dtFimEx)); };
  const doSetor = r => setorFiltro === 'TODOS' || upper(r.ID_Setor) === setorFiltro;
  const sel = setorFiltro === 'TODOS' ? null : S(setor);

  const registros = (await D.rows(`SELECT ${selectCols('indicadores_leito')} FROM indicadores_leito`)).filter(r => noPeriodo(r.Data) && doSetor(r));
  const total = registros.length;
  const pct = (n, t = total) => t > 0 ? Number(((n / t) * 100).toFixed(1)) : 0;
  const contaSim = campo => registros.filter(r => S(r[campo]) === 'Sim').length;

  const internacoes = await D.internacoes(sel);
  const internacoesPeriodo = internacoes.filter(i => S(i.ID_Internacao) !== '' && noPeriodo(i.Data_Hora_Entrada));
  const idsRN = new Set(internacoesPeriodo.map(i => S(i.ID_Internacao)));
  const totalRNs = idsRN.size;

  const contatos = (await D.rows(`SELECT ${selectCols('contato_pele_pele')} FROM contato_pele_pele WHERE contato_realizado='Sim'`))
    .filter(r => noPeriodo(r.Data_Contato) && idsRN.has(S(r.ID_Internacao)) && doSetor(r));
  const primeiro = new Map();
  contatos.forEach(r => {
    const id = S(r.ID_Internacao); if (!id) return;
    const data = formatarDataStr(r.Data_Contato), atual = primeiro.get(id);
    if (!atual || data < atual.data) primeiro.set(id, { data, dia: S(r.Dia_Vida) });
  });
  let p1 = 0, p24 = 0;
  primeiro.forEach(r => { if (r.dia === '1º Dia de Vida') p1++; if (r.dia === '2º ao 4º Dia de Vida') p24++; });

  const idsSetor = new Set(internacoes.map(i => S(i.ID_Internacao)));
  const altas = (await D.movimentacoes(sel)).filter(m => S(m.Tipo_Movimento) === 'Alta' && idsSetor.has(S(m.ID_Internacao)) && noPeriodo(m.Data_Hora_Saida));
  const altasAlei = altas.filter(m => S(m.Aleitamento_Exclusivo_Alta) === 'Sim').length;
  const etapas = {};
  altas.forEach(m => { const e = S(m.Etapa_Metodo_Canguru); if (e) etapas[e] = (etapas[e] || 0) + 1; });

  return {
    totalRegistros: total, totalAltas: altas.length, totalRNsInternados: totalRNs,
    peleAPele1Dia: { sim: p1, percentual: pct(p1, totalRNs) },
    peleAPele2a4Dia: { sim: p24, percentual: pct(p24, totalRNs) },
    extracaoLeite: { sim: contaSim('Extracao_Leite_Beira_Leito'), percentual: pct(contaSim('Extracao_Leite_Beira_Leito')) },
    visitacao: { mae: { sim: contaSim('Visita_Mae'), percentual: pct(contaSim('Visita_Mae')) }, pai: { sim: contaSim('Visita_Pai'), percentual: pct(contaSim('Visita_Pai')) },
      irmao: { sim: contaSim('Visita_Irmao'), percentual: pct(contaSim('Visita_Irmao')) }, avos: { sim: contaSim('Visita_Avos'), percentual: pct(contaSim('Visita_Avos')) } },
    aleitamentoExclusivoAlta: { sim: altasAlei, total: altas.length, percentual: altas.length > 0 ? Number(((altasAlei / altas.length) * 100).toFixed(1)) : 0 },
    etapaMetodoCanguru: etapas
  };
}

module.exports = { obterDadosPeleAPelePorLeito, salvarContatoPeleAPele, salvarIndicadoresLeito, buscarIndicadoresPorLeito, getDashboardIndicadoresQualidade };
