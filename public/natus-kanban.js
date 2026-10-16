/* Kanban de Regulação do NIR (FASE 2)
 * Arrastar e soltar entre as colunas atualiza o status operacional no backend (moverCardKanban). */
(function () {
  'use strict';

  var COLUNAS = [
    { id: 'aguardando', titulo: 'Aguardando Avaliação (Triagem/ACR)', icone: 'bi-hourglass-split' },
    { id: 'internado', titulo: 'Internado / Ativo', icone: 'bi-hospital' },
    { id: 'documentacao', titulo: 'Aguardando Documentação', icone: 'bi-file-earmark-text' },
    { id: 'alta', titulo: 'Pronto para Alta / Transferência', icone: 'bi-box-arrow-right' }
  ];
  var ROTULO_STATUS = { aguardando: 'Aguardando avaliação (ACR)', internado: 'Internado / Ativo', documentacao: 'Aguardando documentação', alta: 'Pronto para alta/transferência' };
  var temporizador = null, arrastando = null, dados = null, atualizandoGrade = false;

  var el = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };

  function toast(msg, tipo) {
    var host = el('kbToasts'); if (!host) { alert(msg); return; }
    var cores = { ok: 'text-bg-success', erro: 'text-bg-danger', info: 'text-bg-secondary' };
    var div = document.createElement('div');
    div.className = 'toast align-items-center ' + (cores[tipo] || cores.info) + ' border-0';
    div.setAttribute('role', 'alert');
    div.innerHTML = '<div class="d-flex"><div class="toast-body">' + esc(msg) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>';
    host.appendChild(div);
    bootstrap.Toast.getOrCreateInstance ? bootstrap.Toast.getOrCreateInstance(div, { delay: 4500 }).show() : new bootstrap.Toast(div, { delay: 4500 }).show();
    div.addEventListener('hidden.bs.toast', function () { div.remove(); });
  }

  function card(id) { if (!dados) return null; for (var i = 0; i < dados.colunas.length; i++) { var c = dados.colunas[i].cards.filter(function (x) { return x.idCard === id; })[0]; if (c) return c; } return null; }

  function renderCard(c) {
    var tags = [];
    if (c.setor) tags.push('<span class="kb-tag"><i class="bi bi-hospital me-1"></i>' + esc(c.setor) + (c.numeroLeito ? ' · ' + esc(c.numeroLeito) : '') + '</span>');
    else tags.push('<span class="kb-tag"><i class="bi bi-clipboard2-pulse me-1"></i>Sem leito (ACR)</span>');
    if (c.riscoAcr) tags.push('<span class="kb-tag risco-pill ' + ('risco-' + c.riscoAcr.toLowerCase()) + '" style="padding:1px 8px"><span class="dot"></span>ACR ' + esc(c.riscoAcr) + '</span>');
    if (c.diasInternado) tags.push('<span class="kb-tag">' + c.diasInternado + ' dia(s)</span>');
    var i = COLUNAS.findIndex(function (x) { return x.id === c.coluna; });
    var nav = '<div class="kb-acoes">' +
      (i > 0 ? '<button class="btn btn-sm btn-light" title="Mover para a coluna anterior" onclick="kbMover(\'' + c.idCard + '\',\'' + COLUNAS[i - 1].id + '\')"><i class="bi bi-arrow-left"></i></button>' : '') +
      (i < COLUNAS.length - 1 ? '<button class="btn btn-sm btn-light" title="Avançar para a próxima coluna" onclick="kbMover(\'' + c.idCard + '\',\'' + COLUNAS[i + 1].id + '\')"><i class="bi bi-arrow-right"></i></button>' : '') +
      '<button class="btn btn-sm btn-light ms-auto" title="Detalhes / observações" onclick="kbAbrirCard(\'' + c.idCard + '\')"><i class="bi bi-three-dots"></i></button></div>';
    return '<div class="kb-card prio-' + esc(c.prioridade) + '" draggable="true" data-card="' + esc(c.idCard) + '" data-coluna="' + esc(c.coluna) + '">' +
      '<div class="kb-nome">' + esc(c.nome) + '</div>' +
      '<div class="kb-meta"><span><i class="bi bi-clock-history me-1"></i>' + esc(c.dataHoraEntrada || c.criadoEm || '—') + '</span>' +
      (c.tipoPaciente ? '<span><i class="bi bi-gender-ambiguous me-1"></i>' + esc(c.tipoPaciente) + '</span>' : '') + '</div>' +
      '<div class="kb-tags">' + tags.join('') + '</div>' +
      (c.observacao ? '<div class="kb-obs"><i class="bi bi-chat-left-text me-1"></i>' + esc(c.observacao) + '</div>' : '') +
      nav + '</div>';
  }

  function render() {
    var board = el('kbBoard');
    if (!dados) return;
    board.innerHTML = dados.colunas.map(function (col) {
      var def = COLUNAS.filter(function (c) { return c.id === col.id; })[0] || { icone: 'bi-kanban' };
      var cards = col.cards.length ? col.cards.map(renderCard).join('') : '<div class="kb-vazio">Nenhuma paciente nesta etapa.</div>';
      return '<section class="kb-coluna kb-col-' + col.id + '" data-coluna="' + col.id + '">' +
        '<header class="kb-coluna-topo"><span class="icone"><i class="bi ' + def.icone + '"></i></span>' +
        '<span class="titulo">' + esc(col.titulo) + '</span><span class="contagem">' + col.cards.length + '</span></header>' +
        '<div class="kb-lista" data-coluna="' + col.id + '">' + cards + '</div></section>';
    }).join('');
    ligarDragDrop();
    el('kbSync').textContent = 'Sincronizado ' + (dados.atualizadoEm || '');
  }

  function ligarDragDrop() {
    document.querySelectorAll('#kbBoard .kb-card').forEach(function (c) {
      c.addEventListener('dragstart', function (ev) {
        arrastando = this.getAttribute('data-card');
        this.classList.add('dragging');
        try { ev.dataTransfer.setData('text/plain', arrastando); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {}
      });
      c.addEventListener('dragend', function () { this.classList.remove('dragging'); arrastando = null; limparDestaques(); });
      c.addEventListener('dblclick', function () { kbAbrirCard(this.getAttribute('data-card')); });
    });
    document.querySelectorAll('#kbBoard .kb-coluna').forEach(function (col) {
      col.addEventListener('dragover', function (ev) {
        if (!arrastando) return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
        if (!this.classList.contains('drag-over')) { limparDestaques(); this.classList.add('drag-over'); }
      });
      col.addEventListener('dragleave', function (ev) { if (!this.contains(ev.relatedTarget)) this.classList.remove('drag-over'); });
      col.addEventListener('drop', function (ev) {
        ev.preventDefault();
        var destino = this.getAttribute('data-coluna');
        var id = arrastando || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
        this.classList.remove('drag-over');
        arrastando = null;
        if (id && destino) kbMover(id, destino);
      });
    });
  }
  function limparDestaques() { document.querySelectorAll('#kbBoard .kb-coluna.drag-over').forEach(function (c) { c.classList.remove('drag-over'); }); }

  function carregarKanban() {
    if (arrastando) return;
    var filtro = { texto: (el('kbBusca') || {}).value || '', prioridade: (el('kbPrioridade') || {}).value || '' };
    google.script.run
      .withSuccessHandler(function (d) { dados = d; render(); })
      .withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Falha ao carregar o quadro.', 'erro'); })
      .obterKanban(filtro);
  }

  /* ---------- movimentação (drag & drop, setas e modal) ---------- */
  function kbMover(idCard, coluna, extras) {
    var c = card(idCard);
    if (c && c.coluna === coluna && !(extras && Object.keys(extras).length)) return;
    var payload = { idCard: idCard, coluna: coluna };
    if (extras) Object.keys(extras).forEach(function (k) { payload[k] = extras[k]; });
    atualizandoGrade = true;
    google.script.run
      .withSuccessHandler(function () {
        atualizandoGrade = false;
        toast('Card movido para "' + ROTULO_STATUS[coluna] + '".', 'ok');
        carregarKanban();
      })
      .withFailureHandler(function (err) {
        atualizandoGrade = false;
        toast(err && err.message ? err.message : 'Não foi possível mover o card.', 'erro');
        carregarKanban();
      })
      .moverCardKanban(payload);
  }

  function kbAbrirCard(idCard) {
    var c = card(idCard); if (!c) return;
    var opcoesColuna = COLUNAS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === c.coluna ? ' selected' : '') + '>' + esc(x.titulo) + '</option>'; }).join('');
    var opcoesPrio = ['Rotina', 'Prioridade', 'Urgente'].map(function (p) { return '<option value="' + p + '"' + (p === c.prioridade ? ' selected' : '') + '>' + p + '</option>'; }).join('');
    // Regulação: enquanto não há internação ativa, o regulador pode internar a paciente direto pelo card.
    var podeInternar = !c.idInternacao;
    var blocoInternar = podeInternar
      ? '<div class="border-top pt-3 mt-3">' +
          '<div class="fw-semibold mb-2"><i class="bi bi-hospital me-1"></i>Internar a paciente (Regulação)</div>' +
          '<div class="row g-2">' +
          '<div class="col-md-6"><label class="form-label small mb-1">Setor de destino</label><select class="form-select form-select-sm" id="kbIntSetor" onchange="kbCarregarLeitos()"><option value="">Selecione...</option></select></div>' +
          '<div class="col-md-6"><label class="form-label small mb-1">Leito</label><select class="form-select form-select-sm" id="kbIntLeito"><option value="">Selecione o setor primeiro</option></select></div>' +
          '<div class="col-6 col-md-3"><label class="form-label small mb-1">Data</label><input type="date" class="form-control form-control-sm" id="kbIntData"></div>' +
          '<div class="col-6 col-md-3"><label class="form-label small mb-1">Hora</label><input type="time" class="form-control form-control-sm" id="kbIntHora"></div>' +
          '<div class="col-6 col-md-3 d-none" id="kbIntTipoWrap"><label class="form-label small mb-1">Tipo</label><select class="form-select form-select-sm" id="kbIntTipo"><option value="RN">RN (recém-nascido)</option><option value="MAE">Mãe</option></select></div>' +
          '<div class="col-6 col-md-3"><label class="form-label small mb-1">Procedência</label><input class="form-control form-control-sm" id="kbIntProc" value="ACR"></div>' +
          '</div>' +
          '<button class="btn btn-natus btn-sm fw-semibold mt-3" onclick="kbInternar(\'' + c.idCard + '\')"><i class="bi bi-box-arrow-in-down me-1"></i>Confirmar internação</button>' +
        '</div>'
      : '';
    el('kbDetalheBody').innerHTML =
      '<div class="mb-3"><div class="fw-bold fs-5">' + esc(c.nome) + '</div>' +
      '<div class="small text-muted">Nasc.: ' + esc(c.dataNascimento || '—') + ' · CPF: ' + esc(c.cpf || '—') + ' · SUS: ' + esc(c.cartaoSus || '—') + '</div>' +
      '<div class="small text-muted">' + (c.setor ? 'Leito: ' + esc(c.setor) + (c.numeroLeito ? ' · ' + esc(c.numeroLeito) : '') : 'Sem leito atribuído') + ' · Entrada: ' + esc(c.dataHoraEntrada || '—') + '</div>' +
      (c.idInternacao ? '<button class="btn btn-sm btn-outline-primary mt-2 fw-semibold" onclick="kbAbrirProntuario(\'' + esc(c.idInternacao) + '\')"><i class="bi bi-journal-medical me-1"></i>Abrir prontuário (PEP)</button>' : '') + '</div>' +
      '<div class="row g-2">' +
      '<div class="col-md-6"><label class="form-label">Coluna</label><select class="form-select" id="kbCardColuna">' + opcoesColuna + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Prioridade</label><select class="form-select" id="kbCardPrioridade">' + opcoesPrio + '</select></div>' +
      '<div class="col-md-6"><label class="form-label">Responsável</label><input class="form-control" id="kbCardResponsavel" value="' + esc(c.responsavel) + '" placeholder="Regulador(a)"></div>' +
      '<div class="col-md-6"><label class="form-label">Atualizado em</label><input class="form-control" value="' + esc(c.atualizadoEm || '—') + '" readonly></div>' +
      '<div class="col-12"><label class="form-label">Observações da regulação</label><textarea class="form-control" id="kbCardObs" rows="3">' + esc(c.observacao) + '</textarea></div>' +
      '</div>' +
      blocoInternar +
      '<div class="d-flex justify-content-between mt-4">' +
      '<button class="btn btn-outline-danger btn-sm" onclick="kbRemover(\'' + c.idCard + '\')"><i class="bi bi-trash me-1"></i>Retirar do quadro</button>' +
      '<button class="btn btn-natus fw-semibold" onclick="kbSalvarCard(\'' + c.idCard + '\')"><i class="bi bi-check-lg me-1"></i>Salvar alterações</button>' +
      '</div>';
    bootstrap.Modal.getOrCreateInstance(el('modalCardKanban')).show();
    if (podeInternar) kbCarregarSetoresParaInternar();
  }

  /* ---------- internação pelo card (regulação) ---------- */
  var SETORES_ALCON = ['ALCON 1', 'ALCON 2'];
  function agora() { var d = new Date(); var p = function (n) { return String(n).padStart(2, '0'); }; return { data: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()), hora: p(d.getHours()) + ':' + p(d.getMinutes()) }; }
  function kbCarregarSetoresParaInternar() {
    var sel = el('kbIntSetor'), lt = el('kbIntLeito'); if (!sel || !lt) return;
    var t = agora(); if (el('kbIntData')) el('kbIntData').value = t.data; if (el('kbIntHora')) el('kbIntHora').value = t.hora;
    if (el('kbIntProc') && !el('kbIntProc').value) el('kbIntProc').value = 'ACR';
    if (sel.dataset.carregado) return; sel.dataset.carregado = '1';
    google.script.run.withSuccessHandler(function (setores) {
      sel.innerHTML = '<option value="">Selecione...</option>' + (setores || []).map(function (s) { var nome = (s && s.Nome_Setor) ? s.Nome_Setor : s; return '<option value="' + esc(nome) + '">' + esc(nome) + '</option>'; }).join('');
    }).withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Falha ao carregar setores.', 'erro'); }).obterSetores();
  }
  function kbCarregarLeitos() {
    var setor = el('kbIntSetor') ? el('kbIntSetor').value : '';
    var sel = el('kbIntLeito'); if (!sel) return;
    var wrapTipo = el('kbIntTipoWrap');
    var ehAlcon = SETORES_ALCON.indexOf(String(setor).trim().toUpperCase()) !== -1;
    if (wrapTipo) wrapTipo.classList.toggle('d-none', !ehAlcon);
    if (!setor) { sel.innerHTML = '<option value="">Selecione o setor primeiro</option>'; return; }
    sel.innerHTML = '<option value="">Carregando...</option>';
    google.script.run.withSuccessHandler(function (leitos) {
      if (!leitos || !leitos.length) { sel.innerHTML = '<option value="">Nenhum leito disponível neste setor</option>'; return; }
      sel.innerHTML = '<option value="">Selecione o leito...</option>' + leitos.map(function (l) { return '<option value="' + esc(l.ID_Leito) + '">' + esc(l.Numero_Leito) + (l.Status && l.Status !== 'Livre' ? ' — ' + esc(l.Status) : '') + '</option>'; }).join('');
    }).withFailureHandler(function (err) { sel.innerHTML = '<option value="">Erro ao consultar leitos</option>'; toast(err && err.message ? err.message : 'Falha ao consultar leitos.', 'erro'); })
      .getLeitosDisponiveisSetor(setor);
  }
  function kbInternar(idCard) {
    var setor = el('kbIntSetor').value, leitoId = el('kbIntLeito').value;
    if (!setor) { toast('Selecione o setor de destino.', 'erro'); return; }
    if (!leitoId) { toast('Selecione o leito de destino.', 'erro'); return; }
    var wrapTipo = el('kbIntTipoWrap');
    var tipoPaciente = (wrapTipo && !wrapTipo.classList.contains('d-none')) ? el('kbIntTipo').value : '';
    var payload = { idCard: idCard, setor: setor, leitoId: leitoId, data: el('kbIntData').value, hora: el('kbIntHora').value,
      procedencia: (el('kbIntProc') || {}).value || 'ACR', tipoPaciente: tipoPaciente || undefined };
    atualizandoGrade = true;
    google.script.run.withSuccessHandler(function () {
      atualizandoGrade = false;
      bootstrap.Modal.getInstance(el('modalCardKanban')).hide();
      toast('Paciente internado — card movido para "Internado / Ativo".', 'ok');
      carregarKanban();
    }).withFailureHandler(function (err) { atualizandoGrade = false; toast(err && err.message ? err.message : 'Não foi possível internar a paciente.', 'erro'); })
      .internarCardKanban(payload);
  }
  function kbAbrirProntuario(idInternacao) {
    if (!idInternacao) return;
    var t = tokenAtual();
    window.open('/?view=prontuario&token=' + encodeURIComponent(t) + '&id=' + encodeURIComponent(idInternacao), '_blank');
  }

  function kbSalvarCard(idCard) {
    var coluna = el('kbCardColuna').value, prioridade = el('kbCardPrioridade').value;
    var responsavel = el('kbCardResponsavel').value, observacao = el('kbCardObs').value;
    google.script.run
      .withSuccessHandler(function () {
        bootstrap.Modal.getInstance(el('modalCardKanban')).hide();
        toast('Regulação atualizada.', 'ok');
        carregarKanban();
      })
      .withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Não foi possível salvar.', 'erro'); })
      .moverCardKanban({ idCard: idCard, coluna: coluna, prioridade: prioridade, responsavel: responsavel, observacao: observacao });
  }

  function kbRemover(idCard) {
    if (!confirm('Retirar este card do quadro Kanban? O status operacional da internação permanece inalterado.')) return;
    google.script.run
      .withSuccessHandler(function () { bootstrap.Modal.getInstance(el('modalCardKanban')).hide(); toast('Card retirado do quadro.', 'ok'); carregarKanban(); })
      .withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Não foi possível remover.', 'erro'); })
      .removerCardKanban(idCard);
  }

  /* ---------- novo card ---------- */
  function abrirNovoCardKanban() {
    el('kbBuscaPaciente').value = ''; el('kbResultadoPaciente').innerHTML = ''; el('kbNovaObs').value = '';
    bootstrap.Modal.getOrCreateInstance(el('modalNovoCard')).show();
  }
  function kbBuscarPaciente() {
    var termo = el('kbBuscaPaciente').value.trim();
    if (termo.length < 2) { toast('Digite ao menos 2 letras do nome.', 'erro'); return; }
    google.script.run
      .withSuccessHandler(function (lista) {
        if (!lista || !lista.length) { el('kbResultadoPaciente').innerHTML = '<div class="alert alert-warning mb-0 small">Nenhuma paciente encontrada.</div>'; return; }
        el('kbResultadoPaciente').innerHTML = '<div class="list-group" style="max-height:240px;overflow:auto">' + lista.map(function (p, i) {
          return '<button type="button" class="list-group-item list-group-item-action" onclick="kbEscolherPaciente(' + i + ')">' +
            '<b>' + esc(p.nome) + '</b><div class="small text-muted">Nasc.: ' + esc(p.dataNascimento || '—') + ' · ' + (p.totalInternacoes || 0) + ' internação(ões)</div></button>';
        }).join('') + '</div>';
        window.__kbPacientes = lista;
      })
      .withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Falha na busca.', 'erro'); })
      .buscarPacientesPorNome(tokenAtual(), termo);
  }
  function tokenAtual() { try { return window.KB && window.KB.token ? window.KB.token : ''; } catch (e) { return ''; } }
  var pacienteSelecionado = null;
  function kbEscolherPaciente(i) {
    pacienteSelecionado = (window.__kbPacientes || [])[i];
    if (!pacienteSelecionado) return;
    el('kbResultadoPaciente').innerHTML = '<div class="alert alert-success mb-0 small"><i class="bi bi-check2-circle me-1"></i>Selecionada: <b>' + esc(pacienteSelecionado.nome) + '</b></div>';
  }
  function kbSalvarNovoCard() {
    if (!pacienteSelecionado) { toast('Selecione uma paciente na busca.', 'erro'); return; }
    google.script.run
      .withSuccessHandler(function () {
        bootstrap.Modal.getInstance(el('modalNovoCard')).hide();
        pacienteSelecionado = null;
        toast('Card adicionado ao Kanban.', 'ok');
        carregarKanban();
      })
      .withFailureHandler(function (err) { toast(err && err.message ? err.message : 'Não foi possível adicionar o card.', 'erro'); })
      .criarCardKanban({ idPaciente: pacienteSelecionado.idPaciente, coluna: el('kbNovaColuna').value, prioridade: el('kbNovoPrioridade').value, observacao: el('kbNovaObs').value });
  }

  function abrirFormKanban() { abrirNovoCardKanban(); }
  window.abrirFormKanban = abrirFormKanban;

  /* ---------- ciclo ---------- */
  function init() {
    if (!el('kbBoard')) return;
    carregarKanban();
    setInterval(function () { if (!arrastando && !atualizandoGrade && el('kbAuto') && el('kbAuto').checked && !document.querySelector('.modal.show')) carregarKanban(); }, 20000);
  }

  window.carregarKanban = carregarKanban;
  window.kbMover = function (id, coluna) { kbMover(id, coluna); };
  window.kbAbrirCard = kbAbrirCard;
  window.kbSalvarCard = kbSalvarCard;
  window.kbRemover = kbRemover;
  window.abrirNovoCardKanban = abrirNovoCardKanban;
  window.kbBuscarPaciente = kbBuscarPaciente;
  window.kbEscolherPaciente = kbEscolherPaciente;
  window.kbSalvarNovoCard = kbSalvarNovoCard;
  window.kbCarregarLeitos = kbCarregarLeitos;
  window.kbInternar = kbInternar;
  window.kbAbrirProntuario = kbAbrirProntuario;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
