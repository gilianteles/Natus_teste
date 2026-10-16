/* Gráficos do Painel Operacional: tendência de ocupação (mês) e distribuição dos leitos. */
(function () {
  'use strict';
  var cache = {};            // setor -> { t, porDia }
  var ultimo = null;         // último "data" do painel (para redesenhar ao trocar de tema)
  var chTend = null, chStatus = null;
  var TTL = 5 * 60 * 1000;
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  var v = function (n) { return NatusUI.cor(n); };
  var el = function (id) { return document.getElementById(id); };

  function contar(leitos) {
    var c = { Livre: 0, Ocupado: 0, Reservado: 0, Bloqueado: 0 };
    (leitos || []).forEach(function (l) {
      var s = String(l.Status || '').trim();
      if (s === 'Reserva') s = 'Reservado';
      if (c[s] !== undefined) c[s]++;
    });
    return c;
  }

  function desenharStatus(leitos) {
    var cv = el('ntChartStatus');
    if (!cv || !window.Chart) return;
    var c = contar(leitos), total = (leitos || []).length;
    var itens = [['Livres', c.Livre, v('ok')], ['Ocupados', c.Ocupado, v('bad')], ['Reservados', c.Reservado, v('warn')], ['Bloqueados', c.Bloqueado, v('slate')]];
    if (chStatus) chStatus.destroy();
    chStatus = new Chart(cv, {
      type: 'doughnut',
      data: { labels: itens.map(function (i) { return i[0]; }), datasets: [{ data: itens.map(function (i) { return i[1]; }), backgroundColor: itens.map(function (i) { return i[2]; }), borderColor: v('card'), borderWidth: 3, hoverOffset: 6 }] },
      options: { maintainAspectRatio: false, cutout: '74%', plugins: { legend: { display: false } }, animation: { duration: 500 } }
    });
    var ocupados = c.Ocupado;
    el('ntDonutValor').textContent = total ? Math.round(ocupados / total * 100) + '%' : '—';
    var leg = el('ntLegendaStatus');
    if (leg) leg.innerHTML = itens.map(function (i) { return '<span><i style="background:' + i[2] + '"></i>' + i[0] + ' <b>' + i[1] + '</b></span>'; }).join('');
    var p = el('ntPillLeitos'); if (p) p.textContent = total + (total === 1 ? ' leito' : ' leitos');
  }

  function desenharTendencia(porDia, totalLeitos) {
    var cv = el('ntChartTendencia');
    if (!cv || !window.Chart) return;
    var ctx = cv.getContext('2d');
    var cap = totalLeitos > 0 ? totalLeitos : null;
    var pontos = (porDia || []).map(function (d) { return { dia: d.dia, n: Number(d.ocupacao) || 0 }; });
    var hoje = new Date().getDate();
    pontos = pontos.filter(function (p) { return p.dia <= hoje; });
    var valores = pontos.map(function (p) { return cap ? Math.round(p.n / cap * 1000) / 10 : p.n; });
    var media = valores.length ? valores.reduce(function (a, b) { return a + b; }, 0) / valores.length : 0;
    var pill = el('ntPillMedia');
    if (pill) pill.textContent = 'Média ' + (cap ? media.toFixed(1) + '%' : media.toFixed(1) + ' pac./dia');
    var vazio = el('ntTendenciaVazio');
    if (vazio) vazio.classList.toggle('d-none', pontos.length > 0);

    var cor = v('primary');
    var g = ctx.createLinearGradient(0, 0, 0, cv.clientHeight || 230);
    g.addColorStop(0, cor + '55'); g.addColorStop(1, cor + '00');
    if (chTend) chTend.destroy();
    chTend = new Chart(cv, {
      type: 'line',
      data: {
        labels: pontos.map(function (p) { return p.dia; }),
        datasets: [{
          label: cap ? 'Ocupação (%)' : 'Pacientes', data: valores, borderColor: cor, backgroundColor: g, fill: true, cubicInterpolationMode: 'monotone',
          pointBackgroundColor: v('card'), pointBorderColor: cor, pointBorderWidth: 2, pointHoverRadius: 6
        }].concat(cap ? [{ label: 'Capacidade', data: valores.map(function () { return 100; }), borderColor: v('muted'), borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false }] : [])
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10 }, title: { display: false } },
          y: { beginAtZero: true, suggestedMax: cap ? 100 : undefined, border: { display: false }, grid: { color: v('chart-grid') }, ticks: { callback: function (x) { return cap ? x + '%' : x; }, maxTicksLimit: 5 } }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: function (it) { return 'Dia ' + it[0].label; },
            label: function (it) {
              if (it.datasetIndex) return null;
              var n = pontos[it.dataIndex].n;
              return cap ? ' ' + it.formattedValue + '%  ·  ' + n + (n === 1 ? ' paciente' : ' pacientes') : ' ' + n + ' pacientes';
            }
          } }
        }
      }
    });
  }

  function carregarTendencia(setor, totalLeitos) {
    var hit = cache[setor];
    if (hit && Date.now() - hit.t < TTL) { desenharTendencia(hit.porDia, totalLeitos); return; }
    var d = new Date();
    var rot = el('ntTendenciaMes'); if (rot) rot.textContent = MESES[d.getMonth()] + ' de ' + d.getFullYear();
    google.script.run
      .withSuccessHandler(function (est) {
        cache[setor] = { t: Date.now(), porDia: (est && est.porDia) || [] };
        if (ultimo && String(ultimo.setorAtual).toUpperCase() === String(setor).toUpperCase()) desenharTendencia(cache[setor].porDia, totalLeitos);
      })
      .withFailureHandler(function () { var m = el('ntTendenciaVazio'); if (m) { m.textContent = 'Não foi possível carregar a tendência.'; m.classList.remove('d-none'); } })
      .obterEstatisticasDashboard(setor, d.getMonth() + 1, d.getFullYear());
  }

  window.natusAtualizarGraficos = function (data) {
    try {
      ultimo = data;
      var total = (data.leitos || []).length;
      desenharStatus(data.leitos);
      carregarTendencia(data.setorAtual, total);
    } catch (e) { console.error('Gráficos do painel:', e); }
  };

  document.addEventListener('natus:theme', function () {
    if (!ultimo) return;
    desenharStatus(ultimo.leitos);
    var hit = cache[ultimo.setorAtual];
    if (hit) desenharTendencia(hit.porDia, (ultimo.leitos || []).length);
  });
})();
