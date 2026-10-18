/* Natus UI — tema claro/escuro, tema dos gráficos e comportamento do trilho lateral. */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'natus-theme';

  function cssVar(n) { return getComputedStyle(root).getPropertyValue(n).trim(); }
  function temaAtual() { return root.dataset.theme === 'dark' ? 'dark' : 'light'; }

  /* ---------- Gráficos (Chart.js) ---------- */
  function aplicarTemaCharts() {
    var C = window.Chart;
    if (!C) return;
    var d = C.defaults;
    d.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    d.font.weight = 500;
    d.color = cssVar('--muted');
    d.borderColor = cssVar('--chart-grid');
    d.plugins.legend.labels.usePointStyle = true;
    d.plugins.legend.labels.boxWidth = 8;
    d.plugins.legend.labels.boxHeight = 8;
    d.plugins.legend.labels.padding = 16;
    d.plugins.legend.labels.color = cssVar('--text-2');
    var t = d.plugins.tooltip;
    t.backgroundColor = cssVar('--text');
    t.titleColor = cssVar('--bg');
    t.bodyColor = cssVar('--bg');
    t.cornerRadius = 12;
    t.padding = 12;
    t.boxPadding = 5;
    t.usePointStyle = true;
    d.elements.line.tension = 0.35;
    d.elements.line.borderWidth = 2.5;
    d.elements.point.radius = 0;
    d.elements.point.hoverRadius = 5;
    d.elements.bar.borderRadius = 8;
    d.elements.bar.borderSkipped = false;
    d.elements.arc.borderWidth = 0;
    d.elements.arc.borderColor = cssVar('--card');
    d.elements.line.cubicInterpolationMode = 'monotone';
    if (d.scale && d.scale.grid) d.scale.grid.drawTicks = false;
    if (d.scale && d.scale.border) d.scale.border.display = false;
    try { d.set('scales.category', { grid: { display: false } }); } catch (e) {}
    try { d.set('datasets.doughnut', { cutout: '68%', spacing: 2 }); } catch (e) {}
    try { if (C.overrides && C.overrides.doughnut) C.overrides.doughnut.cutout = '68%'; } catch (e) {}
  }
  function atualizarChartsExistentes() {
    var C = window.Chart;
    if (!C || !C.instances) return;
    Object.keys(C.instances).forEach(function (id) {
      var ch = C.instances[id];
      try {
        var o = ch.options;
        if (o.scales) Object.keys(o.scales).forEach(function (k) {
          var s = o.scales[k];
          if (s.grid) s.grid.color = cssVar('--chart-grid');
          if (s.ticks) s.ticks.color = cssVar('--muted');
        });
        if (o.plugins && o.plugins.legend && o.plugins.legend.labels) o.plugins.legend.labels.color = cssVar('--text-2');
        ch.update('none');
      } catch (e) { /* gráfico já destruído */ }
    });
  }

  /* ---------- Tema ---------- */
  function definirTema(t, salvar) {
    root.dataset.theme = t;
    root.setAttribute('data-bs-theme', t);
    if (salvar) { try { localStorage.setItem(KEY, t); } catch (e) {} }
    document.querySelectorAll('[data-natus-theme-toggle]').forEach(function (b) {
      var i = b.querySelector('i');
      if (i) i.className = 'bi ' + (t === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill');
      b.setAttribute('aria-label', t === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro');
      if (b.hasAttribute('data-label')) b.setAttribute('data-label', t === 'dark' ? 'Modo claro' : 'Modo escuro');
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cssVar('--bg') || '#F4F5F7');
    aplicarTemaCharts();
    atualizarChartsExistentes();
    document.dispatchEvent(new CustomEvent('natus:theme', { detail: { theme: t } }));
  }
  function alternarTema() { definirTema(temaAtual() === 'dark' ? 'light' : 'dark', true); }

  // Segue o sistema operacional enquanto o usuário não escolher manualmente.
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
      if (!localStorage.getItem(KEY)) definirTema(e.matches ? 'dark' : 'light', false);
    });
  } catch (e) {}

  /* ---------- Logout / navegação ---------- */
  function tokenAtual() {
    try { if (typeof token !== 'undefined' && token) return token; } catch (e) {}
    return new URLSearchParams(location.search).get('token') || '';
  }
  function sairPadrao() {
    try { sessionStorage.clear(); } catch (e) {}
    var fim = function () { window.top.location.href = '/?view=login'; };
    if (window.google && google.script && google.script.run) {
      google.script.run.withSuccessHandler(fim).withFailureHandler(fim).encerrarSessao(tokenAtual());
    } else fim();
  }
  function setorCorrente() {
    try { if (typeof setorAtualParam !== 'undefined' && setorAtualParam) return setorAtualParam; } catch (e) {}
    try { if (typeof setorAtual !== 'undefined' && setorAtual) return setorAtual; } catch (e) {}
    return new URLSearchParams(location.search).get('setor') || '';
  }

  function iniciarRail() {
    document.querySelectorAll('[data-natus-theme-toggle]').forEach(function (b) { b.addEventListener('click', alternarTema); });
    document.querySelectorAll('[data-natus-logout]').forEach(function (b) {
      b.addEventListener('click', function () { (typeof window.sair === 'function' ? window.sair : sairPadrao)(); });
    });
    // Links que carregam o setor atualmente selecionado (troca de setor é feita sem recarregar a página).
    document.querySelectorAll('a[data-nav-setor]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        var s = setorCorrente();
        if (!s) return;
        var u = new URL(a.href, location.origin);
        u.searchParams.set('setor', s);
        a.href = u.pathname + u.search;
      });
    });
    // Ações da página (ex.: "Novo setor", "Usuários" no NIR): chamam a função global se existir.
    document.querySelectorAll('[data-natus-act]').forEach(function (b) {
      b.addEventListener('click', function () { var f = window[b.getAttribute('data-natus-act')]; if (typeof f === 'function') f(); });
    });
    // Barra de progresso do cartão principal acompanha o texto "NN%".
    var kpi = document.getElementById('kpi-taxa');
    if (kpi && kpi.closest('.nt-kpi')) {
      var card = kpi.closest('.nt-kpi');
      var atualizar = function () { var n = parseFloat(String(kpi.textContent).replace(',', '.')); card.style.setProperty('--pct', (isNaN(n) ? 0 : Math.max(0, Math.min(100, n))) + '%'); };
      new MutationObserver(atualizar).observe(kpi, { childList: true, characterData: true, subtree: true });
      atualizar();
    }
  }

  /* ---------- Barra lateral retrátil (alternada ao clicar na logo) ---------- */
  var SIDEBAR_KEY = 'natus_sidebar_collapsed';
  var RAIL_SEL = '.nt-rail, .sidebar, #sidebar';

  function sidebarEl() { return document.querySelector(RAIL_SEL); }
  function ehDesktop() {
    try { return !window.matchMedia || window.matchMedia('(min-width: 992px)').matches; } catch (e) { return true; }
  }
  function alcaRestaurar() {
    var b = document.getElementById('ntSidebarRestore');
    if (b) return b;
    b = document.createElement('button');
    b.type = 'button';
    b.id = 'ntSidebarRestore';
    b.className = 'nt-rail-restore';
    b.setAttribute('aria-label', 'Mostrar o menu lateral');
    b.setAttribute('title', 'Mostrar o menu lateral');
    b.innerHTML = '<i class="bi bi-layout-sidebar-inset"></i>';
    b.addEventListener('click', function () { toggleSidebarState(); });
    (document.body || document.documentElement).appendChild(b);
    return b;
  }
  // Aplica o estado recolhido (classe global no body + classe no trilho). No mobile o trilho é
  // uma barra inferior: o recolhimento não se aplica.
  function applySidebarState(collapsed) {
    collapsed = !!collapsed && ehDesktop();
    var r = sidebarEl();
    if (r) r.classList.toggle('collapsed', collapsed);
    if (document.body) document.body.classList.toggle('sidebar-collapsed', collapsed);
    var b = document.getElementById('ntSidebarRestore');
    if (collapsed) { b = alcaRestaurar(); b.classList.add('show'); }
    else if (b) b.classList.remove('show');
    return collapsed;
  }
  function toggleSidebarState() {
    var recolhido = !(document.body && document.body.classList.contains('sidebar-collapsed'));
    var aplicado = applySidebarState(recolhido);
    try { localStorage.setItem(SIDEBAR_KEY, aplicado ? 'true' : 'false'); } catch (e) {}
    return aplicado;
  }
  function iniciarSidebar() {
    var r = sidebarEl();
    if (!r) return;
    var logo = document.getElementById('btnToggleSidebar') || r.querySelector('.nt-rail-brand');
    if (logo) {
      logo.style.cursor = 'pointer';
      // preventDefault evita redirecionamento caso a logo vire um link estático.
      logo.addEventListener('click', function (e) { if (e && e.preventDefault) e.preventDefault(); toggleSidebarState(); });
      logo.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 32) {
          if (e.preventDefault) e.preventDefault();
          toggleSidebarState();
        }
      });
    }
    try { if (localStorage.getItem(SIDEBAR_KEY) === 'true') applySidebarState(true); } catch (e) {}
    // Ao voltar para o desktop, restaura a preferência salva; no mobile mantém o trilho normal.
    try {
      var mq = window.matchMedia('(min-width: 992px)');
      var aoMudar = function () { applySidebarState(localStorage.getItem(SIDEBAR_KEY) === 'true'); };
      if (mq.addEventListener) mq.addEventListener('change', aoMudar);
      else if (mq.addListener) mq.addListener(aoMudar);
    } catch (e) {}
  }

  /* ---------- Visibilidade dinâmica do menu por perfil ---------- */
  // Aplica a personalização (Configurações) a qualquer item marcado com data-modulo. A regra
  // apenas OCULTA/mostra botões; a segurança das rotas permanece no servidor.
  function aplicarVisibilidadeMenu(permissoes) {
    if (!Array.isArray(permissoes)) return;
    var mapa = {};
    permissoes.forEach(function (item) {
      if (!item) return;
      var chave = item.modulo_chave != null ? item.modulo_chave : item.chave;
      if (chave) mapa[String(chave)] = item.visivel === true || item.visivel === 'true';
    });
    document.querySelectorAll('[data-modulo]').forEach(function (el) {
      var chave = el.getAttribute('data-modulo');
      var visivel = mapa[chave];
      var oculto = visivel === false;
      el.style.display = oculto ? 'none' : '';
      el.classList.toggle('nt-menu-hidden', oculto);
      el.setAttribute('aria-hidden', oculto ? 'true' : 'false');
    });
  }

  window.NatusUI = {
    alternarTema: alternarTema, definirTema: definirTema, temaAtual: temaAtual, sair: sairPadrao,
    alternarSidebar: toggleSidebarState, aplicarSidebarState: applySidebarState, aplicarVisibilidadeMenu: aplicarVisibilidadeMenu,
    cor: function (n) { return cssVar('--' + n); }
  };
  // API global pedida pela especificação de UX (usada também pelas telas que já a referenciam).
  window.toggleSidebarState = toggleSidebarState;
  window.applySidebarState = applySidebarState;
  window.aplicarVisibilidadeMenu = aplicarVisibilidadeMenu;

  function pronto() { definirTema(temaAtual(), false); iniciarRail(); iniciarSidebar(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pronto); else pronto();
})();
