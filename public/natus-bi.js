/* FASE 5 — Indicadores de Qualidade e BI Gerencial
 * Consome obterIndicadoresGerenciais e apresenta ocupação, TMP, perfil de partos, giro de leitos,
 * higienização pendente e alertas críticos, com exportação CSV (relatório de auditoria). */
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var dados = null, chSetores = null, chPartos = null;
  var CORES = { bad: '#E5484D', warn: '#F5A524', ok: '#30A46C', info: '#3B82F6', slate: '#8B8D98', primary: '#E11D48' };

  function toast(msg, tipo) {
    var host = el('biToasts'); if (!host) { alert(msg); return; }
    var cores = { ok: 'text-bg-success', erro: 'text-bg-danger', info: 'text-bg-secondary' };
    var div = document.createElement('div');
    div.className = 'toast align-items-center ' + (cores[tipo] || cores.info) + ' border-0';
    div.innerHTML = '<div class="d-flex"><div class="toast-body">' + esc(msg) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    host.appendChild(div); new bootstrap.Toast(div, { delay: 4500 }).show();
    div.addEventListener('hidden.bs.toast', function () { div.remove(); });
  }
  function pct(v) { return (Math.round((Number(v) || 0) * 10) / 10).toFixed(1) + '%'; }
  function hoje() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function primeiroDiaMes() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-01'; }

  function carregarSetores() {
    var sel = el('biSetor'); if (!sel || sel.dataset.carregado) return;
    sel.dataset.carregado = '1';
    google.script.run.withSuccessHandler(function (setores) {
      sel.innerHTML = '<option value="TODOS">Todos os setores</option>' + (setores || []).map(function (s) { var nome = (s && s.Nome_Setor) ? s.Nome_Setor : s; return '<option value="' + esc(nome) + '">' + esc(nome) + '</option>'; }).join('');
    }).withFailureHandler(function () { /* mantém apenas TODOS */ }).obterSetores();
  }

  function carregarBI() {
    if (!el('biIni').value) el('biIni').value = primeiroDiaMes();
    if (!el('biFim').value) el('biFim').value = hoje();
    var filtro = { dataInicial: el('biIni').value, dataFinal: el('biFim').value, setor: el('biSetor').value || 'TODOS' };
    el('biSync').textContent = 'Carregando...';
    google.script.run.withSuccessHandler(function (d) { dados = d; render(d); })
      .withFailureHandler(function (e) { el('biSync').textContent = 'Falha'; toast(e && e.message ? e.message : 'Falha ao carregar os indicadores.', 'erro'); })
      .obterIndicadoresGerenciais(filtro);
  }

  function render(d) {
    el('biSync').textContent = 'Atualizado ' + (d.geradoEm || '');
    el('biOcupAtual').textContent = pct(d.ocupacao.atual.taxa);
    el('biOcupAtualSub').textContent = d.ocupacao.atual.ocupados + '/' + d.ocupacao.atual.totalLeitos + ' leitos ocupados';
    el('biOcupMedia').textContent = pct(d.ocupacao.mediaPeriodo);
    el('biOcupMediaSub').textContent = d.periodo.dias + ' dia(s) no período';
    el('biTmp').textContent = (Number(d.permanencia.tmp) || 0).toFixed(1) + ' d';
    el('biTmpSub').textContent = d.permanencia.saidas + ' desfecho(s) considerados';
    el('biPartoNormal').textContent = pct(d.partos.percNormal);
    el('biPartoSub').textContent = 'Cesáreas: ' + pct(d.partos.percCesarea) + ' (' + d.partos.total + ' partos)';

    // Alertas
    var cores = { critico: 'danger', atencao: 'warning', info: 'info' };
    el('biAlertas').innerHTML = (d.alertas && d.alertas.length)
      ? d.alertas.map(function (a) {
          return '<div class="alert alert-' + (cores[a.nivel] || 'info') + ' py-2 px-3 mb-2 d-flex align-items-center gap-2">' +
            '<i class="bi ' + (a.nivel === 'critico' ? 'bi-exclamation-octagon-fill' : (a.nivel === 'atencao' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill')) + '"></i>' +
            '<div><b>' + esc(a.titulo) + '</b> <span class="small">' + esc(a.detalhe) + '</span></div></div>';
        }).join('')
      : '<div class="alert alert-success py-2 px-3 mb-2"><i class="bi bi-check-circle-fill me-1"></i>Nenhum alerta crítico no momento.</div>';

    // Giro / higienização
    el('biGiro').innerHTML =
      kpiMini('Taxa de giro (saídas/leito)', (Number(d.movimentacao.taxaGiro) || 0).toFixed(2)) +
      kpiMini('Leitos em higienização', d.higienizacao.pendentes, d.higienizacao.pendentes > 0 ? 'warn' : 'ok') +
      kpiMini('Leitos disponíveis', d.ocupacao.atual.livres, 'ok') +
      kpiMini('Leitos bloqueados', d.ocupacao.atual.bloqueados, d.ocupacao.atual.bloqueados > 0 ? 'slate' : 'ok');

    el('biMov').innerHTML =
      kpiMini('Admissões', d.movimentacao.admissoes, 'info') +
      kpiMini('Altas', d.movimentacao.altas, 'ok') +
      kpiMini('Transferências', d.movimentacao.transferencias, 'slate') +
      kpiMini('Óbitos', d.movimentacao.obitos, d.movimentacao.obitos > 0 ? 'bad' : 'ok') +
      kpiMini('Evasões', d.movimentacao.evasoes, d.movimentacao.evasoes > 0 ? 'warn' : 'ok') +
      kpiMini('Total de saídas', d.movimentacao.totalSaidas, 'slate');

    // Tabela de setores
    el('biTabelaSetores').innerHTML = (d.ocupacao.porSetor || []).map(function (s) {
      var cor = s.taxa >= 100 ? 'text-bg-danger' : (s.taxa >= 90 ? 'text-bg-warning' : 'text-bg-success');
      return '<tr><td class="fw-semibold">' + esc(s.setor) + '</td><td class="text-end">' + s.total + '</td><td class="text-end">' + s.ocupados + '</td>' +
        '<td class="text-end">' + (s.higienizacao || 0) + '</td><td class="text-end"><span class="badge ' + cor + '">' + pct(s.taxa) + '</span></td></tr>';
    }).join('') || '<tr><td colspan="5" class="text-muted">Sem setores cadastrados.</td></tr>';

    // Higienização pendente (alerta operacional)
    el('biHigienizacao').innerHTML = (d.higienizacao && d.higienizacao.leitos && d.higienizacao.leitos.length)
      ? '<div class="bi-higienizacao-box"><div class="bi-card-titulo"><i class="bi bi-stars me-1"></i>Higienização pendente (' + d.higienizacao.pendentes + ')</div>' +
        '<div class="d-flex flex-wrap gap-2 mt-2">' + d.higienizacao.leitos.map(function (l) { return '<span class="badge text-bg-warning"><i class="bi bi-brush me-1"></i>' + esc(l.setor) + ' · ' + esc(l.numeroLeito) + '</span>'; }).join('') + '</div></div>'
      : '';

    desenharSetores(d.ocupacao.porSetor || []);
    desenharPartos(d.partos);
  }

  function kpiMini(rotulo, valor, tom) {
    var bg = tom === 'bad' ? 'background:' + CORES.bad : tom === 'warn' ? 'background:' + CORES.warn : tom === 'ok' ? 'background:' + CORES.ok : tom === 'info' ? 'background:' + CORES.info : 'background:' + CORES.slate;
    return '<div class="bi-mini"><span class="bi-mini-dot" style="' + bg + '"></span><span class="bi-mini-rot">' + esc(rotulo) + '</span><b class="bi-mini-val">' + esc(valor) + '</b></div>';
  }

  function desenharSetores(lista) {
    var cv = el('biChartSetores'); if (!cv || !window.Chart) return;
    if (chSetores) chSetores.destroy();
    chSetores = new Chart(cv, {
      type: 'bar',
      data: { labels: lista.map(function (s) { return s.setor; }),
        datasets: [{ label: 'Taxa de ocupação (%)', data: lista.map(function (s) { return s.taxa; }),
          backgroundColor: lista.map(function (s) { return s.taxa >= 90 ? CORES.bad : (s.taxa >= 70 ? CORES.warn : CORES.ok); }), borderRadius: 6 }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: function (v) { return v + '%'; } }, grid: { color: 'rgba(0,0,0,.06)' } }, x: { grid: { display: false } } } }
    });
  }
  function desenharPartos(p) {
    var cv = el('biChartPartos'); if (!cv || !window.Chart) return;
    if (chPartos) chPartos.destroy();
    var labels = ['Normais', 'Cesáreas', 'Fórceps'];
    var vals = [p.normal, p.cesarea, p.forceps];
    chPartos = new Chart(cv, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: vals, backgroundColor: [CORES.ok, CORES.warn, CORES.info], borderWidth: 3, borderColor: '#fff' }] },
      options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } }
    });
  }

  function biExportarCSV() {
    if (!dados) { toast('Nada para exportar ainda.', 'erro'); return; }
    var d = dados, q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var linhas = [];
    linhas.push(['Relatório gerencial Natus - Indicadores de qualidade'].map(q).join(';'));
    linhas.push(['Período', d.periodo.dataInicial + ' a ' + d.periodo.dataFinal, 'Setor', d.setor, 'Gerado em', d.geradoEm].map(q).join(';'));
    linhas.push([]);
    linhas.push(['Indicador', 'Valor'].map(q).join(';'));
    linhas.push(['Taxa de ocupação atual', pct(d.ocupacao.atual.taxa)].map(q).join(';'));
    linhas.push(['Taxa de ocupação média do período', pct(d.ocupacao.mediaPeriodo)].map(q).join(';'));
    linhas.push(['Tempo médio de permanência (dias)', (Number(d.permanencia.tmp) || 0).toFixed(1)].map(q).join(';'));
    linhas.push(['Partos normais', d.partos.normal].map(q).join(';'));
    linhas.push(['Partos cesáreas', d.partos.cesarea].map(q).join(';'));
    linhas.push(['% Partos normais', pct(d.partos.percNormal)].map(q).join(';'));
    linhas.push(['% Partos cesáreas', pct(d.partos.percCesarea)].map(q).join(';'));
    linhas.push(['Admissões', d.movimentacao.admissoes].map(q).join(';'));
    linhas.push(['Altas', d.movimentacao.altas].map(q).join(';'));
    linhas.push(['Óbitos', d.movimentacao.obitos].map(q).join(';'));
    linhas.push(['Taxa de giro (saídas/leito)', (Number(d.movimentacao.taxaGiro) || 0).toFixed(2)].map(q).join(';'));
    linhas.push(['Leitos em higienização pendente', d.higienizacao.pendentes].map(q).join(';'));
    linhas.push([]);
    linhas.push(['Setor', 'Leitos', 'Ocupados', 'Higienização', 'Taxa (%)'].map(q).join(';'));
    (d.ocupacao.porSetor || []).forEach(function (s) { linhas.push([s.setor, s.total, s.ocupados, s.higienizacao || 0, s.taxa].map(q).join(';')); });
    linhas.push([]);
    linhas.push(['Alertas', 'Nível', 'Detalhe'].map(q).join(';'));
    (d.alertas || []).forEach(function (a) { linhas.push([a.titulo, a.nivel, a.detalhe].map(q).join(';')); });
    var csv = '\uFEFF' + linhas.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'indicadores_natus_' + d.periodo.dataInicial + '_a_' + d.periodo.dataFinal + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  window.carregarBI = carregarBI;
  window.biExportarCSV = biExportarCSV;

  function init() { if (!el('biKpis')) return; carregarSetores(); carregarBI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
