require('../../lib/tz');
const { FUNCOES, PUBLICAS, mensagemSegura } = require('../../lib/rpc');
const { validarSessao, SESSAO_HORAS } = require('../../lib/auth');
const { jsonSeguro } = require('../../lib/util');
const SEC = require('../../lib/http-security');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const enviar = (status, obj) => res.status(status).send(jsonSeguro(obj));
  if (req.method !== 'POST') return enviar(405, { ok: false, error: 'Método não permitido.' });
  const nome = String((req.query && req.query.fn) || '');
  const fn = Object.prototype.hasOwnProperty.call(FUNCOES, nome) ? FUNCOES[nome] : null;
  if (!fn) return enviar(404, { ok: false, error: 'Função não encontrada.' });
  // Sessão preferencialmente por cookie HttpOnly; o Bearer na URL/header é aceito só por compatibilidade.
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || process.env.VERCEL === '1';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const args = Array.isArray(body.args) ? body.args : [];
    const token = SEC.lerToken(req);
    if (nome !== 'obterPainelChamadas' && !SEC.origemValida(req)) return enviar(403, { ok:false, error:'Origem da solicitação inválida.' });
    if (!PUBLICAS.has(nome) && !SEC.csrfValido(req, token)) return enviar(403, { ok:false, error:'Atualize a página e tente novamente.' });
    const sessao = PUBLICAS.has(nome) ? null : await validarSessao(token);
    if (!PUBLICAS.has(nome) && !sessao) return enviar(401, { ok: false, error: 'Sessão inválida ou expirada. Faça login novamente.' });
    // encerrarSessao recebe o token do próprio cabeçalho/cookie
    const a = nome === 'encerrarSessao' ? [token] : args;
    const data = await fn({ sessao, token }, ...a);
    // Segurança: ao autenticar, o token passa a viver em cookie HttpOnly (SomeSite=Lax); ao sair, é limpo.
    if (nome === 'autenticar' && data && data.token) { SEC.definirCookie(res, data.token, req); delete data.token; data.success = true; }
    if (nome === 'encerrarSessao') SEC.definirCookie(res, '', req);
    return enviar(200, { ok: true, data: data === undefined ? null : data });
  } catch (e) {
    const { status, msg } = mensagemSegura(e);
    return enviar(status, { ok: false, error: msg });
  }
};
