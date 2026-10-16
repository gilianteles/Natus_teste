/* Kanban de regulação do NIR (FASE 2)
 * O quadro é sincronizado automaticamente a partir de duas fontes:
 *   1) internações ATIVAS            -> coluna "Internado / Ativo" (giram pelo fluxo)
 *   2) atendimentos pendentes do ACR -> coluna "Aguardando Avaliação" (sem leito ainda)
 * A movimentação manual do card grava a coluna escolhida e espelha o status operacional em
 * internacoes.status_regulacao, registrando tudo nos logs.
 */
const { query, transacao } = require('./db');
const { registrarLog } = require('./log');
const A = require('./auth');
const R = require('./regras');
const U = require('./util');
const S = v => String(v == null ? '' : v).trim();
const digitos = v => U.somenteDigitos(v);
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

const PRIORIDADE_POR_RISCO = { Vermelho: 'Urgente', Laranja: 'Urgente', Amarelo: 'Prioridade', Verde: 'Rotina', Azul: 'Rotina' };
const ORDEM_PRIORIDADE = { Urgente: 0, Prioridade: 1, Rotina: 2 };

async function garantirColuna(c, idCard, coluna, extra = {}) {
  await c.query(`UPDATE regulacao_cards SET coluna=$2, atualizado_em=now() AT TIME ZONE 'America/Manaus' WHERE id_card=$1`, [idCard, coluna]);
  if (extra.idInternacao) await c.query('UPDATE regulacao_cards SET id_internacao=$2 WHERE id_card=$1', [idCard, extra.idInternacao]);
}

/* Cria/atualiza os cards do quadro a partir do estado atual do banco. Nunca sobrescreve a coluna
 * escolhida manualmente (apenas liga/desliga os cards conforme a internação/atendimento). */
async function sincronizar(c, proporc = {}) {
  const ativas = (await c.query(`SELECT i.id_internacao AS "idInternacao", i.id_paciente AS "idPaciente", i.setor_nome AS "setor",
      i.numero_leito AS "numeroLeito", i.data_hora_entrada AS "dataHoraEntrada", i.procedencia, i.gravidade, i.tipo_paciente AS "tipoPaciente"
    FROM internacoes i WHERE i.status='Ativo'`)).rows;
  const acrPend = (await c.query(`SELECT a.id_paciente AS "idPaciente", a.risco, a.status, a.data_hora_entrada AS "dataHoraEntrada"
    FROM acr_atendimentos a WHERE a.status IN ('Aguardando','Em Atendimento','Encaminhado')`)).rows;
  const cards = (await c.query('SELECT id_card AS "idCard", id_paciente AS "idPaciente", id_internacao AS "idInternacao", coluna FROM regulacao_cards')).rows;

  const porInternacao = new Map(cards.filter(c => c.idInternacao).map(c => [String(c.idInternacao), c]));
  const porPacienteSemInt = new Map(cards.filter(c => !c.idInternacao).map(c => [String(c.idPaciente), c]));
  const pacientesAcrPend = new Set(acrPend.map(a => String(a.idPaciente)));
  const pacientesInternados = new Set(ativas.map(i => String(i.idPaciente)));
  let proximaOrdem = (await c.query('SELECT coalesce(max(ordem),0)::int m FROM regulacao_cards')).rows[0].m;

  // 1) Internações ativas: garante o card (aproveitando um card de ACR da mesma paciente).
  for (const i of ativas) {
    if (porInternacao.has(String(i.idInternacao))) continue;
    const doAcr = porPacienteSemInt.get(String(i.idPaciente));
    if (doAcr) {
      porPacienteSemInt.delete(String(i.idPaciente));
      porInternacao.set(String(i.idInternacao), doAcr);
      // Paciente ganhou leito: o card avança do ACR para "Internado / Ativo".
      await garantirColuna(c, doAcr.idCard, 'internado', { idInternacao: i.idInternacao });
      await registrarLog(c, usuarioDe(proporc.ctx), 'KANBAN_AUTO_INTERNAR', `Card da paciente ${S(i.idPaciente)} realocado para "Internado / Ativo" (internação ${i.idInternacao}).`);
      continue;
    }
    const idCard = U.novoId('CARD');
    proximaOrdem += 1;
    await c.query(`INSERT INTO regulacao_cards (id_card, id_paciente, id_internacao, coluna, ordem, atualizado_por)
      VALUES ($1,$2,$3,'internado',$4,$5)`, [idCard, i.idPaciente, i.idInternacao, proximaOrdem, usuarioDe(proporc.ctx)]);
    porInternacao.set(String(i.idInternacao), { idCard, idPaciente: i.idPaciente, idInternacao: i.idInternacao });
  }

  // 2) ACR pendente sem internação: garante o card em "Aguardando Avaliação".
  for (const a of acrPend) {
    const idPac = String(a.idPaciente);
    if (pacientesInternados.has(idPac) || porPacienteSemInt.has(idPac)) continue;
    const idCard = U.novoId('CARD');
    proximaOrdem += 1;
    await c.query(`INSERT INTO regulacao_cards (id_card, id_paciente, coluna, prioridade, ordem, observacao, atualizado_por)
      VALUES ($1,$2,'aguardando',$3,$4,$5,$6)`,
      [idCard, idPac, PRIORIDADE_POR_RISCO[S(a.risco)] || 'Rotina', proximaOrdem, `Origem: ACR (${S(a.risco)} / ${S(a.status)}).`, usuarioDe(proporc.ctx)]);
    porPacienteSemInt.set(idPac, { idCard, idPaciente: idPac, idInternacao: null });
  }

  // 3) Cards órfãos: internação encerrada (alta/óbito/transferência) ou ACR finalizado sem internação.
  for (const card of cards) {
    if (card.idInternacao) {
      const aindaAtiva = ativas.some(i => String(i.idInternacao) === String(card.idInternacao));
      if (!aindaAtiva) { await c.query('DELETE FROM regulacao_cards WHERE id_card=$1', [card.idCard]); }
    } else if (!pacientesAcrPend.has(String(card.idPaciente))) {
      await c.query('DELETE FROM regulacao_cards WHERE id_card=$1', [card.idCard]);
    }
  }
}

