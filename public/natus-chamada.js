/* FASE 6 — Painel de atendimento em tempo real (TV/recepção)
 *  - Atualiza a "chamada atual" e a lista de "últimas chamadas" por polling (a cada 4s);
 *  - Anuncia a nova chamada por voz (speechSynthesis) e um alerta sonoro leve;
 *  - Console do operador (quando autenticado): chamar próxima, chamar/rechamar e finalizar.
 * Leitura pública: a API devolve apenas o primeiro nome (privacidade/LGPD). */
(function () {
  'use strict';
  var CFG = window.CHAMADA || {};
  var INTERVALO = 4000;
  var ultimoId = '', somLigado = true, ctxAudio = null, dadosAtuais = null;

  var el = function (id) { return document.getElementById(id); };
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var chamar = function (nome, args) { return new Promise(function (res, rej) { window.google.script.run.withSuccessHandler(res).withFailureHandler(rej)[nome].apply(null, args); }); };

  function toast(msg, tipo) {
    var box = el('tvToasts');
    if (!box) return;
    var id = 'toast' + Date.now();
    var cls = tipo === 'erro' ? 'text-bg-danger' : (tipo === 'ok' ? 'text-bg-success' : 'text-bg-secondary');
    box.insertAdjacentHTML('beforeend',
      '<div id="' + id + '" class="toast align-items-center ' + cls + '" role="alert"><div class="d-flex"><div class="toast-body">' + esc(msg) + '</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div></div>');
    var t = window.bootstrap && new bootstrap.Toast(el(id), { delay: 4000 });
    if (t) t.show();
  }

  /* ---------- relógio ---------- */
  function relogio() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    var c = el('tvClock'); if (c) c.textContent = p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- alerta sonoro + voz ---------- */
  function habilitarAudio() {
    if (ctxAudio) return;
    try { ctxAudio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctxAudio = null; }
  }
  function tocarAlerta() {
    if (!somLigado) return;
    habilitarAudio();
    if (!ctxAudio) return;
    try {
      var o = ctxAudio.createOscillator(), g = ctxAudio.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctxAudio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctxAudio.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + 0.7);
      o.connect(g); g.connect(ctxAudio.destination);
      o.start(); o.stop(ctxAudio.currentTime + 0.75);
    } catch (e) {}
  }
  function falar(c) {
    if (!somLigado || !('speechSynthesis' in window) || !c) return;
    try {
      var texto = 'Senha ' + (c.senha ? c.senha.split('').join(' ') : '') + '. ' + (c.nome || '') +
        '.' + (c.consultorio || c.destino || c.setor ? ' Compareça a ' + (c.consultorio || c.destino || c.setor) + '.' : '');
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR'; u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  /* ---------- renderização ---------- */
  function renderAtual(atual) {
    var semChamada = !atual;
    el('tvSenha').textContent = semChamada ? '—' : atual.senha;
    el('tvNome').textContent = semChamada ? 'Aguardando chamada…' : atual.nome;
    el('tvDestino').textContent = semChamada ? '—' : (atual.consultorio || atual.destino || atual.setor || 'Recepção');
    el('tvHora').textContent = semChamada ? '' : (atual.repeticoes > 1 ? 'Chamada repetida (' + atual.repeticoes + 'ª vez) · ' : '') + atual.chamadoEm;
    el('tvAtual').classList.toggle('sem-chamada', semChamada);
  }
  function renderUltimas(lista) {
    var ul = el('tvUltimas');
    if (!lista || !lista.length) { ul.innerHTML = '<li class="tv-vazio">Sem chamadas recentes</li>'; return; }
    ul.innerHTML = lista.map(function (c) {
      return '<li><span class="tv-u-senha">' + esc(c.senha) + '</span>' +
        '<span class="tv-u-nome">' + esc(c.nome) + '</span>' +
        '<span class="tv-u-dest">' + esc(c.consultorio || c.destino || c.setor || '—') + '</span></li>';
    }).join('');
  }

  function atualizar() {
    chamar('obterPainelChamadas', [{}]).then(function (d) {
      dadosAtuais = d || {};
      renderAtual(dadosAtuais.atual);
      renderUltimas(dadosAtuais.ultimas);
      el('tvAtualizado').textContent = 'Atualizado ' + (dadosAtuais.geradoEm || '');
      var novoId = dadosAtuais.atual && dadosAtuais.atual.idChamada;
      // Nova chamada (ou rechamada): anuncia por som e voz.
      if (novoId && novoId !== ultimoId) {
        ultimoId = novoId;
        tocarAlerta();
        setTimeout(function () { falar(dadosAtuais.atual); }, 500);
      }
    }).catch(function () {
      el('tvAtualizado').textContent = 'Sem conexão — tentando novamente…';
    });
  }

  /* ---------- console do operador ---------- */
  var ROTULO_RISCO = { Vermelho: 'Vermelho', Laranja: 'Laranja', Amarelo: 'Amarelo', Verde: 'Verde', Azul: 'Azul' };
  function corRisco(r) { return { Vermelho: 'bg-danger', Laranja: 'bg-warning text-dark', Amarelo: 'bg-warning-subtle text-dark', Verde: 'bg-success', Azul: 'bg-secondary' }[r] || 'bg-secondary'; }

  function carregarConsole() {
    if (!CFG.autenticado) return;
    chamar('listarFilaChamada', []).then(function (d) {
      var fila = (d && d.fila) || [], recentes = (d && d.recentes) || [];
      var setores = {};
      fila.forEach(function (f) { if (f.destino) setores[f.destino] = 1; });
      var dl = el('tvSetores');
      if (dl) dl.innerHTML = Object.keys(setores).map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');
      var tb = el('tvFilaBody');
      tb.innerHTML = fila.length ? fila.map(function (f) {
        return '<tr><td><b>' + esc(f.nome) + '</b></td>' +
          '<td><span class="badge ' + corRisco(f.risco) + '">' + esc(ROTULO_RISCO[f.risco] || f.risco || '—') + '</span></td>' +
          '<td>' + esc(f.destino || '—') + '</td><td>' + f.minutosEspera + ' min</td>' +
          '<td class="text-end"><button class="btn btn-sm btn-natus" data-chamar-at="' + esc(f.idAtendimento) + '"><i class="bi bi-megaphone"></i> Chamar</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">Nenhum paciente aguardando agora.</td></tr>';
      var rb = el('tvRecentesBody');
      rb.innerHTML = recentes.length ? recentes.map(function (c) {
        return '<tr><td><b>' + esc(c.senha) + '</b></td><td>' + esc(c.nome) + '</td><td>' + esc(c.consultorio || c.destino || c.setor || '—') + '</td>' +
          '<td>' + esc(c.status) + (c.repeticoes > 1 ? ' (' + c.repeticoes + 'x)' : '') + '</td>' +
          '<td class="text-end"><button class="btn btn-sm btn-light" data-rechamar="' + esc(c.idChamada) + '"' + (c.status !== 'Ativa' ? '' : '') + '><i class="bi bi-arrow-repeat"></i> Rechamar</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">Sem chamadas hoje.</td></tr>';
    }).catch(function (e) { toast(e && e.message ? e.message : 'Não foi possível carregar a fila.', 'erro'); });
  }

  function chamarProxima(extra) {
    var dados = Object.assign({ setor: (el('tvSetor') || {}).value || CFG.setorUsuario || '', consultorio: (el('tvSala') || {}).value || '' }, extra || {});
    chamar('chamarProximo', [dados]).then(function () {
      toast('Chamada enviada para a TV.', 'ok');
      atualizar(); carregarConsole();
    }).catch(function (e) { toast(e && e.message ? e.message : 'Falha ao chamar.', 'erro'); });
  }

  document.addEventListener('click', function (ev) {
    var alvo = ev.target.closest ? ev.target.closest('[data-chamar-at],[data-rechamar]') : null;
    if (!alvo) return;
    if (alvo.hasAttribute('data-chamar-at')) {
      chamarProxima({ idAtendimento: alvo.getAttribute('data-chamar-at') });
    } else if (alvo.hasAttribute('data-rechamar')) {
      chamar('rechamar', [{ idChamada: alvo.getAttribute('data-rechamar') }]).then(function () {
        toast('Chamada repetida.', 'ok'); atualizar(); carregarConsole();
      }).catch(function (e) { toast(e && e.message ? e.message : 'Falha ao rechamar.', 'erro'); });
    }
  });

  /* ---------- inicialização ---------- */
  function iniciar() {
    relogio(); setInterval(relogio, 15000);
    atualizar(); setInterval(atualizar, INTERVALO);

    if (el('tvFormChamar')) el('tvFormChamar').addEventListener('submit', function (e) { e.preventDefault(); chamarProxima(); });

    if (CFG.autenticado) {
      var btn = el('tvConsoleBtn'); if (btn) btn.classList.remove('d-none');
      var modal = el('tvConsoleModal');
      if (modal) modal.addEventListener('show.bs.modal', carregarConsole);
      var st = el('tvSetor'); if (st && !st.value) st.value = CFG.setorUsuario || '';
      el('tvRodapeSetor').textContent = 'Operador: ' + (CFG.operador || '') + (CFG.setorUsuario ? ' · ' + CFG.setorUsuario : '');
    }

    var btSom = el('tvSomToggle');
    if (btSom) btSom.addEventListener('click', function () {
      somLigado = !somLigado;
      btSom.innerHTML = '<i class="bi ' + (somLigado ? 'bi-volume-up-fill' : 'bi-volume-mute-fill') + '"></i>';
      if (somLigado) { habilitarAudio(); tocarAlerta(); }
    });
    // Desbloqueia o áudio no primeiro clique (política de autoplay dos navegadores).
    document.addEventListener('click', habilitarAudio, { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
