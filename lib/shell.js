// Peças compartilhadas da interface: <head> (fonte, tema, CSS) e trilho lateral por perfil.
const fs = require('fs');
const path = require('path');
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ver = f => { try { return Math.floor(fs.statSync(path.join(process.cwd(), 'public', f)).mtimeMs / 1000).toString(36); } catch (e) { return '1'; } };

// Aplica o tema salvo (ou o do sistema) antes da primeira pintura, evitando "flash" de tema errado.
const TEMA_INICIAL = `<script>(function(){try{var t=localStorage.getItem('natus-theme');if(t!=='dark'&&t!=='light')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var d=document.documentElement;d.dataset.theme=t;d.setAttribute('data-bs-theme',t);}catch(e){}})();</script>`;

function head(extraScripts) {
  return `
  <script src="/natus-escape.js?v=${ver('natus-escape.js')}"></script>
  <meta name="theme-color" content="#F4F5F7">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  ${TEMA_INICIAL}
  <link rel="stylesheet" href="/natus-ui.css?v=${ver('natus-ui.css')}">
  <link rel="stylesheet" href="/natus-modulos.css?v=${ver('natus-modulos.css')}">
  <script defer src="/natus-ui.js?v=${ver('natus-ui.js')}"></script>${extraScripts || ''}
`;
}

function iniciais(nome) {
  const p = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/* ativo: painel | dashboard | dashboardgeral | nir | kanban | acr | bi | prontuario | historico */
function rail({ ativo, token, adm, nir, admin, setor, nome }) {
  // O token só é propagado em links quando a sessão ainda trafega por URL (compatibilidade);
  // com a sessão por cookie (padrão), os links ficam limpos, sem token.
  const s = encodeURIComponent(setor || '');
  const item = (key, icon, label, href, extra) =>
    `<a class="nt-ico${ativo === key ? ' active' : ''}" href="${href}" data-label="${esc(label)}" aria-label="${esc(label)}"${ativo === key ? ' aria-current="page"' : ''}${extra || ''}><i class="bi ${icon}"></i></a>`;
  const act = (fn, icon, label) => `<button type="button" class="nt-ico" data-natus-act="${fn}" data-label="${esc(label)}" aria-label="${esc(label)}"><i class="bi ${icon}"></i></button>`;

  const nav = [
    item('painel', 'bi-hospital', 'Censo de leitos', `/?view=painel&setor=${s}`, ' data-nav-setor'),
    item('dashboard', 'bi-graph-up-arrow', 'Dashboard do setor', `/?view=dashboard&setor=${s}`, ' data-nav-setor'),
    // FASE 1: acolhimento com classificação de risco (recepção/admissão).
    item('acr', 'bi-clipboard2-pulse', 'ACR — Acolhimento e classificação de risco', `/?view=acr`),
    // FASE 6: painel de chamadas (TV da recepção) — abertura pública; o console do operador aparece ao entrar.
    item('chamada', 'bi-tv', 'Painel de chamadas (TV)', `/?view=chamada`)
  ];
  if (adm) nav.push(item('dashboardgeral', 'bi-bar-chart-line', 'Dashboard geral', `/?view=dashboardgeral`));
  if (adm) nav.push(item('nir', 'bi-diagram-3', 'Painel NIR', `/?view=nir`));
  // FASE 2: Kanban de regulação (NIR).
  if (adm) nav.push(item('kanban', 'bi-kanban', 'Kanban de Regulação (NIR)', `/?view=kanban`));
  // FASE 5: BI gerencial (indicadores de qualidade, giro de leitos e higienização).
  if (adm) nav.push(item('bi', 'bi-speedometer2', 'Indicadores e BI gerencial', `/?view=bi`));
  nav.push(item('historico', 'bi-clock-history', 'Histórico de pacientes', `/?view=historico`));
  if (adm && ativo === 'nir') {
    nav.push('<span class="nt-rail-sep"></span>', act('abrirNovoSetor', 'bi-building-add', 'Novo setor'));
    // FASE 3: apenas Administrador cadastra/gerencia usuários.
    if (admin) nav.push(act('abrirUsuarios', 'bi-people', 'Usuários e acessos'));
  }
  if (ativo === 'kanban') nav.push('<span class="nt-rail-sep"></span>', act('abrirFormKanban', 'bi-person-plus', 'Novo card no Kanban'));
  if (ativo === 'acr') nav.push('<span class="nt-rail-sep"></span>', act('focarBuscaACR', 'bi-search', 'Buscar por CPF/Cartão SUS'));
  return `
<aside class="nt-rail" aria-label="Navegação principal">
  <div class="nt-rail-brand" title="Natus"><img src="/assets/img-e02cd94544.png" alt="Natus"></div>
  <nav class="nt-rail-nav">${nav.join('')}</nav>
  <div class="nt-rail-foot">
    <button type="button" class="nt-ico" data-natus-theme-toggle data-label="Modo escuro" aria-label="Alternar tema"><i class="bi bi-moon-stars-fill"></i></button>
    <button type="button" class="nt-ico" data-natus-logout data-label="Sair" aria-label="Sair"><i class="bi bi-box-arrow-right"></i></button>
    <div class="nt-avatar" title="${esc(nome)}">${esc(iniciais(nome))}</div>
  </div>
</aside>`;
}

function userActions({ nome, perfil, setor }) {
  return `<div class="nt-user"><b>${esc(nome)}</b><span>${esc(perfil)}${setor ? ' · ' + esc(setor) : ''}</span></div>
      <button type="button" class="nt-iconbtn" data-natus-theme-toggle aria-label="Alternar tema"><i class="bi bi-moon-stars-fill"></i></button>
      <button type="button" class="nt-iconbtn" data-natus-logout aria-label="Sair"><i class="bi bi-box-arrow-right"></i></button>`;
}

module.exports = { head, rail, userActions, esc, versao: ver };
