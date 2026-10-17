/* FASE 4 — Assistência Clínica (Prontuário Eletrônico Simplificado - PEP)
 *  - Vínculo do binômio Mãe-Bebê (prontuário/leito da puérpera x RN: UTIN, UCI, UCINCO/UCINCA ou ALCON).
 *  - Evolução clínica diária no modelo SOAP (Subjetivo, Objetivo, Avaliação, Plano).
 *  - Prescrições e histórico unificado (movimentações + evolução + prescrições) por internação/paciente.
 * O acesso é sempre recortado por setor (exigirSetor) — os perfis NIR/gestão enxergam todos os setores.
 */
const { query, transacao } = require('./db');
const A = require('./auth');
const R = require('./regras');
const U = require('./util');
const { registrarLog } = require('./log');
const S = v => String(v == null ? '' : v).trim();
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

async function carregarInternacao(ctx, idInternacao) {
  const id = S(idInternacao);
  if (!id) throw new Error('Informe a internação.');
  const { rows } = await query(`SELECT i.*, p.nome AS paciente_nome, p.data_nascimento, p.sexo, p.cpf, p.cartao_sus, p.telefone, p.numero_prontuario, p.nome_mae,
      l.numero_leito AS leito_numero
    FROM internacoes i JOIN pacientes p ON p.id_paciente=i.id_paciente
    LEFT JOIN leitos l ON l.id_leito=i.id_leito WHERE i.id_internacao=$1`, [id]);
  const i = rows[0];
  if (!i) throw new Error('Internação não encontrada.');
  A.exigirSetor(ctx, i.setor_nome);
  return i;
}

function diasDesde(dataHora) {
  if (!(dataHora instanceof Date)) return 0;
  const hoje = new Date();
  const d1 = new Date(dataHora.getFullYear(), dataHora.getMonth(), dataHora.getDate());
  const d2 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
}

/* ---------- binômio Mãe-Bebê ---------- */
/* Reúne as internações ligadas à mesma mãe/RN: pelo id_binomio e, como contingência, pelo leito
 * compartilhado do ALCON (id_paciente_mae / id_paciente_rn). */
async function binomioDa(internacao) {
  const vistos = new Set([S(internacao.id_internacao)]);
  const vinculos = [];
  const push = row => { if (row && !vistos.has(S(row.id_internacao))) { vistos.add(S(row.id_internacao)); vinculos.push(row); } };
  const COLUNAS = `i.id_internacao, i.id_paciente, i.setor_nome, i.numero_leito, i.tipo_paciente, i.status, i.data_hora_entrada,
      i.peso_nascer, i.peso_gramas, i.apgar_1min, i.apgar_5min, i.reanimacao, i.pulseira, i.id_binomio,
      p.nome AS paciente_nome, p.data_nascimento, p.sexo, p.numero_prontuario`;
  if (S(internacao.id_binomio)) {
    const { rows } = await query(`SELECT ${COLUNAS} FROM internacoes i JOIN pacientes p ON p.id_paciente=i.id_paciente
      WHERE i.id_binomio=$1 ORDER BY i.data_hora_entrada`, [internacao.id_binomio]);
    rows.forEach(push);
  }
  if (S(internacao.id_leito)) {
    const l = (await query('SELECT id_paciente_mae, id_paciente_rn FROM leitos WHERE id_leito=$1', [internacao.id_leito])).rows[0];
    if (l) {
      const ids = [S(l.id_paciente_mae), S(l.id_paciente_rn)].filter(Boolean);
      if (ids.length) {
        const { rows } = await query(`SELECT ${COLUNAS} FROM internacoes i JOIN pacientes p ON p.id_paciente=i.id_paciente
          WHERE i.id_paciente = ANY($1) AND i.status='Ativo' ORDER BY i.data_hora_entrada`, [ids]);
        rows.forEach(push);
      }
    }
  }
  return vinculos.map(r => ({
    idInternacao: S(r.id_internacao), idPaciente: S(r.id_paciente), nome: S(r.paciente_nome),
    tipoPaciente: S(r.tipo_paciente), setor: S(r.setor_nome), numeroLeito: S(r.numero_leito),
    status: S(r.status), dataHoraEntrada: U.formatarDataHoraStr(r.data_hora_entrada), diasInternado: diasDesde(r.data_hora_entrada),
    dataNascimento: U.formatarDataStr(r.data_nascimento), sexo: S(r.sexo), numeroProntuario: S(r.numero_prontuario),
    pesoNascer: S(r.peso_nascer), pesoGramas: r.peso_gramas == null ? null : Number(r.peso_gramas),
    apgar1: r.apgar_1min == null ? null : Number(r.apgar_1min), apgar5: r.apgar_5min == null ? null : Number(r.apgar_5min),
    reanimacao: S(r.reanimacao), pulseira: S(r.pulseira)
  }));
}

