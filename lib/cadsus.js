/* Consulta de paciente por CPF (CADSUS / base pública de saúde)
 *
 * O CADSUS/DATASUS não expõe uma API pública sem credenciais. Para não embutir chaves no
 * front-end, este módulo atua como PROXY de servidor:
 *   1) Se CADSUS_API_URL estiver configurada, consulta a fonte externa (com token de servidor);
 *   2) Em qualquer falha/ausência da fonte externa, cai para a BASE LOCAL do Natus (pacientes já
 *      cadastrados por CPF), que é a fonte mais confiável disponível na unidade.
 * O resultado é sempre normalizado em { encontrado, origem, paciente, internacaoAtiva }.
 *
 * Variáveis de ambiente (opcionais):
 *   CADSUS_API_URL     — endpoint externo; use {cpf} como placeholder (ex.: https://api.../cpf/{cpf})
 *   CADSUS_API_TOKEN   — token/credencial mantido SOMENTE no servidor (Bearer)
 *   CADSUS_TIMEOUT_MS  — tempo limite da consulta externa (padrão 6000ms)
 */
const { query } = require('./db');
const A = require('./auth');
const U = require('./util');
const S = v => String(v == null ? '' : v).trim();

const URL_CADSUS = S(process.env.CADSUS_API_URL);
const TOKEN_CADSUS = S(process.env.CADSUS_API_TOKEN);
const TIMEOUT_MS = Number(process.env.CADSUS_TIMEOUT_MS || 6000);

// Normaliza a resposta de fontes externas heterogêneas para o contrato interno do Natus.
function normalizarExterno(j) {
  const o = (j && (j.data || j.paciente || j.result || j)) || {};
  const nome = S(o.nome || o.nomeCompleto || o.nome_completo || o.name);
  const dataNascimento = S(o.dataNascimento || o.data_nascimento || o.nascimento || o.dataNasc || o.birthDate);
  const nomeMae = S(o.nomeMae || o.nome_mae || o.mae || o.filiacao && o.filiacao[0] && o.filiacao[0].nome);
  const cartaoSus = U.somenteDigitos(o.cartaoSus || o.cartao_sus || o.cns || o.cnsNumero);
  const cpf = U.somenteDigitos(o.cpf || o.numeroCpf);
  const sexo = U.upper(o.sexo || o.genero) === 'M' ? 'M' : (U.upper(o.sexo || o.genero) === 'F' ? 'F' : '');
  const encontrado = !!(nome || cpf || cartaoSus || dataNascimento);
  return encontrado ? { nome, dataNascimento: dataNascimento ? dataNascimento.substring(0, 10) : '', nomeMae, cartaoSus, cpf, sexo } : null;
}

async function consultarFonteExterna(cpf) {
  if (!URL_CADSUS) return { tentou: false, dados: null, erro: '' };
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && TIMEOUT_MS > 0 ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const url = URL_CADSUS.replace('{cpf}', encodeURIComponent(cpf));
    const headers = { 'Accept': 'application/json' };
    if (TOKEN_CADSUS) headers['Authorization'] = 'Bearer ' + TOKEN_CADSUS;
    const resp = await fetch(url, { headers, ...(ctrl ? { signal: ctrl.signal } : {}) });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    return { tentou: true, dados: normalizarExterno(j), erro: '' };
  } catch (e) {
    return { tentou: true, dados: null, erro: String(e && e.message ? e.message : e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function internacaoAtivaDe(idPaciente) {
  const { rows } = await query(`SELECT i.id_internacao AS "idInternacao", i.setor_nome AS "setor", i.numero_leito AS "numeroLeito",
      i.status_regulacao AS "statusRegulacao" FROM internacoes i
    WHERE i.id_paciente=$1 AND i.status='Ativo' ORDER BY i.data_hora_entrada DESC LIMIT 1`, [S(idPaciente)]);
  const r = rows[0];
  return r ? { idInternacao: S(r.idInternacao), setor: S(r.setor), numeroLeito: S(r.numeroLeito), statusRegulacao: S(r.statusRegulacao) } : null;
}

async function consultarBaseLocal(cpf) {
  const digitos = U.somenteDigitos(cpf);
  if (!digitos) return null;
  const { rows } = await query(`SELECT id_paciente AS "idPaciente", nome, data_nascimento AS "dataNascimento", sexo,
      numero_prontuario AS "numeroProntuario", cpf, cartao_sus AS "cartaoSus", telefone, nome_mae AS "nomeMae"
    FROM pacientes WHERE regexp_replace(cpf,'\\D','','g')=$1 LIMIT 1`, [digitos]);
  const p = rows[0];
  if (!p) return null;
  return {
    idPaciente: S(p.idPaciente), externo: false, nome: S(p.nome), dataNascimento: U.formatarDataStr(p.dataNascimento),
    sexo: S(p.sexo), numeroProntuario: S(p.numeroProntuario), cpf: U.somenteDigitos(p.cpf),
    cartaoSus: U.somenteDigitos(p.cartaoSus), telefone: S(p.telefone), nomeMae: S(p.nomeMae)
  };
}

/* Ponto de entrada único (usado pelo RPC e pela rota REST /api/cadsus). */
async function buscarCadsusPorCpf(ctx, dados) {
  A.exigirACR(ctx);                               // dado sensível: exige sessão válida
  const bruto = typeof dados === 'string' ? dados : (dados || {}).cpf;
  const cpf = U.somenteDigitos(bruto);
  if (!cpf || cpf.length !== 11) throw new Error('Informe um CPF com 11 dígitos para consultar o SUS.');
  if (!A.validarCPF(cpf)) throw new Error('CPF inválido. Confira os dígitos informados.');

  // 1) Base local (rápida e sempre disponível) — evita depender de rede externa.
  const local = await consultarBaseLocal(cpf);
  // 2) Fonte externa (quando configurada) para enriquecer/completar o cadastro.
  const externa = await consultarFonteExterna(cpf);

  let paciente = null, origem = '';
  if (local && externa.dados) {
    paciente = {
      ...local,
      nome: local.nome || externa.dados.nome,
      dataNascimento: local.dataNascimento || externa.dados.dataNascimento,
      nomeMae: local.nomeMae || externa.dados.nomeMae,
      cartaoSus: local.cartaoSus || externa.dados.cartaoSus,
      sexo: local.sexo || externa.dados.sexo
    };
    origem = 'local+cadsus';
  } else if (local) {
    paciente = local; origem = 'local';
  } else if (externa.dados) {
    paciente = { idPaciente: '', externo: true, ...externa.dados, nomeMae: externa.dados.nomeMae || '' };
    origem = 'cadsus';
  }

  const aviso = externa.tentou && externa.erro
    ? 'A base nacional (CADSUS) está indisponível no momento; usei a base interna do Natus.'
    : (externa.tentou && !externa.dados && !local ? 'Nenhum registro local; a base nacional não retornou dados para este CPF.' : '');

  if (!paciente) return { encontrado: false, origem: externa.tentou ? 'cadsus' : 'local', paciente: null, internacaoAtiva: null, aviso };
  const internacao = paciente.idPaciente ? await internacaoAtivaDe(paciente.idPaciente) : null;
  return { encontrado: true, origem, paciente, internacaoAtiva: internacao, aviso };
}

module.exports = { buscarCadsusPorCpf, consultarBaseLocal, normalizarExterno };
