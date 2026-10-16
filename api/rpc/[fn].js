require('../../lib/tz');
const { FUNCOES, PUBLICAS, mensagemSegura } = require('../../lib/rpc');
const { validarSessao } = require('../../lib/auth');
const { jsonSeguro } = require('../../lib/util');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const enviar = (status, obj) => res.status(status).send(jsonSeguro(obj));
  if (req.method !== 'POST') return enviar(405, { ok: false, error: 'Método não permitido.' });
  const nome = String((req.query && req.query.fn) || '');
  const fn = Object.prototype.hasOwnProperty.call(FUNCOES, nome) ? FUNCOES[nome] : null;
  if (!fn) return enviar(404, { ok: false, error: 'Função não encontrada.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const args = Array.isArray(body.args) ? body.args : [];
    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    const sessao = PUBLICAS.has(nome) ? null : await validarSessao(token);
    if (!PUBLICAS.has(nome) && !sessao) return enviar(401, { ok: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
    // encerrarSessao recebe o token do próprio cabeçalho
    const a = nome === 'encerrarSessao' ? [token] : args;
    const data = await fn({ sessao, token }, ...a);
    return enviar(200, { ok: true, data: data === undefined ? null : data });
  } catch (e) {
    const { status, msg } = mensagemSegura(e);
    return enviar(status, { ok: false, error: msg });
  }
};
