/* Escape por contexto; dados continuam brutos no estado e nos formulários. */
(function () {
  const html = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Conteúdo de string JavaScript dentro de atributo HTML entre aspas.
  const js = v => html(JSON.stringify(String(v == null ? '' : v)).slice(1,-1)
    .replace(/'/g,'\\u0027').replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026'));
  window.NatusEscape = { html, js };
})();
