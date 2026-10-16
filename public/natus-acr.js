/* ACR — Acolhimento com Classificação de Risco (FASE 1)
 * Busca rápida por CPF / Cartão SUS, cadastro rápido e fila de atendimento do dia. */
(function () {
  'use strict';

  var RISCOS = ['Vermelho', 'Laranja', 'Amarelo', 'Verde', 'Azul'];
  var STATUS = ['Aguardando', 'Em Atendimento', 'Encaminhado', 'Alta', 'Desistencia'];
  var ROTULO_STATUS = { 'Aguardando': 'Aguardando', 'Em Atendimento': 'Em atendimento', 'Encaminhado': 'Encaminhado', 'Alta': 'Alta', 'Desistencia': 'Desistência' };
  var temporizador = null, ultimoDocBuscado = '';

  var el = function (id) { return document.getElementById(id); };
  var soDigitos = function (v) { return String(v == null ? '' : v).replace(/\D/g, ''); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var hoje = function () { var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };

  function mascaraCPF(v) {
    var d = soDigitos(v).substring(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.replace(/(\d{3})(\d+)/, '$1.$2');
    if (d.length <= 9) return d.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
    return d.replace(/(\d{3})(\d{3})(\d{3})(\d+)/, '$1.$2.$3-$4');
  }

  function toast(mensagem, tipo) {
    var host = el('acrToasts'); if (!host) { alert(mensagem); return; }
    var cores = { ok: 'text-bg-success', erro: 'text-bg-danger', info: 'text-bg-secondary' };
    var div = document.createElement('div');
    div.className = 'toast align-items-center ' + (cores[tipo] || cores.info) + ' border-0';
    div.setAttribute('role', 'alert');
    div.innerHTML = '<div class="d-flex"><div class="toast-body">' + esc(mensagem) + '</div>' +
      '<button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    host.appendChild(div);
    var t = new bootstrap.Toast(div, { delay: 4200 }); t.show();
    div.addEventListener('hidden.bs.toast', function () { div.remove(); });
  }

  function status(txt, classe) {
    var s = el('acrDocStatus'); s.className = 'acr-doc-status ' + (classe || ''); s.textContent = txt || '';
  }

  function riscoClasse(risco) { return 'risco-' + String(risco || '').toLowerCase(); }
  function riscoPill(risco) { return '<span class="risco-pill ' + riscoClasse(risco) + '"><span class="dot"></span>' + esc(risco || '-') + '</span>'; }

  /* ---------- FASE 1: busca por documento ---------- */
  function tipoSelecionado() { return (el('acrTipoDoc').value || 'CPF').toUpperCase(); }
  function campoDoTipo(tipo) { return tipo === 'SUS' ? 'acrCartaoSus' : 'acrCpf'; }

  function limparResumo() { var r = el('acrPacienteResumo'); r.classList.add('d-none'); r.innerHTML = ''; }

  function preencher(pac) {
    el('acrIdPaciente').value = pac.idPaciente || '';
    el('acrNome').value = pac.nome || '';
    el('acrNasc').value = pac.dataNascimento || '';
    el('acrSexo').value = (pac.sexo === 'M' ? 'M' : 'F');
    el('acrCpf').value = pac.cpf ? mascaraCPF(pac.cpf) : '';
    el('acrCartaoSus').value = pac.cartaoSus || '';
    el('acrTelefone').value = pac.telefone || '';
    el('acrProntuario').value = pac.numeroProntuario || '';
  }

  function renderResumo(pac, internacao, atendimento) {
    var r = el('acrPacienteResumo');
    var tags = '<span class="tag"><i class="bi bi-check2-circle me-1"></i>Paciente cadastrada</span>';
    if (internacao) tags += ' <span class="tag" style="background:var(--warn-soft);color:var(--warn)"><i class="bi bi-hospital me-1"></i>Internada em ' + esc(internacao.setor) + (internacao.numeroLeito ? ' · ' + esc(internacao.numeroLeito) : '') + '</span>';
    else tags += ' <span class="tag" style="background:var(--slate-soft);color:var(--slate)">Sem internação ativa</span>';
    if (atendimento) tags += ' <span class="tag" style="background:var(--bad-soft);color:var(--bad)"><i class="bi bi-hourglass-split me-1"></i>ACR ' + esc(atendimento.status) + ' · ' + esc(atendimento.risco) + '</span>';
    r.className = 'acr-paciente-card mt-2';
    r.innerHTML =
      '<div><div class="nome">' + esc(pac.nome) + '</div>' +
      '<div class="meta">Nasc.: ' + esc(pac.dataNascimento || '—') + ' · CPF: ' + esc(pac.cpf ? mascaraCPF(pac.cpf) : '—') + ' · SUS: ' + esc(pac.cartaoSus || '—') + '</div></div>' +
      '<div class="d-flex flex-wrap gap-2 ms-auto">' + tags + '</div>';
    r.classList.remove('d-none');
  }

  function buscarDocumento(forcar) {
    var tipo = tipoSelecionado();
    var doc = soDigitos(el('acrDocumento').value);
    if (!doc || doc.length < 11) {
      if (forcar) status('Informe um CPF (11 dígitos) ou Cartão SUS válido para buscar.', 'erro');
      return;
    }
    status('Consultando a base de pacientes...', '');
    google.script.run
      .withSuccessHandler(function (res) {
        if (res && res.encontrado && res.paciente) {
          ultimoDocBuscado = doc;
          preencher(res.paciente);
          renderResumo(res.paciente, res.internacaoAtiva, res.atendimentoACR);
          status('Paciente localizada no cadastro. Confira os dados e registre o atendimento.', 'ok');
        } else {
          var manter = doc;
          ultimoDocBuscado = '';
          acrLimparFormulario(false);
          el(campoDoTipo(tipo)).value = tipo === 'SUS' ? manter : mascaraCPF(manter);
          limparResumo();
          status('Nenhum cadastro encontrado para este documento. Preencha o formulário para um novo cadastro rápido.', 'novo');
        }
      })
      .withFailureHandler(function (err) { status(err && err.message ? err.message : 'Falha ao consultar o documento.', 'erro'); })
      .buscarPacientePorDocumento({ tipo: tipo, documento: doc });
  }

  function agendarBuscaAutomatica() {
    var tipo = tipoSelecionado();
    var doc = soDigitos(el('acrDocumento').value);
    var completo = (tipo === 'SUS' && doc.length === 15) || (tipo === 'CPF' && doc.length === 11);
    if (!completo || doc === ultimoDocBuscado) return;
    if (temporizador) clearTimeout(temporizador);
    temporizador = setTimeout(function () { buscarDocumento(false); }, 450);
  }

  /* ---------- formulário ---------- */
  function acrLimparFormulario(limparBusca) {
    el('formACR').reset();
    el('acrIdPaciente').value = '';
    document.getElementById('riscoAzul').checked = true;
    limparResumo();
    if (limparBusca) { el('acrDocumento').value = ''; el('acrCpf').value = ''; el('acrCartaoSus').value = ''; status('', ''); ultimoDocBuscado = ''; }
    status('Formulário limpo para novo cadastro rápido.', 'novo');
    el('acrNome').focus();
  }

  function salvarAtendimento(e) {
    e.preventDefault();
    var btn = e.submitter;
    var payload = {
      idPaciente: el('acrIdPaciente').value,
      nome: el('acrNome').value,
      dataNascimento: el('acrNasc').value,
      sexo: el('acrSexo').value,
      cpf: soDigitos(el('acrCpf').value),
      cartaoSus: soDigitos(el('acrCartaoSus').value),
      telefone: el('acrTelefone').value,
      numeroProntuario: el('acrProntuario').value,
      queixa: el('acrQueixa').value,
      risco: (document.querySelector('input[name="acrRisco"]:checked') || {}).value || 'Azul',
      destino: el('acrDestino').value,
      observacao: el('acrObservacao').value
    };
    if (!payload.nome.trim()) { toast('Informe o nome da paciente.', 'erro'); return; }
    if (payload.cpf && payload.cpf.length !== 11) { toast('CPF deve ter 11 dígitos.', 'erro'); return; }
    if (btn) { btn.disabled = true; btn.dataset.rotulo = btn.innerHTML; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Registrando...'; }
    google.script.run
      .withSuccessHandler(function () {
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.rotulo || 'Registrar atendimento'; }
        toast('Atendimento registrado com risco ' + payload.risco + '.', 'ok');
        status('Atendimento registrado. A paciente entra na fila do ACR/Kanban.', 'ok');
        acrLimparFormulario(true);
        carregarFila();
      })
      .withFailureHandler(function (err) {
        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.rotulo || 'Registrar atendimento'; }
        toast(err && err.message ? err.message : 'Não foi possível registrar o atendimento.', 'erro');
      })
      .registrarAtendimentoACR(payload);
  }

  /* ---------- fila ---------- */
  function renderKpis(resumo) {
    var r = resumo || { total: 0, porRisco: {}, porStatus: {} };
    el('kpiTotal').textContent = r.total || 0;
    el('kpiAguardando').textContent = (r.porStatus && r.porStatus['Aguardando']) || 0;
    el('kpiAlto').textContent = ((r.porRisco && r.porRisco['Vermelho']) || 0) + ((r.porRisco && r.porRisco['Laranja']) || 0);
    el('kpiFinal').textContent = ((r.porStatus && r.porStatus['Encaminhado']) || 0) + ((r.porStatus && r.porStatus['Alta']) || 0);
  }

  function opcoesStatus(atual) {
    return STATUS.map(function (s) { return '<option value="' + s + '"' + (s === atual ? ' selected' : '') + '>' + ROTULO_STATUS[s] + '</option>'; }).join('');
  }

  function renderFila(lista) {
    var body = el('acrFilaBody');
    if (!lista || !lista.length) {
      body.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Nenhum atendimento registrado nesta data.</td></tr>';
      return;
    }
    body.innerHTML = lista.map(function (a) {
      var espera = a.minutosEspera >= 60 ? Math.floor(a.minutosEspera / 60) + 'h' + String(a.minutosEspera % 60).padStart(2, '0') : a.minutosEspera + 'min';
      var destino = a.setorInternacao ? ('<div class="small text-muted"><i class="bi bi-hospital me-1"></i>' + esc(a.setorInternacao) + (a.leitoInternacao ? ' · ' + esc(a.leitoInternacao) : '') + '</div>') : (a.destino ? '<div class="small text-muted"><i class="bi bi-arrow-right me-1"></i>' + esc(a.destino) + '</div>' : '');
      return '<tr>' +
        '<td><div class="fw-semibold">' + esc(a.nome) + '</div><div class="small text-muted">' + esc(a.dataHoraEntrada) + ' · espera ' + espera + '</div>' + destino + '</td>' +
        '<td>' + riscoPill(a.risco) + '</td>' +
        '<td><select class="form-select form-select-sm" onchange="acrAtualizarStatus(\'' + a.idAtendimento + '\', this)">' + opcoesStatus(a.status) + '</select></td>' +
        '<td class="text-end"><button class="btn btn-sm btn-light" title="Ver detalhes" onclick="acrDetalhes(\'' + a.idAtendimento + '\')"><i class="bi bi-eye"></i></button></td>' +
        '</tr>';
    }).join('');
    window.__acrFila = lista;
  }

  function carregarFila() {
    var data = el('acrDataFila').value || hoje();
    el('acrDataFila').value = data;
    google.script.run.withSuccessHandler(function (l) { renderFila(l); }).withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Falha ao carregar a fila.', 'erro'); }).listarAtendimentosACR({ data: data });
    google.script.run.withSuccessHandler(renderKpis).withFailureHandler(function () {}).obterResumoACR(data);
  }

  function acrAtualizarStatus(id, sel) {
    var novo = sel.value;
    var dados = { idAtendimento: id, status: novo };
    if (novo === 'Encaminhado') {
      var atual = (window.__acrFila || []).filter(function (a) { return a.idAtendimento === id; })[0] || {};
      var destino = atual.destino || prompt('Destino / setor do encaminhamento:', '') || '';
      dados.destino = destino;
    }
    sel.disabled = true;
    google.script.run
      .withSuccessHandler(function () { sel.disabled = false; toast('Situação atualizada para "' + (ROTULO_STATUS[novo] || novo) + '".', 'ok'); carregarFila(); })
      .withFailureHandler(function (err) { sel.disabled = false; sel.value = (window.__acrFila || []).filter(function (a) { return a.idAtendimento === id; }).map(function (a) { return a.status; })[0] || 'Aguardando'; toast(err && err.message ? err.message : 'Falha ao atualizar a situação.', 'erro'); })
      .atualizarAtendimentoACR(dados);
  }

  function acrDetalhes(id) {
    var a = (window.__acrFila || []).filter(function (x) { return x.idAtendimento === id; })[0];
    if (!a) return;
    var linhas = [
      ['Paciente', a.nome], ['Nascimento', a.dataNascimento || '—'], ['CPF', a.cpf ? mascaraCPF(a.cpf) : '—'],
      ['Cartão SUS', a.cartaoSus || '—'], ['Telefone', a.telefone || '—'], ['Entrada', a.dataHoraEntrada],
      ['Risco', a.risco], ['Situação', ROTULO_STATUS[a.status] || a.status], ['Destino', a.destino || '—'],
      ['Queixa', a.queixa || '—'], ['Observações', a.observacao || '—'], ['Registrado por', a.registradoPor || '—']
    ];
    var html = '<div class="table-responsive"><table class="table table-sm mb-0">' + linhas.map(function (l) {
      return '<tr><th class="text-muted fw-semibold" style="width:38%">' + esc(l[0]) + '</th><td>' + esc(l[1]) + '</td></tr>';
    }).join('') + '</table></div>';
    var modal = el('acrModalDetalhe');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'acrModalDetalhe'; modal.className = 'modal fade'; modal.tabIndex = -1;
      modal.innerHTML = '<div class="modal-dialog modal-dialog-centered"><div class="modal-content">' +
        '<div class="modal-header bg-danger text-white"><h5 class="modal-title fw-bold"><i class="bi bi-clipboard2-pulse me-2"></i>Detalhes do atendimento ACR</h5>' +
        '<button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button></div>' +
        '<div class="modal-body" id="acrModalDetalheBody"></div></div></div>';
      document.body.appendChild(modal);
    }
    el('acrModalDetalheBody').innerHTML = html;
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  function focarBuscaACR() { el('acrDocumento').focus(); el('acrDocumento').select(); }

  /* ---------- inicialização ---------- */
  function init() {
    if (!el('formACR')) return;
    el('acrDataFila').value = hoje();
    el('formBuscaDoc').addEventListener('submit', function (e) { e.preventDefault(); buscarDocumento(true); });
    el('acrTipoDoc').addEventListener('change', function () {
      var foco = tipoSelecionado() === 'SUS' ? 'acrCartaoSus' : 'acrCpf';
      el('acrDocumento').placeholder = foco === 'acrCpf' ? '000.000.000-00' : 'Cartão SUS (15 dígitos)';
      status('', '');
    });
    el('acrDocumento').addEventListener('input', function () { if (tipoSelecionado() === 'CPF') this.value = mascaraCPF(this.value); agendarBuscaAutomatica(); });
    el('acrCpf').addEventListener('input', function () { this.value = mascaraCPF(this.value); agendarBuscaAutomatica(); });
    el('acrCartaoSus').addEventListener('input', function () { this.value = soDigitos(this.value); agendarBuscaAutomatica(); });
    el('formACR').addEventListener('submit', salvarAtendimento);
    carregarFila();
  }

  window.carregarFila = carregarFila;
  window.acrLimparFormulario = acrLimparFormulario;
  window.acrAtualizarStatus = acrAtualizarStatus;
  window.acrDetalhes = acrDetalhes;
  window.focarBuscaACR = focarBuscaACR;
  window.buscarDocumento = buscarDocumento;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
