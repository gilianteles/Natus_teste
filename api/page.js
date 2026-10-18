require('../lib/tz');
const fs = require('fs');
const path = require('path');
const { validarSessao } = require('../lib/auth');
const { ehPerfilNIR, ehPerfilAdministrativo, ehPerfilAdministrador } = require('../lib/regras');
const SEC = require('../lib/http-security');
const shell = require('../lib/shell');

const VIEWS = path.join(process.cwd(), 'views');
const cache = {};
const carregar = n => (cache[n] = cache[n] || fs.readFileSync(path.join(VIEWS, n + '.html'), 'utf8'));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TITULOS = { login: 'Natus - Login', nir: 'Natus - Painel NIR/SAME', dashboardgeral: 'Dashboard Geral - Natus', historico: 'Natus - Histórico de Pacientes',
  acr: 'Natus - ACR (Acolhimento e Classificação de Risco)', kanban: 'Natus - Kanban de Regulação (NIR)',
  prontuario: 'Natus - Prontuário Eletrônico (PEP)', bi: 'Natus - Indicadores e BI Gerencial',
  chamada: 'Natus - Painel de Atendimento (TV)' };

const ATIVO = { painel: 'painel', dashboard: 'dashboard', nir: 'nir', historico: 'historico', dashboardgeral: 'dashboardgeral', acr: 'acr', kanban: 'kanban', prontuario: 'prontuario', bi: 'bi' };
// Scripts adicionais por tela (servidos de /public com cache-busting por data de modificação).
const EXTRA = { painel: 'natus-painel.js', acr: 'natus-acr.js', kanban: 'natus-kanban.js', prontuario: 'natus-prontuario.js', bi: 'natus-bi.js', chamada: 'natus-chamada.js' };

