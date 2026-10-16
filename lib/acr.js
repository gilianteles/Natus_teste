/* ACR — Acolhimento com Classificação de Risco (FASE 1)
 * Porta de entrada da maternidade: localiza a paciente por CPF/Cartão SUS (evitando cadastro
 * duplicado), registra o atendimento de acolhimento e a classificação de risco.
 */
const { query, transacao } = require('./db');
const { registrarLog } = require('./log');
const A = require('./auth');
const R = require('./regras');
const U = require('./util');
const S = v => String(v == null ? '' : v).trim();
const N = v => (S(v) === '' ? null : S(v));           // '' -> NULL
const digitos = v => U.somenteDigitos(v);
const usuarioDe = ctx => (ctx.sessao && ctx.sessao.nome) || 'Operador';

const DADOS_PACIENTE = `SELECT id_paciente AS "idPaciente", nome AS "nome", data_nascimento AS "dataNascimento",
  sexo AS "sexo", numero_prontuario AS "numeroProntuario", cpf AS "cpf", cartao_sus AS "cartaoSus", telefone AS "telefone",
  nome_mae AS "nomeMae"
  FROM pacientes`;

function formatarPaciente(p) {
  if (!p) return null;
  return { idPaciente: p.idPaciente, nome: S(p.nome), dataNascimento: U.formatarDataStr(p.dataNascimento),
    sexo: S(p.sexo), numeroProntuario: S(p.numeroProntuario), cpf: digitos(p.cpf), cartaoSus: digitos(p.cartaoSus), telefone: S(p.telefone), nomeMae: S(p.nomeMae) };
}

async function internacaoAtivaDe(idPaciente) {
  const { rows } = await query(`SELECT i.id_internacao AS "idInternacao", i.setor_nome AS "setor", i.numero_leito AS "numeroLeito",
      i.data_hora_entrada AS "dataHoraEntrada"
    FROM internacoes i WHERE i.id_paciente=$1 AND i.status='Ativo' ORDER BY i.data_hora_entrada DESC LIMIT 1`, [S(idPaciente)]);
  const r = rows[0];
  return r ? { idInternacao: r.idInternacao, setor: S(r.setor), numeroLeito: S(r.numeroLeito), dataHoraEntrada: U.formatarDataStr(r.dataHoraEntrada) } : null;
}

/* ---------- FASE 1: busca rápida por CPF / Cartão SUS ---------- */
async function buscarPacientePorDocumento(ctx, dados) {
  let tipo = '', doc = '';
  if (typeof dados === 'string') { doc = digitos(dados); tipo = doc.length === 11 ? 'cpf' : (doc.length === 15 ? 'sus' : ''); }
  else { dados = dados || {}; tipo = U.upper(dados.tipo); doc = digitos(dados.documento || dados.cpf || dados.cartaoSus); }
  if (!doc) throw new Error('Informe o CPF ou o Cartão SUS para a busca.');
  if (tipo && !['CPF', 'SUS', 'CARTAO_SUS', 'CARTAOSUS'].includes(tipo)) throw new Error('Tipo de documento inválido.');
  const porCpf = !tipo || tipo === 'CPF';
  if (porCpf && doc.length !== 11) tipo = 'SUS';
  if (tipo === 'SUS' && (doc.length < 11 || doc.length > 20)) throw new Error('Cartão SUS inválido.');

  const campo = porCpf ? 'regexp_replace(cpf,\'\\D\',\'\',\'g\')' : 'regexp_replace(cartao_sus,\'\\D\',\'\',\'g\')';
  const { rows } = await query(`${DADOS_PACIENTE} WHERE ${campo} = $1 ORDER BY nome LIMIT 1`, [doc]);
  if (!rows[0]) return { encontrado: false, paciente: null, internacaoAtiva: null, atendimentoACR: null };
  const paciente = formatarPaciente(rows[0]);
  const internacao = await internacaoAtivaDe(paciente.idPaciente);
  const acr = (await query(`SELECT id_atendimento AS "idAtendimento", risco, status, destino, data_hora_entrada AS "dataHoraEntrada"
    FROM acr_atendimentos WHERE id_paciente=$1 AND status IN ('Aguardando','Em Atendimento') ORDER BY data_hora_entrada DESC LIMIT 1`, [paciente.idPaciente])).rows[0];
  return { encontrado: true, paciente, internacaoAtiva: internacao,
    atendimentoACR: acr ? { idAtendimento: acr.idAtendimento, risco: S(acr.risco), status: S(acr.status), destino: S(acr.destino),
      dataHoraEntrada: U.formatarDataHoraStr(acr.dataHoraEntrada) } : null };
}