/* Liga dois prontuários (mãe e RN) no mesmo binômio — útil quando nascem em setores distintos
 * (mãe na UTI Materna/ALCON e RN na UTIN). Ambos precisam estar acessíveis ao usuário. */
async function vincularBinomio(ctx, dados) {
  dados = dados || {};
  const idMae = S(dados.idInternacaoMae || dados.idInternacao), idRn = S(dados.idInternacaoRn);
  if (!idMae || !idRn) throw new Error('Informe as duas internações (Mãe e RN) para vincular.');
  if (idMae === idRn) throw new Error('Selecione duas internações diferentes.');
  const A1 = await carregarInternacao(ctx, idMae);
  const A2 = await carregarInternacao(ctx, idRn);
  const bin = S(A1.id_binomio) || S(A2.id_binomio) || U.novoId('BIN');
  return transacao(async c => {
    await c.query('UPDATE internacoes SET id_binomio=$2 WHERE id_internacao=ANY($1)', [[idMae, idRn], bin]);
    await registrarLog(c, usuarioDe(ctx), 'VINCULAR_BINOMIO', `Binômio ${bin}: internação ${idMae} (${S(A1.setor_nome)}) vinculada à ${idRn} (${S(A2.setor_nome)}).`);
    return { success: true, idBinomio: bin };
  });
}

