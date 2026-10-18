/* Rota REST — proxy seguro para consulta de paciente por CPF (CADSUS / base local).
 * GET /api/cadsus?cpf=00000000000
 * O token de sessão vive em cookie HttpOnly (ou Bearer, por compatibilidade). Nenhuma credencial
 * de API externa é exposta ao front-end: toda a integração acontece no servidor (lib/cadsus.js).
 */
require('../lib/tz');
const { validarSessao } = require('../lib/auth');
const { tokenDoCookie, jsonSeguro } = require('../lib/util');
const { buscarCadsusPorCpf } = require('../lib/cadsus');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const send = (status, obj) => res.status(status).send(jsonSeguro(obj));
  if (req.method !== 'GET' && req.method !== 'POST') return send(405, { ok: false, error: 'Método não permitido.' });
  try {
    const q = req.query || {};
    const body = typeof req.body === 'string' ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {});
    const token = tokenDoCookie(req.headers.cookie);
    const sessao = await validarSessao(token);
    if (!sessao) return send(401, { ok: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
    const cpf = q.cpf || body.cpf;
    const data = await buscarCadsusPorCpf({ sessao, token }, { cpf });
    return send(200, { ok: true, data });
  } catch (e) {
    if (e && e.constructor === Error && !e.code) return send(400, { ok: false, error: e.message });
    console.error('[cadsus] erro:', e);
    return send(500, { ok: false, error: 'Erro interno ao consultar o CPF. Tente novamente.' });
  }
};
