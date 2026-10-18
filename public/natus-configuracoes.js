/* Configurações — matriz de visibilidade do menu lateral por perfil (exclusiva do Administrador).
   Só controla EXIBIÇÃO (UX): as permissões de rota permanecem no servidor. */
(function () {
  'use strict';
  var estado = { matriz: null, ocupado: false };

  function q(id) { return document.getElementById(id); }
  function esc(v) { return (window.NatusEscape && NatusEscape.html) ? NatusEscape.html(v) : String(v == null ? '' : v); }
  function token() { return (window.CFG && window.CFG.token) || ''; }
  function status(htmlTxt, tipo) {
    var el = q('statusPermissoes');
    if (!el) return;
    if (!htmlTxt) { el.classList.add('d-none'); el.innerHTML = ''; return; }
    el.className = 'alert alert-' + (tipo || 'light') + ' border small mt-3 mb-0';
    el.innerHTML = htmlTxt;
  }

  function carregar() {
    status('<span class="spinner-border spinner-border-sm me-2"></span>Carregando a matriz de permissões...', 'light');
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function (e) { status('<i class="bi bi-exclamation-triangle me-1"></i>' + esc(e && e.message ? e.message : e), 'danger'); })
      .obterMatrizPermissoesMenu(token());
  }

  function celula(perfil, mod) {
    var valores = (estado.matriz && estado.matriz.valores) || {};
    var elegiveis = (estado.matriz && estado.matriz.elegiveis) || {};
    if (!(elegiveis[perfil] && elegiveis[perfil][mod.chave])) {
      return '<td class="text-center text-muted" title="O perfil não acessa este módulo">&mdash;</td>';
    }
    var marcado = !(valores[perfil] && valores[perfil][mod.chave] === false);
    var fixo = String(perfil).trim().toLowerCase() === 'administrador';
    return '<td class="text-center"><input type="checkbox" class="form-check-input"' +
      (marcado ? ' checked' : '') + (fixo ? ' disabled' : '') +
      ' data-perfil="' + esc(perfil) + '" data-chave-menu="' + esc(mod.chave) + '"' +
      ' aria-label="' + esc(mod.rotulo + ' para ' + perfil) + '"></td>';
  }

  function render(m) {
    estado.matriz = m || {};
    var perfis = estado.matriz.perfis || [];
    var modulos = estado.matriz.modulos || [];
    var contador = q('contadorPerfis');
    if (contador) contador.textContent = perfis.length + (perfis.length === 1 ? ' perfil' : ' perfis');

    var head = q('tabela-permissoes-head');
    if (head) head.innerHTML = '<tr><th style="min-width:260px">Módulo / botão</th>' +
      perfis.map(function (p) { return '<th class="text-center">' + esc(p) + '</th>'; }).join('') + '</tr>';

    var linhas = [], grupo = null;
    modulos.forEach(function (mod) {
      if (mod.grupo !== grupo) {
        grupo = mod.grupo;
        linhas.push('<tr class="table-light"><td colspan="' + (perfis.length + 1) + '" class="fw-bold text-uppercase small text-muted">' + esc(grupo) + '</td></tr>');
      }
      linhas.push('<tr><td><div class="fw-semibold">' + esc(mod.rotulo) + '</div><div class="small text-muted"><code>' + esc(mod.chave) + '</code></div></td>' +
        perfis.map(function (p) { return celula(p, mod); }).join('') + '</tr>');
    });

    var body = q('tabela-permissoes-body');
    if (body) body.innerHTML = linhas.join('') || '<tr><td class="text-center text-muted py-4">Nenhum módulo disponível.</td></tr>';
    status('');
  }

  function finalizar(input) { estado.ocupado = false; if (input) input.disabled = false; }

  function salvar(perfil, modulo, visivel, input) {
    if (estado.ocupado) { if (input) input.checked = !visivel; return; }
    estado.ocupado = true;
    if (input) input.disabled = true;
    status('<span class="spinner-border spinner-border-sm me-2"></span>Salvando...', 'light');
    google.script.run
      .withSuccessHandler(function () {
        if (estado.matriz && estado.matriz.valores && estado.matriz.valores[perfil]) estado.matriz.valores[perfil][modulo] = visivel;
        status('<i class="bi bi-check-circle me-1"></i>' + esc(perfil) + ' · ' + esc(modulo) + ': ' + (visivel ? 'exibido' : 'ocultado') + '.', 'success');
        finalizar(input);
      })
      .withFailureHandler(function (e) {
        if (input) input.checked = !visivel;   // desfaz a marcação otimista
        status('<i class="bi bi-exclamation-triangle me-1"></i>' + esc(e && e.message ? e.message : e), 'danger');
        finalizar(input);
      })
      .atualizarPermissaoMenu(token(), { perfil: perfil, modulo_chave: modulo, visivel: visivel });
  }

  // Delegação: um único ouvinte cobre toda a matriz (sem handlers inline).
  document.addEventListener('change', function (e) {
    var alvo = e.target;
    if (!alvo || typeof alvo.matches !== 'function') return;
    if (!alvo.matches('#tabela-permissoes-body input[data-chave-menu]')) return;
    salvar(alvo.getAttribute('data-perfil'), alvo.getAttribute('data-chave-menu'), alvo.checked, alvo);
  });

  window.carregarPermissoesMenu = carregar;
  window.salvarPermissao = function (perfil, modulo, visivel) { salvar(perfil, modulo, visivel === true, null); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', carregar); else carregar();
})();