async function obterKanban(ctx, filtro) {
  A.exigirAdministrativo(ctx);
  filtro = filtro || {};
  await transacao(c => sincronizar(c, { ctx }));
  const { rows } = await query(`SELECT r.id_card AS "idCard", r.id_paciente AS "idPaciente", r.id_internacao AS "idInternacao",
      r.coluna, r.prioridade, r.ordem, r.observacao, r.responsavel, r.atualizado_por AS "atualizadoPor",
      r.atualizado_em AS "atualizadoEm", r.criado_em AS "criadoEm",
      p.nome AS "nome", p.data_nascimento AS "dataNascimento", p.cpf, p.cartao_sus AS "cartaoSus", p.telefone,
      i.setor_nome AS "setor", i.numero_leito AS "numeroLeito", i.data_hora_entrada AS "dataHoraEntrada",
      i.procedencia, i.gravidade, i.tipo_paciente AS "tipoPaciente",
      (SELECT a.risco FROM acr_atendimentos a WHERE a.id_paciente=r.id_paciente AND a.status IN ('Aguardando','Em Atendimento','Encaminhado')
         ORDER BY a.data_hora_entrada DESC LIMIT 1) AS "riscoAcr"
    FROM regulacao_cards r JOIN pacientes p ON p.id_paciente=r.id_paciente
    LEFT JOIN internacoes i ON i.id_internacao=r.id_internacao
    ORDER BY r.ordem, r.criado_em`);
  const hoje = new Date();
  const cards = rows.map(r => {
    let dias = 0;
    if (r.dataHoraEntrada instanceof Date) {
      const dt = r.dataHoraEntrada, d1 = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
      const d2 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
      dias = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
    }
    const prioridade = S(r.prioridade) || (PRIORIDADE_POR_RISCO[S(r.riscoAcr)] || 'Rotina');
    return { idCard: r.idCard, idPaciente: r.idPaciente, idInternacao: S(r.idInternacao), coluna: S(r.coluna),
      prioridade, ordem: Number(r.ordem) || 0, observacao: S(r.observacao), responsavel: S(r.responsavel),
      atualizadoPor: S(r.atualizadoPor), atualizadoEm: U.formatarDataHoraStr(r.atualizadoEm), criadoEm: U.formatarDataHoraStr(r.criadoEm),
      nome: S(r.nome), dataNascimento: U.formatarDataStr(r.dataNascimento), cpf: digitos(r.cpf), cartaoSus: digitos(r.cartaoSus), telefone: S(r.telefone),
      setor: S(r.setor), numeroLeito: S(r.numeroLeito), dataHoraEntrada: U.formatarDataHoraStr(r.dataHoraEntrada),
      procedencia: S(r.procedencia), gravidade: S(r.gravidade), tipoPaciente: S(r.tipoPaciente), riscoAcr: S(r.riscoAcr), diasInternado: dias };
  });
  const filtroTexto = U.upper(filtro.texto), filtroPrioridade = U.upper(filtro.prioridade);
  const visiveis = cards.filter(c => (!filtroTexto || U.upper(c.nome).includes(filtroTexto) || c.cpf.includes(digitos(filtroTexto)) || c.cartaoSus.includes(digitos(filtroTexto)))
    && (!filtroPrioridade || U.upper(c.prioridade) === filtroPrioridade));
  const colunas = R.COLUNAS_KANBAN.map(col => ({ id: col, titulo: R.ROTULO_COLUNA_KANBAN[col],
    cards: visiveis.filter(c => c.coluna === col).sort((a, b) => ORDEM_PRIORIDADE[a.prioridade] - ORDEM_PRIORIDADE[b.prioridade] || a.ordem - b.ordem) }));
  return { colunas, total: visiveis.length, atualizadoEm: U.formatarDataHoraStr(new Date()) };
}

