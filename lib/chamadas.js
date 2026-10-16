/* FASE 6 — Painel de atendimento em tempo real (TV / recepção)
 *  - Chamada por senha + paciente + consultório/setor, exibida nas TVs da recepção;
 *  - "Chamar próxima", "Chamar novamente" e "Finalizar" para o operador autenticado;
 *  - Leitura PÚBLICA (sem login) que expõe apenas o primeiro nome do paciente (privacidade/LGPD).
 * A fila de origem é o ACR (pacientes aguardando/em atendimento). lib/acr.js continua responsável
 * pelo acolhimento; aqui apenas orquestramos a chamada.
 */
const { query, transacao } = require('./db');
const A = require('./auth');
const R = require('./regras');
const U = require('./util');
const { registrarLog } = require('./log');
const S = v => String(v == null ? '' : v).trim();
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

const LIMITE_ULTIMAS = 8;
// Ordem de prioridade de chamada por risco (Vermelho primeiro) — mesma lógica do Kanban.
const ORDEM_RISCO = { Vermelho: 0, Laranja: 1, Amarelo: 2, Verde: 3, Azul: 4 };
const PREFIXO_RISCO = { Vermelho: 'V', Laranja: 'L', Amarelo: 'A', Verde: 'G', Azul: 'Z' };

// Reduz o nome completo ao "primeiro nome + inicial" para exibição pública na TV.
function nomeExibicao(nome) {
  const partes = S(nome).split(/\s+/).filter(Boolean);
  if (!partes.length) return 'Paciente';
  if (partes.length === 1) return partes[0];
  return partes[0] + ' ' + partes[1][0].toUpperCase() + '.';
}
function hojeStr() { return U.formatarDataStr(new Date()); }

async function proximaSenha(c, risco) {
  const n = (await c.query(`SELECT count(*)::int n FROM chamadas WHERE chamado_em::date = current_date`)).rows[0].n || 0;
  const prefixo = PREFIXO_RISCO[S(risco)] || 'A';
  return prefixo + String(n + 1).padStart(3, '0');
}

function mapaChamadaPublica(r) {
  return {
    idChamada: S(r.id_chamada), senha: S(r.senha), nome: S(r.nome_exibicao),
    setor: S(r.setor), consultorio: S(r.consultorio), destino: S(r.destino),
    tipo: S(r.tipo), repeticoes: Number(r.repeticoes) || 1, chamadoEm: U.formatarDataHoraStr(r.chamado_em)
  };
}
function mapaChamadaInterna(r) {
  return {
    idChamada: S(r.id_chamada), idPaciente: S(r.id_paciente), idAtendimento: S(r.id_atendimento),
    senha: S(r.senha), nome: S(r.nome_completo || r.nome_exibicao), setor: S(r.setor), consultorio: S(r.consultorio),
    destino: S(r.destino), tipo: S(r.tipo), status: S(r.status), repeticoes: Number(r.repeticoes) || 1,
    chamadoEm: U.formatarDataHoraStr(r.chamado_em), chamadoPor: S(r.chamado_por)
  };
}

/* Leitura PÚBLICA do painel (TV). Não expõe nome completo nem dados clínicos. */
async function obterPainelChamadas(ctx, filtro) {
  filtro = filtro || {};
  const setor = S(filtro.setor);
  const where = setor ? `AND upper(setor)=upper($1)` : '';
  const params = setor ? [setor] : [];
  const { rows } = await query(`SELECT * FROM chamadas WHERE status='Ativa' ${where} ORDER BY chamado_em DESC LIMIT ${LIMITE_ULTIMAS + 1}`, params);
  const atual = rows[0] ? mapaChamadaPublica(rows[0]) : null;
  const ultimas = rows.slice(1).map(mapaChamadaPublica);
  return { atual, ultimas, geradoEm: U.formatarDataHoraStr(new Date()) };
}

/* Fila de chamada para o console do operador (autenticado): quem está aguardando no ACR. */
async function listarFilaChamada(ctx) {
  A.exigirACR(ctx);
  const { rows } = await query(`SELECT a.id_atendimento AS "idAtendimento", a.id_paciente AS "idPaciente", p.nome, p.cpf,
      a.risco, a.status, a.destino, a.queixa, a.data_hora_entrada AS "dataHoraEntrada"
    FROM acr_atendimentos a JOIN pacientes p ON p.id_paciente=a.id_paciente
    WHERE a.data_hora_entrada::date = current_date AND a.status IN ('Aguardando','Em Atendimento')
    ORDER BY a.data_hora_entrada`);
  const agora = Date.now();
  const fila = rows.map(r => ({
    idAtendimento: S(r.idAtendimento), idPaciente: S(r.idPaciente), nome: S(r.nome),
    risco: S(r.risco), status: S(r.status), destino: S(r.destino), queixa: S(r.queixa),
    minutosEspera: r.dataHoraEntrada instanceof Date ? Math.max(0, Math.round((agora - r.dataHoraEntrada.getTime()) / 60000)) : 0
  })).sort((a, b) => (ORDEM_RISCO[a.risco] ?? 9) - (ORDEM_RISCO[b.risco] ?? 9) || b.minutosEspera - a.minutosEspera);
  const recentes = (await query(`SELECT * FROM chamadas WHERE chamado_em::date = current_date ORDER BY chamado_em DESC LIMIT 20`))
    .rows.map(mapaChamadaInterna);
  return { fila, recentes };
}

async function encerrarAtivas(c, manterId) {
  await c.query(`UPDATE chamadas SET status='Atendida' WHERE status='Ativa' AND id_chamada<>$1`, [S(manterId) || '']);
}