/* ---------- ACR: registro do atendimento ---------- */
function agora() {
  const d = new Date(), p = U.pad;
  return { data: U.formatarDataStr(d), hora: `${p(d.getHours())}:${p(d.getMinutes())}` };
}

async function garantirPaciente(c, ctx, dados) {
  const idInformado = S(dados.idPaciente);
  const cpf = digitos(dados.cpf);
  const sus = digitos(dados.cartaoSus);
  const nome = S(dados.nome);
  if (!nome) throw new Error('Informe o nome da paciente.');
  if (cpf && !A.validarCPF(cpf)) throw new Error('CPF inválido.');
  if (sus && !A.validarCartaoSUS(sus)) throw new Error('Cartão SUS inválido.');

  let idPaciente = idInformado;
  if (!idPaciente && (cpf || sus)) {
    const campo = cpf ? `regexp_replace(cpf,'\\D','','g')=$1` : `regexp_replace(cartao_sus,'\\D','','g')=$1`;
    const existente = (await c.query(`SELECT id_paciente FROM pacientes WHERE ${campo} LIMIT 1`, [cpf || sus])).rows[0];
    if (existente) idPaciente = existente.id_paciente;
  }

  const sexo = U.upper(dados.sexo) === 'M' ? 'M' : 'F';
  if (idPaciente) {
    const atual = (await c.query('SELECT id_paciente, cpf, cartao_sus, telefone FROM pacientes WHERE id_paciente=$1', [idPaciente])).rows[0];
    if (!atual) throw new Error('Paciente não encontrado.');
    // Completa/atualiza os documentos sem apagar o que já existia.
    await c.query(`UPDATE pacientes SET nome=$2, data_nascimento=coalesce($3,data_nascimento), sexo=coalesce($4,sexo),
        numero_prontuario=coalesce(nullif($5,''),numero_prontuario), cpf=coalesce(nullif($6,''),cpf),
        cartao_sus=coalesce(nullif($7,''),cartao_sus), telefone=coalesce(nullif($8,''),telefone),
        nome_mae=coalesce(nullif($9,''),nome_mae)
      WHERE id_paciente=$1`,
      [idPaciente, nome, N(dados.dataNascimento), dados.sexo ? sexo : null, S(dados.numeroProntuario), cpf, sus, S(dados.telefone), S(dados.nomeMae)]);
    return idPaciente;
  }

  idPaciente = U.novoId('PAC');
  await c.query(`INSERT INTO pacientes (id_paciente, nome, data_nascimento, sexo, numero_prontuario, cpf, cartao_sus, telefone, nome_mae)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [idPaciente, nome, N(dados.dataNascimento), sexo, S(dados.numeroProntuario), cpf, sus, S(dados.telefone), S(dados.nomeMae)]);
  return idPaciente;
}

async function registrarAtendimentoACR(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  const risco = S(dados.risco) || 'Azul';
  if (!R.RISCOS_ACR.some(r => U.igual(r, risco))) throw new Error('Classificação de risco inválida.');
  const agora2 = agora();
  const entrada = dados.data && dados.hora ? U.montarDataHora(dados.data, dados.hora) : `${agora2.data} ${agora2.hora}:00`;

  return transacao(async c => {
    const idPaciente = await garantirPaciente(c, ctx, dados);
    const idAtendimento = U.novoId('ACR');
    await c.query(`INSERT INTO acr_atendimentos (id_atendimento, id_paciente, setor_nome, queixa, risco, status, destino, observacao, registrado_por, data_hora_entrada)
      VALUES ($1,$2,$3,$4,$5,'Aguardando',$6,$7,$8,$9)`,
      [idAtendimento, idPaciente, R.SETOR_ACR, S(dados.queixa), risco, S(dados.destino), S(dados.observacao), usuarioDe(ctx), entrada]);
    await registrarLog(c, usuarioDe(ctx), 'ACR_ATENDIMENTO',
      `Atendimento ACR ${idAtendimento}: paciente ${S(dados.nome)} (ID ${idPaciente}), risco ${risco}, entrada ${entrada}.`);
    return { success: true, idAtendimento, idPaciente };
  });
}

async function atualizarAtendimentoACR(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  const id = S(dados.idAtendimento);
  if (!id) throw new Error('Atendimento não informado.');
  return transacao(async c => {
    const at = (await c.query('SELECT * FROM acr_atendimentos WHERE id_atendimento=$1', [id])).rows[0];
    if (!at) throw new Error('Atendimento do ACR não encontrado.');
    const risco = S(dados.risco) || S(at.risco);
    const status = S(dados.status) || S(at.status);
    if (!R.RISCOS_ACR.some(r => U.igual(r, risco))) throw new Error('Classificação de risco inválida.');
    if (!R.STATUS_ATENDIMENTO_ACR.some(s => U.igual(s, status))) throw new Error('Status do atendimento inválido.');
    const destino = dados.destino !== undefined ? S(dados.destino) : S(at.destino);
    const observacao = dados.observacao !== undefined ? S(dados.observacao) : S(at.observacao);
    const idInternacao = dados.idInternacao !== undefined ? N(dados.idInternacao) : at.id_internacao;
    await c.query(`UPDATE acr_atendimentos SET risco=$2, status=$3, destino=$4, observacao=$5, id_internacao=$6 WHERE id_atendimento=$1`,
      [id, risco, status, destino, observacao, idInternacao]);
    await registrarLog(c, 'Sistema', 'ACR_ATUALIZAR', `Atendimento ACR ${id} (${S(at.id_paciente)}) atualizado para risco ${risco} / status ${status}${destino ? ' / destino ' + destino : ''}.`);
    return { success: true };
  });
}

async function listarAtendimentosACR(ctx, dados) {
  A.exigirACR(ctx);
  dados = dados || {};
  const data = S(dados.data);
  const where = data ? `AND a.data_hora_entrada::date = $1` : '';
  const params = data ? [data] : [];
  const { rows } = await query(`SELECT a.id_atendimento AS "idAtendimento", a.id_paciente AS "idPaciente", p.nome AS "nome",
      p.data_nascimento AS "dataNascimento", p.cpf AS "cpf", p.cartao_sus AS "cartaoSus", p.telefone AS "telefone",
      a.queixa, a.risco, a.status, a.destino, a.observacao, a.registrado_por AS "registradoPor",
      a.data_hora_entrada AS "dataHoraEntrada", a.id_internacao AS "idInternacao",
      (SELECT i.setor_nome FROM internacoes i WHERE i.id_internacao=a.id_internacao) AS "setorInternacao",
      (SELECT i.numero_leito FROM internacoes i WHERE i.id_internacao=a.id_internacao) AS "leitoInternacao"
    FROM acr_atendimentos a JOIN pacientes p ON p.id_paciente=a.id_paciente
    WHERE 1=1 ${where} ORDER BY a.data_hora_entrada DESC LIMIT 500`, params);
  const agoraMs = Date.now();
  return rows.map(r => ({
    idAtendimento: r.idAtendimento, idPaciente: r.idPaciente, nome: S(r.nome), dataNascimento: U.formatarDataStr(r.dataNascimento),
    cpf: digitos(r.cpf), cartaoSus: digitos(r.cartaoSus), telefone: S(r.telefone), queixa: S(r.queixa), risco: S(r.risco),
    status: S(r.status), destino: S(r.destino), observacao: S(r.observacao), registradoPor: S(r.registradoPor),
    dataHoraEntrada: U.formatarDataHoraStr(r.dataHoraEntrada), idInternacao: S(r.idInternacao),
    setorInternacao: S(r.setorInternacao), leitoInternacao: S(r.leitoInternacao),
    minutosEspera: r.dataHoraEntrada instanceof Date ? Math.max(0, Math.round((agoraMs - r.dataHoraEntrada.getTime()) / 60000)) : 0
  }));
}

async function obterResumoACR(ctx, data) {
  A.exigirACR(ctx);
  const dia = S(data) || U.formatarDataStr(new Date());
  const { rows } = await query(`SELECT risco, status, count(*)::int n FROM acr_atendimentos
    WHERE data_hora_entrada::date = $1 GROUP BY risco, status`, [dia]);
  const porRisco = {}; R.RISCOS_ACR.forEach(r => (porRisco[r] = 0));
  const porStatus = {}; R.STATUS_ATENDIMENTO_ACR.forEach(s => (porStatus[s] = 0));
  let total = 0;
  rows.forEach(r => { porRisco[r.risco] = (porRisco[r.risco] || 0) + r.n; porStatus[r.status] = (porStatus[r.status] || 0) + r.n; total += r.n; });
  return { data: dia, total, porRisco, porStatus };
}

module.exports = { buscarPacientePorDocumento, registrarAtendimentoACR, atualizarAtendimentoACR, listarAtendimentosACR, obterResumoACR };