async function moverCardKanban(ctx, dados) {
  A.exigirAdministrativo(ctx);
  dados = dados || {};
  const idCard = S(dados.idCard), coluna = S(dados.coluna);
  if (!idCard) throw new Error('Card não informado.');
  if (!R.COLUNAS_KANBAN.includes(coluna)) throw new Error('Coluna de destino inválida.');
  return transacao(async c => {
    const card = (await c.query('SELECT * FROM regulacao_cards WHERE id_card=$1', [idCard])).rows[0];
    if (!card) throw new Error('Card não encontrado. Atualize o quadro.');
    if (coluna === 'internado' && !S(card.id_internacao)) {
      throw new Error('Esta paciente ainda não possui leito/internação ativa. Admita-a em um leito antes de movê-la para "Internado / Ativo".');
    }
    const prioridade = dados.prioridade ? S(dados.prioridade) : S(card.prioridade);
    if (dados.prioridade && !['Rotina', 'Prioridade', 'Urgente'].some(p => U.igual(p, dados.prioridade))) throw new Error('Prioridade inválida.');
    const ordem = dados.ordem != null && !isNaN(Number(dados.ordem)) ? Number(dados.ordem) : Number(card.ordem) || 0;
    const responsavel = dados.responsavel !== undefined ? S(dados.responsavel) : S(card.responsavel);
    const observacao = dados.observacao !== undefined ? S(dados.observacao) : S(card.observacao);
    await c.query(`UPDATE regulacao_cards SET coluna=$2, prioridade=$3, ordem=$4, responsavel=$5, observacao=$6,
        atualizado_por=$7, atualizado_em=now() AT TIME ZONE 'America/Manaus' WHERE id_card=$1`,
      [idCard, coluna, prioridade, ordem, responsavel, observacao, usuarioDe(ctx)]);

    // Espelha o status operacional na internação (tempo real para o censo/painel).
    const statusRegulacao = R.STATUS_REGULACAO_POR_COLUNA[coluna] || '';
    if (S(card.id_internacao)) {
      await c.query(`UPDATE internacoes SET status_regulacao=$2 WHERE id_internacao=$1`, [card.id_internacao, statusRegulacao]);
    }
    await registrarLog(c, usuarioDe(ctx), 'KANBAN_MOVER',
      `Card ${idCard} (paciente ${S(card.id_paciente)}${S(card.id_internacao) ? ', internação ' + S(card.id_internacao) : ''}) movido de "${S(card.coluna)}" para "${coluna}"${statusRegulacao ? ` · status operacional: ${statusRegulacao}` : ''}.`);
    return { success: true, idCard, coluna, statusRegulacao };
  });
}

async function criarCardKanban(ctx, dados) {
  A.exigirAdministrativo(ctx);
  dados = dados || {};
  const idInternacao = S(dados.idInternacao), idPaciente = S(dados.idPaciente);
  const coluna = S(dados.coluna) || 'aguardando';
  if (!R.COLUNAS_KANBAN.includes(coluna)) throw new Error('Coluna inválida.');
  return transacao(async c => {
    let paciente = idPaciente;
    if (idInternacao) {
      const i = (await c.query('SELECT id_paciente FROM internacoes WHERE id_internacao=$1', [idInternacao])).rows[0];
      if (!i) throw new Error('Internação não encontrada.');
      paciente = i.id_paciente;
      if ((await c.query('SELECT 1 FROM regulacao_cards WHERE id_internacao=$1', [idInternacao])).rowCount) throw new Error('Esta internação já está no quadro Kanban.');
    }
    if (!paciente) throw new Error('Informe a paciente ou a internação do card.');
    if (coluna === 'internado' && !idInternacao) throw new Error('Para a coluna "Internado / Ativo" informe a internação ativa.');
    const ordem = (await c.query('SELECT coalesce(max(ordem),0)::int m FROM regulacao_cards')).rows[0].m + 1;
    const idCard = U.novoId('CARD');
    await c.query(`INSERT INTO regulacao_cards (id_card, id_paciente, id_internacao, coluna, prioridade, ordem, observacao, atualizado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [idCard, paciente, idInternacao || null, coluna, S(dados.prioridade) || 'Rotina', ordem, S(dados.observacao), usuarioDe(ctx)]);
    await registrarLog(c, usuarioDe(ctx), 'KANBAN_CRIAR', `Card ${idCard} criado para a paciente ${paciente} na coluna "${coluna}".`);
    return { success: true, idCard };
  });
}

async function removerCardKanban(ctx, idCard) {
  A.exigirAdministrativo(ctx);
  const id = S(idCard);
  if (!id) throw new Error('Card não informado.');
  const r = await query('DELETE FROM regulacao_cards WHERE id_card=$1 RETURNING id_paciente', [id]);
  if (!r.rowCount) throw new Error('Card não encontrado.');
  await registrarLog(null, usuarioDe(ctx), 'KANBAN_REMOVER', `Card ${id} (paciente ${S(r.rows[0].id_paciente)}) retirado do quadro Kanban.`);
  return { success: true };
}

module.exports = { obterKanban, moverCardKanban, criarCardKanban, removerCardKanban };