/* Placeholders dos views: <!--@head-->, <!--@rail-->, <!--@useractions-->; e as variáveis <?!= nome ?>. */
function render(nome, vars, titulo, ctx) {
  let html = carregar(nome);
  html = html.replace(/src="\/natus-rpc\.js"/g, 'src="/natus-rpc.js?v=20261018-leitos"');
  const arquivo = EXTRA[nome];
  const extra = arquivo ? `\n  <script defer src="/${arquivo}?v=${shell.versao(arquivo)}"></script>` : '';
  html = html.replace('<!--@head-->', () => shell.head(extra));
  if (ctx) {
    html = html.replace('<!--@rail-->', () => shell.rail({ ativo: ATIVO[nome], token: vars.token, adm: ctx.adm, nir: ctx.nir, admin: ctx.admin, setor: vars.setorParam || (ctx.nir ? 'UTIN 1' : ctx.setor), nome: vars.nomeUsuario }));
    html = html.replace('<!--@useractions-->', () => shell.userActions({ nome: vars.nomeUsuario, perfil: vars.perfilUsuario, setor: ctx.nir ? '' : ctx.setor }));
  }
  // Valores dentro de scripts exigem escape JavaScript, não entidades HTML.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, bloco => bloco.replace(/<\?!=\s*(\w+)\s*\?>/g,
    (_, k) => JSON.stringify(String(vars[k] == null ? '' : vars[k])).slice(1, -1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/'/g, '\\u0027').replace(/`/g, '\\u0060').replace(/\$/g, '\\u0024')));
  html = html.replace(/<\?!=\s*(\w+)\s*\?>/g, (_, k) => esc(vars[k]));
  html = html.replace('</head>', `<meta name="natus-csrf" content="${esc(vars.csrf || '')}"></head>`);
  if (titulo) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(titulo)}</title>`);
  return html;
}

// Cabeçalhos de segurança. A CSP restringe origens, plugins e enquadramento; 'unsafe-inline' é
// necessário porque as telas usam handlers inline e bibliotecas de CDN (Bootstrap/Chart.js).
const CSP_APP = ["default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com data:",
  "img-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'",
  "frame-ancestors 'self'", "form-action 'self'"].join('; ');
const CSP_TV = CSP_APP.replace("frame-ancestors 'self'", "frame-ancestors *");

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP_APP);
  try {
    const q = req.query || {};
    // Links antigos não autenticam; remove o segredo da barra de endereço.
    if (Object.prototype.hasOwnProperty.call(q, 'token')) {
      const limpa = new URLSearchParams();
      for (const k of ['view','setor','id']) if (typeof q[k] === 'string') limpa.set(k,q[k]);
      res.setHeader('Location', '/?' + limpa.toString());
      return res.status(303).send('');
    }
    const view = String(q.view || ''), token = SEC.lerToken(req);
    const sessao = token ? await validarSessao(token) : null;
    const appUrl = '/';

    // Painel de atendimento (TV/recepção): leitura PÚBLICA — exibe apenas o primeiro nome e o
    // consultório. O console do operador só aparece para usuários autenticados.
    if (view === 'chamada') {
      res.setHeader('Content-Security-Policy', CSP_TV);
      res.setHeader('X-Frame-Options', 'ALLOWALL');
      return res.send(render('chamada', {
        appUrl,
        token: '', csrf: sessao ? SEC.csrfToken(token) : '',
        autenticado: sessao ? '1' : '',
        nomeOperador: sessao ? sessao.nome : '',
        setorUsuario: sessao ? (sessao.setor || '') : ''
      }, TITULOS.chamada, null));
    }
    if (!sessao) return res.status(200).send(render('login', { appUrl }));

    const base = { token: '', csrf: SEC.csrfToken(token), cacheScope: SEC.csrfToken(token).slice(0, 24), appUrl, nomeUsuario: sessao.nome, perfilUsuario: sessao.perfil, setorUsuario: sessao.setor || '' };
    const adm = ehPerfilAdministrativo(sessao.perfil), nir = ehPerfilNIR(sessao.perfil);
    const admin = ehPerfilAdministrador(sessao.perfil) || sessao.administrador === true;   // FASE 3: gestão de usuários
    const setorDe = padrao => (nir ? (String(q.setor || padrao).trim() || padrao) : sessao.setor);
    const ctx = { adm, nir, admin, setor: sessao.setor || '' };
    const painel = setor => res.send(render('painel', { ...base, setorParam: setor }, `Natus - ${setor}`, ctx));

    if (view === 'dashboard') { const s = setorDe('UTIN 1'); return res.send(render('dashboard', { ...base, setorParam: s }, `Natus - Dashboard - ${s}`, ctx)); }
    if (view === 'painel') return painel(setorDe('UTIN 1'));
    // ACR: tela de acolhimento/admissão, aberta a qualquer colaborador autenticado.
    if (view === 'acr') return res.send(render('acr', base, TITULOS.acr, ctx));
    // Kanban de regulação: restrito aos perfis de gestão (NIR/SAME/GESTÃO/Administrador).
    if (view === 'kanban') return adm ? res.send(render('kanban', base, TITULOS.kanban, ctx)) : painel(sessao.setor);
    if (view === 'nir' || view === 'usuarios') return adm ? res.send(render('nir', base, TITULOS.nir, ctx)) : painel(sessao.setor);
    if (view === 'historico') return res.send(render('historico', base, TITULOS.historico, ctx));
    if (view === 'dashboardgeral') return adm ? res.send(render('dashboardgeral', base, TITULOS.dashboardgeral, ctx)) : painel(sessao.setor);
    // FASE 4 — Prontuário Eletrônico (PEP): aberto a qualquer colaborador autenticado; o acesso ao
    // prontuário de cada internação é recortado por setor no servidor (lib/clinica.js).
    if (view === 'prontuario') return res.send(render('prontuario', { ...base, idInternacao: String(q.id || '') }, TITULOS.prontuario, ctx));
    // FASE 5 — BI gerencial: restrito aos perfis de gestão.
    if (view === 'bi') return adm ? res.send(render('bi', base, TITULOS.bi, ctx)) : painel(sessao.setor);
    if (adm && !q.setor) return res.send(render('nir', base, TITULOS.nir, ctx));
    return painel(adm ? (String(q.setor || 'UTIN 1').trim() || 'UTIN 1') : sessao.setor);
  } catch (e) {
    console.error('[page] erro:', e);
    res.status(500).send('<h3>Erro interno. Tente novamente em instantes.</h3>');
  }
};
