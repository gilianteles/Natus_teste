/* FASE 4 — Prontuário Eletrônico Simplificado (PEP)
 * Consome: obterProntuario, salvarEvolucaoSOAP, excluirEvolucaoSOAP, salvarPrescricao, atualizarStatusPrescricao.
 * Reúne binômio Mãe-Bebê, evolução SOAP, prescrições e histórico unificado, com exportação CSV. */
(function () {
  'use strict';
  var el = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var dados = null;

  function idAtual() {
    try { if (window.PEP && window.PEP.idInternacao) return window.PEP.idInternacao; } catch (e) {}
    return new URLSearchParams(location.search).get('id') || '';
  }
  function tokenAtual() { try { return window.PEP && window.PEP.token ? window.PEP.token : ''; } catch (e) { return ''; } }
  function toast(msg, tipo) {
    var host = el('pepToasts'); if (!host) { alert(msg); return; }
    var cores = { ok: 'text-bg-success', erro: 'text-bg-danger', info: 'text-bg-secondary' };
    var div = document.createElement('div');
    div.className = 'toast align-items-center ' + (cores[tipo] || cores.info) + ' border-0';
    div.innerHTML = '<div class="d-flex"><div class="toast-body">' + esc(msg) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    host.appendChild(div);
    new bootstrap.Toast(div, { delay: 4500 }).show();
    div.addEventListener('hidden.bs.toast', function () { div.remove(); });
  }
  function opcoes(lista, sel) { return (lista || []).map(function (x) { return '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function agoraDH() { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  function classeCategoria(c) {
    var x = String(c || '').toLowerCase();
    if (x.indexOf('médic') >= 0 || x.indexOf('medic') >= 0) return 'pep-evo-medico';
    if (x.indexOf('enferm') >= 0) return 'pep-evo-enfermagem';
    return 'pep-evo-outro';
  }

  function render(i) {
    var p = i.internacao;
    var ehRN = String(p.tipoPaciente).toUpperCase() === 'RN';
    var nasc = '';
    if (ehRN || p.apgar1 != null || p.apgar5 != null || p.pesoGramas != null || p.pulseira) {
      nasc = '<div class="pep-card pep-nascimento">' +
        '<div class="pep-card-titulo"><i class="bi bi-emoji-smile"></i> Dados ao nascer</div>' +
        '<div class="pep-grid">' +
        '<div><span>APGAR 1º min</span><b>' + (p.apgar1 == null ? '—' : esc(p.apgar1)) + '</b></div>' +
        '<div><span>APGAR 5º min</span><b>' + (p.apgar5 == null ? '—' : esc(p.apgar5)) + '</b></div>' +
        '<div><span>Peso</span><b>' + (p.pesoGramas != null ? esc(p.pesoGramas) + ' g' : (esc(p.pesoNascer) || '—')) + '</b></div>' +
        '<div><span>Tipo de parto</span><b>' + (esc(p.tipoParto) || '—') + '</b></div>' +
        '<div><span>Reanimação</span><b>' + (esc(p.reanimacao) || '—') + '</b></div>' +
        '<div><span>Pulseira / identificação</span><b>' + (esc(p.pulseira) || '—') + '</b></div>' +
        '<div><span>IG</span><b>' + (esc(p.ig) || '—') + '</b></div>' +
        '<div><span>Hora nascimento</span><b>' + (esc(p.horaNascimento) || '—') + '</b></div>' +
        '</div></div>';
    }

    var bin = (i.binomio && i.binomio.length)
      ? i.binomio.map(function (b) {
          return '<div class="pep-vinculo" onclick="pepAbrir(\'' + NatusEscape.js(b.idInternacao) + '\')">' +
            '<div><b>' + esc(b.nome) + '</b> <span class="badge text-bg-light border">' + (esc(b.tipoPaciente) || 'Paciente') + '</span></div>' +
            '<div class="small text-muted">' + esc(b.setor) + (b.numeroLeito ? ' · ' + esc(b.numeroLeito) : '') + ' · ' + esc(b.status) + ' · ' + b.diasInternado + ' dia(s)</div>' +
            '<i class="bi bi-box-arrow-up-right"></i></div>';
        }).join('')
      : '<div class="text-muted small">Nenhum vínculo de binômio registrado para esta internação.</div>';

    var evos = (i.evolucoes && i.evolucoes.length)
      ? i.evolucoes.map(function (e) {
          return '<div class="pep-evo ' + classeCategoria(e.categoria) + '">' +
            '<div class="pep-evo-topo"><span class="pep-evo-cat"><i class="bi bi-person-badge me-1"></i>' + esc(e.categoria) + '</span>' +
            '<span class="text-muted small">' + esc(e.dataHora) + ' · ' + esc(e.profissional) + '</span>' +
            (e.cancelada ? '<span class="badge text-bg-warning ms-auto">Cancelada</span>' : '<button class="btn btn-sm btn-link text-danger ms-auto p-0" title="Cancelar evolução" onclick="pepExcluirEvolucao(\'' + NatusEscape.js(e.idEvolucao) + '\')"><i class="bi bi-trash"></i></button>') + '</div>' +
            (e.cancelada ? '<div class="alert alert-warning py-1">Cancelada por ' + esc(e.canceladaPor) + ' em ' + esc(e.canceladaEm) + ': ' + esc(e.motivoCancelamento) + '</div>' : '') +
            '<details class="small mb-2"><summary>Histórico de versões</summary>' + (e.versoes || []).map(function (v) {
              var d = v.dados;
              return '<div class="border rounded p-2 mt-1"><b>' + esc(v.autor) + '</b> · ' + esc(v.registradoEm) + ' · ' + esc(v.motivo) +
                '<div>S: ' + esc(d.subjetivo) + '</div><div>O: ' + esc(d.objetivo) + '</div><div>A: ' + esc(d.avaliacao) + '</div><div>P: ' + esc(d.plano) + '</div></div>';
            }).join('') + '</details>' +
            '<div class="pep-soap"><div><b>S</b> ' + (esc(e.subjetivo) || '<span class="text-muted">—</span>') + '</div>' +
            '<div><b>O</b> ' + (esc(e.objetivo) || '<span class="text-muted">—</span>') + '</div>' +
            '<div><b>A</b> ' + (esc(e.avaliacao) || '<span class="text-muted">—</span>') + '</div>' +
            '<div><b>P</b> ' + (esc(e.plano) || '<span class="text-muted">—</span>') + '</div></div></div>';
        }).join('')
      : '<div class="text-muted small">Nenhuma evolução registrada ainda.</div>';

    var presc = (i.prescricoes && i.prescricoes.length)
      ? i.prescricoes.map(function (r) {
          var st = String(r.status).toLowerCase();
          var badge = st.indexOf('susp') >= 0 ? 'text-bg-warning' : (st.indexOf('conclu') >= 0 ? 'text-bg-secondary' : 'text-bg-success');
          var acoes = st.indexOf('ativa') >= 0
            ? '<button class="btn btn-sm btn-outline-warning" onclick="pepStatusPrescricao(\'' + NatusEscape.js(r.idPrescricao) + '\',\'Suspensa\')">Suspender</button>' +
              '<button class="btn btn-sm btn-outline-secondary" onclick="pepStatusPrescricao(\'' + NatusEscape.js(r.idPrescricao) + '\',\'Concluída\')">Concluir</button>'
            : '<button class="btn btn-sm btn-outline-success" onclick="pepStatusPrescricao(\'' + NatusEscape.js(r.idPrescricao) + '\',\'Ativa\')">Reativar</button>';
          return '<div class="pep-presc"><div class="d-flex align-items-center gap-2">' +
            '<span class="badge text-bg-light border">' + esc(r.tipo) + '</span><b>' + esc(r.descricao) + '</b>' +
            '<span class="badge ' + badge + ' ms-auto">' + esc(r.status) + '</span></div>' +
            '<div class="small text-muted">' + [esc(r.dose), esc(r.via), esc(r.frequencia)].filter(Boolean).join(' · ') + (r.dose || r.via || r.frequencia ? ' · ' : '') + esc(r.dataHora) + ' · ' + esc(r.profissional) + '</div>' +
            (r.observacao ? '<div class="small">' + esc(r.observacao) + '</div>' : '') +
            '<div class="d-flex gap-2 mt-2">' + acoes + '</div></div>';
        }).join('')
      : '<div class="text-muted small">Nenhuma prescrição registrada.</div>';

    var movs = (i.movimentacoes && i.movimentacoes.length)
      ? '<ul class="pep-timeline">' + i.movimentacoes.map(function (m) {
          return '<li><b>' + esc(m.tipo) + '</b> — ' + esc(m.dataHora) + (m.destino ? ' → ' + esc(m.destino) : '') +
            (m.pesoSaidaGramas != null ? ' · ' + esc(m.pesoSaidaGramas) + ' g' : '') +
            (m.observacao ? '<div class="small text-muted">' + esc(m.observacao) + '</div>' : '') + '</li>';
        }).join('') + '</ul>'
      : '<div class="text-muted small">Sem movimentações de saída/transferência.</div>';

    el('pepConteudo').innerHTML =
      '<div class="pep-header">' +
        '<div class="pep-header-main">' +
          '<div class="pep-nome">' + esc(p.nome) + ' <span class="badge text-bg-danger">' + esc(p.setor) + (p.numeroLeito ? ' · ' + esc(p.numeroLeito) : '') + '</span></div>' +
          '<div class="small text-muted">Prontuário: ' + (esc(p.numeroProntuario) || '—') + ' · Nasc.: ' + (esc(p.dataNascimento) || '—') + ' · Sexo: ' + (p.sexo === 'F' ? 'Feminino' : (p.sexo === 'M' ? 'Masculino' : '—')) + ' · CPF: ' + (esc(p.cpf) || '—') + ' · SUS: ' + (esc(p.cartaoSus) || '—') + '</div>' +
          '<div class="small text-muted">Internação: ' + esc(p.dataHoraEntrada) + ' · ' + p.diasInternado + ' dia(s) · Procedência: ' + (esc(p.procedencia) || '—') + ' · Situação: ' + esc(p.status) + (p.statusRegulacao ? ' (' + esc(p.statusRegulacao) + ')' : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="pep-cols">' +
        '<div class="pep-card">' +
          '<div class="pep-card-titulo"><i class="bi bi-diagram-2"></i> Binômio Mãe-Bebê</div>' + bin + '</div>' +
        nasc +
      '</div>' +
      '<ul class="nav nav-pills pep-tabs" role="tablist">' +
        '<li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#tabEvolucoes" type="button"><i class="bi bi-journal-text me-1"></i>Evolução SOAP</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tabPrescricoes" type="button"><i class="bi bi-capsule me-1"></i>Prescrições</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#tabHistorico" type="button"><i class="bi bi-clock-history me-1"></i>Histórico unificado</button></li>' +
      '</ul>' +
      '<div class="tab-content pep-tabcontent">' +
        '<div class="tab-pane fade show active" id="tabEvolucoes"><div class="d-flex justify-content-end mb-2"><button class="btn btn-natus btn-sm fw-semibold" onclick="pepAbrirEvolucao()"><i class="bi bi-plus-lg me-1"></i>Nova evolução SOAP</button></div>' + evos + '</div>' +
        '<div class="tab-pane fade" id="tabPrescricoes"><div class="d-flex justify-content-end mb-2"><button class="btn btn-natus btn-sm fw-semibold" onclick="pepAbrirPrescricao()"><i class="bi bi-plus-lg me-1"></i>Nova prescrição</button></div>' + presc + '</div>' +
        '<div class="tab-pane fade" id="tabHistorico">' + movs + '</div>' +
      '</div>';

    el('pepSync').textContent = 'Atualizado ' + (i.geradoEm || new Date().toLocaleTimeString('pt-BR'));
    el('soapCategoria').innerHTML = opcoes(i.opcoes.categorias, 'Médico');
    el('prescTipo').innerHTML = opcoes(i.opcoes.tiposPrescricao, 'Medicamento');
    el('prescStatus').innerHTML = opcoes(i.opcoes.statusPrescricao, 'Ativa');
  }

  function carregarProntuario() {
    var id = idAtual();
    if (!id) { el('pepConteudo').innerHTML = '<div class="alert alert-warning">Internação não informada. Abra o prontuário a partir do painel de leitos ou do Kanban.</div>'; return; }
    google.script.run.withSuccessHandler(function (i) { dados = i; render(i); })
      .withFailureHandler(function (e) { el('pepConteudo').innerHTML = '<div class="alert alert-danger">' + esc(e && e.message ? e.message : 'Falha ao carregar o prontuário.') + '</div>'; })
      .obterProntuario(id);
  }

  function pepAbrirEvolucao() {
    if (!dados) return;
    var t = agoraDH();
    el('soapData').value = t.split('T')[0]; el('soapHora').value = t.split('T')[1];
    ['soapS', 'soapO', 'soapA', 'soapP'].forEach(function (id) { el(id).value = ''; });
    el('soapProfissional').value = '';
    bootstrap.Modal.getOrCreateInstance(el('modalEvolucaoSOAP')).show();
  }
  function pepSalvarEvolucao() {
    var payload = { idInternacao: idAtual(), categoria: el('soapCategoria').value, profissional: el('soapProfissional').value,
      data: el('soapData').value, hora: el('soapHora').value, subjetivo: el('soapS').value, objetivo: el('soapO').value,
      avaliacao: el('soapA').value, plano: el('soapP').value };
    google.script.run.withSuccessHandler(function () {
      bootstrap.Modal.getInstance(el('modalEvolucaoSOAP')).hide(); toast('Evolução registrada.', 'ok'); carregarProntuario();
    }).withFailureHandler(function (e) { toast(e && e.message ? e.message : 'Não foi possível registrar.', 'erro'); }).salvarEvolucaoSOAP(payload);
  }
  function pepExcluirEvolucao(idEvolucao) {
    var motivo = prompt('Motivo do cancelamento (o conteúdo e o histórico serão preservados):');
    if (!motivo || !motivo.trim()) return;
    google.script.run.withSuccessHandler(function () { toast('Evolução cancelada. Histórico preservado.', 'ok'); carregarProntuario(); })
      .withFailureHandler(function (e) { toast(e && e.message ? e.message : 'Não foi possível excluir.', 'erro'); }).excluirEvolucaoSOAP(idEvolucao, motivo.trim());
  }
  function pepAbrirPrescricao() {
    if (!dados) return;
    ['prescDescricao', 'prescDose', 'prescVia', 'prescFrequencia', 'prescObservacao', 'prescProfissional'].forEach(function (id) { el(id).value = ''; });
    el('prescDataHora').value = agoraDH();
    bootstrap.Modal.getOrCreateInstance(el('modalPrescricao')).show();
  }
  function pepSalvarPrescricao() {
    var dh = el('prescDataHora').value || '';
    var payload = { idInternacao: idAtual(), tipo: el('prescTipo').value, status: el('prescStatus').value, profissional: el('prescProfissional').value,
      descricao: el('prescDescricao').value, dose: el('prescDose').value, via: el('prescVia').value, frequencia: el('prescFrequencia').value,
      observacao: el('prescObservacao').value, data: dh ? dh.split('T')[0] : '', hora: dh ? dh.split('T')[1] : '' };
    google.script.run.withSuccessHandler(function () {
      bootstrap.Modal.getInstance(el('modalPrescricao')).hide(); toast('Prescrição registrada.', 'ok'); carregarProntuario();
    }).withFailureHandler(function (e) { toast(e && e.message ? e.message : 'Não foi possível prescrever.', 'erro'); }).salvarPrescricao(payload);
  }
  function pepStatusPrescricao(idPrescricao, status) {
    google.script.run.withSuccessHandler(function () { toast('Prescrição: ' + status + '.', 'ok'); carregarProntuario(); })
      .withFailureHandler(function (e) { toast(e && e.message ? e.message : 'Não foi possível alterar.', 'erro'); })
      .atualizarStatusPrescricao({ idPrescricao: idPrescricao, status: status });
  }
  function pepAbrir(idInternacao) { window.open('/?view=prontuario&id=' + encodeURIComponent(idInternacao), '_blank'); }

  function pepBaixarCSV() {
    if (!dados) { toast('Nada para exportar ainda.', 'erro'); return; }
    var p = dados.internacao, linhas = [];
    var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    linhas.push(['Seção', 'Data/Hora', 'Categoria/Tipo', 'Descrição', 'Detalhes'].map(q).join(';'));
    linhas.push(['Identificação', p.dataHoraEntrada, p.nome, 'Internação ' + p.idInternacao, 'Setor ' + p.setor + ' leito ' + (p.numeroLeito || '-') + ' prontuário ' + (p.numeroProntuario || '-')].map(q).join(';'));
    (dados.binomio || []).forEach(function (b) { linhas.push(['Binômio', b.dataHoraEntrada, b.tipoPaciente, b.nome, b.setor + ' ' + (b.numeroLeito || '')].map(q).join(';')); });
    (dados.evolucoes || []).forEach(function (e) { linhas.push(['Evolução SOAP' + (e.cancelada ? ' (CANCELADA)' : ''), e.dataHora, e.categoria, e.profissional, 'S: ' + e.subjetivo + ' | O: ' + e.objetivo + ' | A: ' + e.avaliacao + ' | P: ' + e.plano].map(q).join(';')); });
    (dados.prescricoes || []).forEach(function (r) { linhas.push(['Prescrição', r.dataHora, r.tipo + ' (' + r.status + ')', r.descricao, [r.dose, r.via, r.frequencia, r.profissional, r.observacao].filter(Boolean).join(' | ')].map(q).join(';')); });
    (dados.movimentacoes || []).forEach(function (m) { linhas.push(['Movimentação', m.dataHora, m.tipo, m.destino, m.observacao].map(q).join(';')); });
    var csv = '\uFEFF' + linhas.join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prontuario_' + (p.nome || 'paciente').replace(/\s+/g, '_') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  window.carregarProntuario = carregarProntuario;
  window.pepAbrirEvolucao = pepAbrirEvolucao;
  window.pepSalvarEvolucao = pepSalvarEvolucao;
  window.pepExcluirEvolucao = pepExcluirEvolucao;
  window.pepAbrirPrescricao = pepAbrirPrescricao;
  window.pepSalvarPrescricao = pepSalvarPrescricao;
  window.pepStatusPrescricao = pepStatusPrescricao;
  window.pepAbrir = pepAbrir;
  window.pepBaixarCSV = pepBaixarCSV;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carregarProntuario); else carregarProntuario();
})();
