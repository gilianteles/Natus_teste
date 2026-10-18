require('./tz');
const crypto = require('crypto');
const pad = (n, w = 2) => String(n).padStart(w, '0');

function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function formatarDataStr(val) {
  if (!val) return '';
  if (val instanceof Date) return fmtDate(val);
  return String(val).substring(0, 10);
}
function formatarHoraStr(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) return `${pad(val.getHours())}:${pad(val.getMinutes())}`;
  return String(val).trim();
}
function formatarDataHoraStr(val) {
  if (!val) return '';
  if (val instanceof Date) return `${pad(val.getDate())}/${pad(val.getMonth() + 1)}/${val.getFullYear()} ${pad(val.getHours())}:${pad(val.getMinutes())}`;
  return String(val).trim();
}
function paraData(val) {
  if (!val) return null;
  if (val instanceof Date) return new Date(val.getTime());
  const str = String(val).trim();
  if (!str) return null;
  const p = str.substring(0, 10).split('-');
  if (p.length === 3) return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
  const br = str.substring(0, 10).split('/');
  if (br.length === 3 && br[2].length === 4) return new Date(Number(br[2]), Number(br[1]) - 1, Number(br[0]), 12, 0, 0);
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}
function dentroDoMes(val, mes, ano) {
  const d = paraData(val);
  if (!d) return false;
  return (d.getMonth() + 1) === Number(mes) && d.getFullYear() === Number(ano);
}
function diasNoPeriodo(mes, ano) {
  const hoje = new Date();
  const ultimo = new Date(ano, mes, 0).getDate();
  const atual = (hoje.getMonth() + 1) === Number(mes) && hoje.getFullYear() === Number(ano);
  return atual ? hoje.getDate() : ultimo;
}
function chaveDia(val) {
  if (!val) return 0;
  if (val instanceof Date) return Number(`${val.getFullYear()}${pad(val.getMonth() + 1)}${pad(val.getDate())}`);
  const limpa = String(val).trim().substring(0, 10).replace(/-/g, '');
  if (limpa.length === 8 && !isNaN(limpa)) return Number(limpa);
  const d = new Date(val);
  return isNaN(d.getTime()) ? 0 : chaveDia(d);
}
const upper = v => String(v == null ? '' : v).trim().toUpperCase();
const igual = (a, b) => upper(a) === upper(b);
// Somente dígitos — usado para normalizar CPF/Cartão SUS na busca e na gravação.
const somenteDigitos = v => String(v == null ? '' : v).replace(/\D/g, '');
// Busca tolerante: remove acentos e caixa ("mae" encontra "Mãe", "cesarea" encontra "Cesárea").
const normalizar = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const contemTexto = (alvo, termo) => { const t = normalizar(termo); return !t || normalizar(alvo).indexOf(t) >= 0; };

let seq = 0;
function novoId(prefixo, sufixo) { return `${prefixo}-${Date.now()}${pad(++seq % 1000, 3)}${sufixo ? '-' + sufixo : ''}`; }
const uuid = () => crypto.randomUUID();

// "2026-10-10" + "14:30" -> 'YYYY-MM-DD HH:mm:00' (validado)
function montarDataHora(data, hora) {
  const d = String(data || '').trim(), h = String(hora || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}/.test(h)) throw new Error('Informe data e hora válidas.');
  return `${d} ${h.substring(0, 5)}:00`;
}

// Date -> texto local, para respostas JSON (nunca expõe ISO em UTC).
function jsonSeguro(obj) {
  return JSON.stringify(obj, function (k, v) {
    const raw = this[k];
    if (raw instanceof Date) return `${fmtDate(raw)}T${pad(raw.getHours())}:${pad(raw.getMinutes())}:${pad(raw.getSeconds())}`;
    return v;
  });
}

// Escapa texto para inserção segura em HTML (serve e cliente). Complementa jsonSeguro nas
// respostas que montam markup — proteção contra XSS armazenado/refletido.
function escaparHtml(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- sessão por cookie (retira o token da URL) ---------- */
const COOKIE_SESSAO = 'natus_sessao';
function lerCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(parte => {
    const i = parte.indexOf('=');
    if (i < 0) return;
    const k = parte.slice(0, i).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(parte.slice(i + 1).trim()); } catch (e) { out[k] = parte.slice(i + 1).trim(); }
  });
  return out;
}
function tokenDoCookie(header) { return lerCookies(header)[COOKIE_SESSAO] || ''; }
// Cookie de sessão HttpOnly (não acessível ao JS): o token deixa de trafegar na URL/Referer.
function cookieSessao(token, maxAgeSegundos, secure) {
  const base = `${COOKIE_SESSAO}=${encodeURIComponent(String(token || ''))}; Path=/; HttpOnly; SameSite=Lax`;
  return `${base}; Max-Age=${Math.max(0, Number(maxAgeSegundos) || 0)}${secure ? '; Secure' : ''}`;
}
function cookieLimparSessao(secure) {
  return `${COOKIE_SESSAO}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

module.exports = { pad, formatarDataStr, formatarHoraStr, formatarDataHoraStr, paraData, dentroDoMes, diasNoPeriodo, chaveDia, upper, igual, somenteDigitos, normalizar, contemTexto, novoId, uuid, montarDataHora, jsonSeguro,
  escaparHtml, COOKIE_SESSAO, lerCookies, tokenDoCookie, cookieSessao, cookieLimparSessao };