/* ---------- evolução clínica (SOAP) ---------- */
function mapaEvolucao(r) {
  return { idEvolucao: S(r.id_evolucao), idInternacao: S(r.id_internacao), idPaciente: S(r.id_paciente), setor: S(r.setor_nome),
    dataHora: U.formatarDataHoraStr(r.data_hora), categoria: S(r.categoria), profissional: S(r.profissional),
    subjetivo: S(r.subjetivo), objetivo: S(r.objetivo), avaliacao: S(r.avaliacao), plano: S(r.plano),
    registradoPor: S(r.registrado_por), versao: Number(r.versao) || 1,
    criadoEm: U.formatarDataHoraStr(r.criado_em), atualizadoEm: U.formatarDataHoraStr(r.atualizado_em),
    excluido: !!r.excluido, excluidoPor: S(r.excluido_por), excluidoEm: U.formatarDataHoraStr(r.excluido_em) };
}
async function listarEvolucoesSOAP(ctx, dados) {
  const i = await carregarInternacao(ctx, (dados || {}).idInternacao);
  // Exclusão lógica: só as evoluções ativas aparecem por padrão. Auditores podem pedir o histórico
  // completo (incluirExcluidas), preservando a rastreabilidade clínica.
  const incluir = !!(dados || {}).incluirExcluidas && A.ehAdministrador(ctx.sessao);
  const filtro = incluir ? '' : 'AND excluido = false';
  const { rows } = await query(`SELECT * FROM evolucoes_soap WHERE id_internacao=$1 ${filtro} ORDER BY data_hora DESC, criado_em DESC`, [i.id_internacao]);
  return rows.map(mapaEvolucao);
}
async function salvarEvolucaoSOAP(ctx, dados) {
  dados = dados || {};
  const i = await carregarInternacao(ctx, dados.idInternacao);
  const categoria = S(dados.categoria) || 'Médico';
  if (!R.CATEGORIAS_EVOLUCAO.some(x => U.igual(x, categoria))) throw new Error('Categoria profissional inválida.');
  const subjetivo = S(dados.subjetivo), objetivo = S(dados.objetivo), avaliacao = S(dados.avaliacao), plano = S(dados.plano);
  if (!subjetivo && !objetivo && !avaliacao && !plano) throw new Error('Preencha ao menos um campo da evolução (S, O, A ou P).');
  const dataHora = S(dados.data) ? U.montarDataHora(S(dados.data), S(dados.hora)) : new Date();
  const idEvolucao = S(dados.idEvolucao) || U.novoId('SOAP');
  const existente = S(dados.idEvolucao) ? (await query('SELECT * FROM evolucoes_soap WHERE id_evolucao=$1', [idEvolucao])).rows[0] : null;
  if (dados.idEvolucao && !existente) throw new Error('Evolução não encontrada para edição.');
  if (existente && S(existente.id_internacao) !== S(i.id_internacao)) throw new Error('Evolução não pertence a esta internação.');
  const profissional = S(dados.profissional) || usuarioDe(ctx);
  return transacao(async c => {
    if (existente) {
      const versaoAtual = Number(existente.versao) || 1;
      // Versionamento: antes de sobrescrever, o conteúdo ATUAL é arquivado em evolucoes_soap_versoes.
      // Assim a edição NUNCA apaga o que foi registrado clinicamente — todo o histórico é preservado.
      const mudouConteudo = S(existente.subjetivo) !== subjetivo || S(existente.objetivo) !== objetivo ||
        S(existente.avaliacao) !== avaliacao || S(existente.plano) !== plano;
      if (mudouConteudo) {
        await c.query(`INSERT INTO evolucoes_soap_versoes (id_versao,id_evolucao,id_internacao,id_paciente,versao,data_hora,categoria,profissional,subjetivo,objetivo,avaliacao,plano,registrado_por,arquivado_por)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [U.novoId('SOAPV'), idEvolucao, S(existente.id_internacao), S(existente.id_paciente), versaoAtual, existente.data_hora,
           S(existente.categoria), S(existente.profissional), S(existente.subjetivo), S(existente.objetivo), S(existente.avaliacao), S(existente.plano),
           S(existente.registrado_por), usuarioDe(ctx)]);
      }
      await c.query(`UPDATE evolucoes_soap SET data_hora=$2, categoria=$3, profissional=$4, subjetivo=$5, objetivo=$6, avaliacao=$7, plano=$8,
          versao=$9, atualizado_em=now() AT TIME ZONE 'America/Manaus' WHERE id_evolucao=$1`,
        [idEvolucao, dataHora, categoria, profissional, subjetivo, objetivo, avaliacao, plano, mudouConteudo ? versaoAtual + 1 : versaoAtual]);
    } else {
      await c.query(`INSERT INTO evolucoes_soap (id_evolucao,id_internacao,id_paciente,setor_nome,data_hora,categoria,profissional,subjetivo,objetivo,avaliacao,plano,registrado_por,versao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1)`,
        [idEvolucao, i.id_internacao, i.id_paciente, i.setor_nome, dataHora, categoria, profissional, subjetivo, objetivo, avaliacao, plano, usuarioDe(ctx)]);
    }
    await registrarLog(c, usuarioDe(ctx), existente ? 'EDITAR_EVOLUCAO_SOAP' : 'REGISTRAR_EVOLUCAO_SOAP',
      `Evolução (${categoria}) da internação ${i.id_internacao} / paciente ${i.id_paciente}.`);
    return { success: true, idEvolucao };
  });
}

/* Histórico de versões de uma evolução (edições anteriores), para auditoria do prontuário. */
async function listarVersoesEvolucao(ctx, dados) {
  const id = S((dados || {}).idEvolucao);
  if (!id) throw new Error('Evolução não informada.');
  const ev = (await query('SELECT * FROM evolucoes_soap WHERE id_evolucao=$1', [id])).rows[0];
  if (!ev) throw new Error('Evolução não encontrada.');
  await carregarInternacao(ctx, ev.id_internacao);   // respeita o recorte de setor do usuário
  const { rows } = await query(`SELECT * FROM evolucoes_soap_versoes WHERE id_evolucao=$1 ORDER BY versao DESC, arquivado_em DESC`, [id]);
  return {
    idEvolucao: id,
    versaoAtual: Number(ev.versao) || 1,
    atual: mapaEvolucao(ev),
    versoes: rows.map(v => ({
      idVersao: S(v.id_versao), versao: Number(v.versao) || 1, dataHora: U.formatarDataHoraStr(v.data_hora),
      categoria: S(v.categoria), profissional: S(v.profissional), subjetivo: S(v.subjetivo), objetivo: S(v.objetivo),
      avaliacao: S(v.avaliacao), plano: S(v.plano), registradoPor: S(v.registrado_por),
      arquivadoEm: U.formatarDataHoraStr(v.arquivado_em), arquivadoPor: S(v.arquivado_por)
    }))
  };
}
/* Exclusão LÓGICA: a evolução é marcada como excluída (excluido=true) e preservada para auditoria,
 * nunca removida fisicamente — protege o histórico clínico do prontuário. */
async function excluirEvolucaoSOAP(ctx, idEvolucao) {
  const id = S(idEvolucao);
  if (!id) throw new Error('Evolução não informada.');
  const ev = (await query(`SELECT e.id_internacao, i.setor_nome FROM evolucoes_soap e JOIN internacoes i ON i.id_internacao=e.id_internacao WHERE e.id_evolucao=$1`, [id])).rows[0];
  if (!ev) throw new Error('Evolução não encontrada.');
  A.exigirSetor(ctx, ev.setor_nome);
  const r = await query(`UPDATE evolucoes_soap SET excluido=true, excluido_por=$2, excluido_em=now() AT TIME ZONE 'America/Manaus'
    WHERE id_evolucao=$1 AND excluido=false RETURNING id_internacao`, [id, usuarioDe(ctx)]);
  if (!r.rowCount) throw new Error('Esta evolução já havia sido excluída.');
  await registrarLog(null, usuarioDe(ctx), 'EXCLUIR_EVOLUCAO_SOAP', `Evolução ${id} marcada como excluída (histórico preservado) — internação ${S(r.rows[0] && r.rows[0].id_internacao)}.`);
  return { success: true };
}

/* ---------- prescrições ---------- */
function mapaPrescricao(r) {
  return { idPrescricao: S(r.id_prescricao), idInternacao: S(r.id_internacao), idPaciente: S(r.id_paciente), setor: S(r.setor_nome),
    dataHora: U.formatarDataHoraStr(r.data_hora), tipo: S(r.tipo), descricao: S(r.descricao), dose: S(r.dose), via: S(r.via),
    frequencia: S(r.frequencia), status: S(r.status), profissional: S(r.profissional), observacao: S(r.observacao),
    atualizadoEm: U.formatarDataHoraStr(r.atualizado_em) };
}
async function listarPrescricoes(ctx, dados) {
  const i = await carregarInternacao(ctx, (dados || {}).idInternacao);
  const { rows } = await query('SELECT * FROM prescricoes WHERE id_internacao=$1 ORDER BY data_hora DESC, criado_em DESC', [i.id_internacao]);
  return rows.map(mapaPrescricao);
}
async function salvarPrescricao(ctx, dados) {
  dados = dados || {};
  const i = await carregarInternacao(ctx, dados.idInternacao);
  const tipo = S(dados.tipo) || 'Medicamento';
  if (!R.TIPOS_PRESCRICAO.some(x => U.igual(x, tipo))) throw new Error('Tipo de prescrição inválido.');
  const descricao = S(dados.descricao);
  if (!descricao) throw new Error('Descreva a prescrição.');
  const status = S(dados.status) || 'Ativa';
  if (!R.STATUS_PRESCRICAO.some(x => U.igual(x, status))) throw new Error('Situação da prescrição inválida.');
  const dataHora = S(dados.data) && S(dados.hora) ? U.montarDataHora(S(dados.data), S(dados.hora)) : new Date();
  const idPrescricao = S(dados.idPrescricao) || U.novoId('PRESC');
  return transacao(async c => {
    if (S(dados.idPrescricao)) {
      const ex = (await c.query('SELECT id_internacao FROM prescricoes WHERE id_prescricao=$1', [idPrescricao])).rows[0];
      if (!ex) throw new Error('Prescrição não encontrada para edição.');
      if (S(ex.id_internacao) !== S(i.id_internacao)) throw new Error('Prescrição não pertence a esta internação.');
      await c.query(`UPDATE prescricoes SET data_hora=$2, tipo=$3, descricao=$4, dose=$5, via=$6, frequencia=$7, status=$8, profissional=$9, observacao=$10, atualizado_em=now() AT TIME ZONE 'America/Manaus' WHERE id_prescricao=$1`,
        [idPrescricao, dataHora, tipo, descricao, S(dados.dose), S(dados.via), S(dados.frequencia), status, S(dados.profissional) || usuarioDe(ctx), S(dados.observacao)]);
    } else {
      await c.query(`INSERT INTO prescricoes (id_prescricao,id_internacao,id_paciente,setor_nome,data_hora,tipo,descricao,dose,via,frequencia,status,profissional,observacao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [idPrescricao, i.id_internacao, i.id_paciente, i.setor_nome, dataHora, tipo, descricao, S(dados.dose), S(dados.via), S(dados.frequencia), status, S(dados.profissional) || usuarioDe(ctx), S(dados.observacao)]);
    }
    await registrarLog(c, usuarioDe(ctx), S(dados.idPrescricao) ? 'EDITAR_PRESCRICAO' : 'REGISTRAR_PRESCRICAO',
      `Prescrição (${tipo}) da internação ${i.id_internacao} / paciente ${i.id_paciente}.`);
    return { success: true, idPrescricao };
  });
}
async function atualizarStatusPrescricao(ctx, dados) {
  dados = dados || {};
  const id = S(dados.idPrescricao), status = S(dados.status);
  if (!id) throw new Error('Prescrição não informada.');
  if (!R.STATUS_PRESCRICAO.some(x => U.igual(x, status))) throw new Error('Situação da prescrição inválida.');
  const p = (await query(`SELECT pr.id_prescricao, i.setor_nome FROM prescricoes pr JOIN internacoes i ON i.id_internacao=pr.id_internacao WHERE pr.id_prescricao=$1`, [id])).rows[0];
  if (!p) throw new Error('Prescrição não encontrada.');
  A.exigirSetor(ctx, p.setor_nome);
  await query(`UPDATE prescricoes SET status=$2, atualizado_em=now() AT TIME ZONE 'America/Manaus' WHERE id_prescricao=$1`, [id, status]);
  await registrarLog(null, usuarioDe(ctx), 'PRESCRICAO_STATUS', `Prescrição ${id} alterada para ${status}.`);
  return { success: true, status };
}

/* ---------- prontuário unificado ---------- */
async function obterProntuario(ctx, idInternacao) {
  const i = await carregarInternacao(ctx, idInternacao);
  const [binomio, evolucoes, prescricoes, movs] = await Promise.all([
    binomioDa(i),
    query('SELECT * FROM evolucoes_soap WHERE id_internacao=$1 AND excluido=false ORDER BY data_hora DESC, criado_em DESC', [i.id_internacao]).then(r => r.rows),
    query('SELECT * FROM prescricoes WHERE id_internacao=$1 ORDER BY data_hora DESC, criado_em DESC', [i.id_internacao]).then(r => r.rows),
    query(`SELECT * FROM movimentacoes WHERE id_internacao=$1 ORDER BY data_hora_saida DESC`, [i.id_internacao]).then(r => r.rows)
  ]);
  return {
    internacao: {
      idInternacao: S(i.id_internacao), idPaciente: S(i.id_paciente), nome: S(i.paciente_nome), numeroProntuario: S(i.numero_prontuario),
      dataNascimento: U.formatarDataStr(i.data_nascimento), sexo: S(i.sexo), cpf: U.somenteDigitos(i.cpf), cartaoSus: U.somenteDigitos(i.cartao_sus),
      telefone: S(i.telefone), nomeMae: S(i.nome_mae), setor: S(i.setor_nome), numeroLeito: S(i.leito_numero), status: S(i.status), statusRegulacao: S(i.status_regulacao),
      tipoPaciente: S(i.tipo_paciente), dataHoraEntrada: U.formatarDataHoraStr(i.data_hora_entrada), diasInternado: diasDesde(i.data_hora_entrada),
      procedencia: S(i.procedencia), tipoParto: S(i.tipo_parto), gravidade: S(i.gravidade), idBinomio: S(i.id_binomio),
      pesoNascer: S(i.peso_nascer), pesoGramas: i.peso_gramas == null ? null : Number(i.peso_gramas),
      apgar1: i.apgar_1min == null ? null : Number(i.apgar_1min), apgar5: i.apgar_5min == null ? null : Number(i.apgar_5min),
      reanimacao: S(i.reanimacao), pulseira: S(i.pulseira), ig: S(i.ig), horaNascimento: U.formatarHoraStr(i.hora_nascimento),
      observacaoProcedimento: S(i.observacao_procedimento)
    },
    binomio, evolucoes: evolucoes.map(mapaEvolucao), prescricoes: prescricoes.map(mapaPrescricao),
    movimentacoes: movs.map(m => ({ idMovimentacao: S(m.id_movimentacao), tipo: S(m.tipo_movimento), dataHora: U.formatarDataHoraStr(m.data_hora_saida),
      destino: S(m.destino), observacao: S(m.observacao), pesoSaidaGramas: m.peso_saida_gramas == null ? null : Number(m.peso_saida_gramas) })),
    opcoes: { categorias: R.CATEGORIAS_EVOLUCAO, tiposPrescricao: R.TIPOS_PRESCRICAO, statusPrescricao: R.STATUS_PRESCRICAO },
    geradoEm: U.formatarDataHoraStr(new Date())
  };
}

module.exports = { obterProntuario, binomioDa, vincularBinomio,
  listarEvolucoesSOAP, salvarEvolucaoSOAP, excluirEvolucaoSOAP, listarVersoesEvolucao,
  listarPrescricoes, salvarPrescricao, atualizarStatusPrescricao };
