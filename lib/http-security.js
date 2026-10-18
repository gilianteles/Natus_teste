const crypto = require('crypto');
const COOKIE = require('./util').COOKIE_SESSAO;
const hashToken = token => 'sha256$' + crypto.createHash('sha256').update(String(token)).digest('hex');
const csrfToken = token => crypto.createHash('sha256').update('natus-csrf:' + String(token)).digest('hex');
function lerToken(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  const found = cookies.find(c => c.trim().startsWith(COOKIE + '='));
  if (!found) return '';
  try { return decodeURIComponent(found.trim().slice(COOKIE.length + 1)); } catch (_) { return ''; }
}
function definirCookie(res, token, req) {
  const secure = process.env.NODE_ENV === 'production' || !!process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
  const maxAge = token ? Math.floor(Number(process.env.SESSION_HOURS || 12) * 3600) : 0;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}
function origemValida(req) {
  try {
    const origin = new URL(String(req.headers.origin || ''));
    const protocol = process.env.NODE_ENV === 'production' || process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
    return origin.protocol === protocol && origin.host === req.headers.host && req.headers['x-natus-request'] === '1';
  } catch (_) { return false; }
}
function csrfValido(req, token) {
  const atual = Buffer.from(String(req.headers['x-natus-csrf'] || ''));
  const esperado = Buffer.from(csrfToken(token));
  return !!token && atual.length === esperado.length && crypto.timingSafeEqual(atual, esperado);
}
module.exports = { lerToken, definirCookie, origemValida, csrfValido, csrfToken, hashToken };