/* "Chamar próxima": escolhe o próximo da fila do ACR (ou o atendimento informado) e o coloca no ar. */
async function chamarProximo(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  return transacao(async c => {
    let at = null;
    if (S(dados.idAtendimento)) {
      at = (await c.query(`SELECT a.*, p.nome FROM acr_atendimentos a JOIN pacientes p ON p.id_paciente=a.id_paciente
        WHERE a.id_atendimento=$1`, [S(dados.idAtendimento)])).rows[0];
      if (!at) throw new Error('Atendimento do ACR não encontrado.');
    } else {
      const { rows } = await c.query(`SELECT a.*, p.nome FROM acr_atendimentos a JOIN pacientes p ON p.id_paciente=a.id_paciente
        WHERE a.data_hora_entrada::date = current_date AND a.status IN ('Aguardando','Em Atendimento')
        ORDER BY a.data_hora_entrada`);
      at = rows.sort((x, y) => (ORDEM_RISCO[S(x.risco)] ?? 9) - (ORDEM_RISCO[S(y.risco)] ?? 9))[0];
      if (!at) throw new Error('Nenhum paciente aguardando na fila do ACR neste momento.');
    }
    const setor = S(dados.setor) || S(at.destino) || 'Recepção';
    const consultorio = S(dados.consultorio) || S(at.destino);
    const senha = S(dados.senha) || await proximaSenha(c, at.risco);
    const idChamada = U.novoId('CHAM');
    await encerrarAtivas(c, idChamada);
    await c.query(`INSERT INTO chamadas (id_chamada,id_paciente,id_atendimento,senha,nome_exibicao,nome_completo,setor,consultorio,destino,tipo,status,repeticoes,chamado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Ativa',1,$11)`,
      [idChamada, S(at.id_paciente), S(at.id_atendimento), senha, nomeExibicao(at.nome), S(at.nome), setor, consultorio, S(at.destino),
       S(dados.tipo) || 'Chamada', usuarioDe(ctx)]);
    await c.query(`UPDATE acr_atendimentos SET status='Em Atendimento' WHERE id_atendimento=$1 AND status='Aguardando'`, [S(at.id_atendimento)]);
    await registrarLog(c, usuarioDe(ctx), 'CHAMAR_PACIENTE', `Chamada ${senha} (${S(at.nome)}) para ${setor}${consultorio ? ' / ' + consultorio : ''}.`);
    return { success: true, idChamada, senha };
  });
}

/* Chamada avulsa (paciente fora do ACR, ex.: retorno ou chamada manual com dados informados). */
async function chamarPaciente(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  const nome = S(dados.nome);
  if (!nome) throw new Error('Informe o paciente a ser chamado.');
  const setor = S(dados.setor) || 'Recepção';
  return transacao(async c => {
    const idChamada = U.novoId('CHAM');
    const senha = S(dados.senha) || await proximaSenha(c, dados.risco);
    await encerrarAtivas(c, idChamada);
    await c.query(`INSERT INTO chamadas (id_chamada,id_paciente,id_atendimento,senha,nome_exibicao,nome_completo,setor,consultorio,destino,tipo,status,repeticoes,chamado_por)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Ativa',1,$11)`,
      [idChamada, S(dados.idPaciente), S(dados.idAtendimento), senha, nomeExibicao(nome), nome, setor,
       S(dados.consultorio), S(dados.destino), S(dados.tipo) || 'Chamada', usuarioDe(ctx)]);
    await registrarLog(c, usuarioDe(ctx), 'CHAMAR_PACIENTE', `Chamada avulsa ${senha} (${nome}) para ${setor}.`);
    return { success: true, idChamada, senha };
  });
}

/* "Chamar novamente": repõe a chamada no ar e incrementa o contador de repetições. */
async function rechamar(ctx, dados) {
  A.exigirACR(ctx);
  const id = S((dados || {}).idChamada);
  if (!id) throw new Error('Chamada não informada.');
  return transacao(async c => {
    const ch = (await c.query('SELECT * FROM chamadas WHERE id_chamada=$1', [id])).rows[0];
    if (!ch) throw new Error('Chamada não encontrada.');
    await encerrarAtivas(c, id);
    await c.query(`UPDATE chamadas SET status='Ativa', repeticoes=repeticoes+1,
        chamado_em=now() AT TIME ZONE 'America/Manaus', chamado_por=$2 WHERE id_chamada=$1`, [id, usuarioDe(ctx)]);
    await registrarLog(c, usuarioDe(ctx), 'RECHAMAR_PACIENTE', `Chamada ${S(ch.senha)} (${S(ch.nome_completo)}) repetida.`);
    return { success: true, idChamada: id };
  });
}

async function finalizarChamada(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  const id = S(dados.idChamada);
  const status = S(dados.status) || 'Atendida';
  if (!id) throw new Error('Chamada não informada.');
  if (!['Atendida', 'Cancelada'].includes(status)) throw new Error('Situação de chamada inválida.');
  const r = await query(`UPDATE chamadas SET status=$2 WHERE id_chamada=$1 RETURNING senha`, [id, status]);
  if (!r.rowCount) throw new Error('Chamada não encontrada.');
  await registrarLog(null, usuarioDe(ctx), 'FINALIZAR_CHAMADA', `Chamada ${S(r.rows[0].senha)} finalizada como ${status}.`);
  return { success: true };
}

module.exports = { obterPainelChamadas, listarFilaChamada, chamarProximo, chamarPaciente, rechamar, finalizarChamada,
  nomeExibicao, mapaChamadaInterna };
