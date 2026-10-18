/* Camada de compatibilidade: reproduz a API google.script.run do Apps Script sobre fetch (/api/rpc/<função>). */
(function () {
  async function chamar(nome, args) {
    // Limite restrito à troca de leito; não muda os demais RPCs.
    const controle = nome === 'trocarLeito' ? new AbortController() : null;
    const timer = controle ? setTimeout(() => controle.abort(), 35000) : null;
    try {
      let resp;
      try {
        resp = await fetch('/api/rpc/' + encodeURIComponent(nome), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Natus-Request': '1', 'X-Natus-CSRF': (document.querySelector('meta[name="natus-csrf"]') || {}).content || '' },
          body: JSON.stringify({ args: args }),
          ...(controle ? { signal: controle.signal } : {})
        });
      } catch (e) {
        if (controle) throw new Error('Não foi possível confirmar a troca com o servidor. Ela pode ter sido concluída. Confira os leitos atualizados antes de tentar novamente.');
        throw new Error('Sem conexão com o servidor. Verifique a internet e tente novamente.');
      }
      let corpo = null;
      try { corpo = await resp.json(); } catch (e) {}
      if (resp.status === 401 && nome !== 'autenticar' && nome !== 'encerrarSessao') {
        try { sessionStorage.clear(); } catch (e) {}
        window.top.location.href = '/?view=login';
      }
      if (!resp.ok || !corpo || corpo.ok !== true) throw new Error((corpo && corpo.error) ||
        (controle ? 'Resposta não confirmada. A troca pode ter sido concluída. Confira os leitos antes de tentar novamente.' : 'Falha na comunicação com o servidor.'));
      return corpo.data;
    } finally { if (timer !== null) clearTimeout(timer); }
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
