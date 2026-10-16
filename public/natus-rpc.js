/* Camada de compatibilidade: reproduz a API google.script.run do Apps Script sobre fetch (/api/rpc/<função>). */
(function () {
  function tokenAtual() {
    try { if (typeof token !== 'undefined' && token) return token; } catch (e) {}
    return new URLSearchParams(location.search).get('token') || '';
  }
  async function chamar(nome, args) {
    let resp;
    try {
      resp = await fetch('/api/rpc/' + encodeURIComponent(nome), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tokenAtual() },
        body: JSON.stringify({ args: args })
      });
    } catch (e) { throw new Error('Sem conexão com o servidor. Verifique a internet e tente novamente.'); }
    let corpo = null;
    try { corpo = await resp.json(); } catch (e) {}
    if (resp.status === 401 && nome !== 'autenticar' && nome !== 'encerrarSessao') {
      try { sessionStorage.clear(); } catch (e) {}
      window.top.location.href = '/?view=login';
    }
    if (!resp.ok || !corpo || corpo.ok !== true) throw new Error((corpo && corpo.error) || 'Falha na comunicação com o servidor.');
    return corpo.data;
  }
  function runner(ok, falha) {
    return new Proxy({}, {
      get: function (_, nome) {
        if (nome === 'withSuccessHandler') return function (f) { return runner(f, falha); };
        if (nome === 'withFailureHandler') return function (f) { return runner(ok, f); };
        if (nome === 'withUserObject') return function () { return runner(ok, falha); };
        return function () {
          const args = Array.prototype.slice.call(arguments);
          chamar(String(nome), args).then(
            function (d) { if (ok) ok(d); },
            function (e) { if (falha) falha(e); else console.error(e); });
        };
      }
    });
  }
  window.google = window.google || {};
  window.google.script = { run: runner(null, null) };
})();
