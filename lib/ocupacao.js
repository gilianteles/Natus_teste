const U = require('./util');
function instante(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v);
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(.*)$/);
  const d = new Date(br ? `${br[3]}-${br[2]}-${br[1]}${br[4] || 'T00:00:00'}` : (s.length === 10 ? s + 'T00:00:00' : s));
  return Number.isNaN(+d) ? null : d;
}
function saida(i, mapa) {
  const a = instante(mapa[String(i.ID_Internacao)]), b = instante(i.Encerrada_Em);
  return a && b ? (a < b ? a : b) : a || b;
}
function leitoEm(i, momento) {
  const eventos = i.Trocas_Leito || [];
  let leito = eventos.length ? eventos[0].leito_origem : i.ID_Leito;
  for (const e of eventos) { if (+instante(e.data_hora) > +momento) break; leito = e.leito_destino; }
  return String(leito || '').trim();
}
function leitoNoCenso(i, dia) {
  const s = String(dia), limite = new Date(+s.slice(0,4), +s.slice(4,6)-1, +s.slice(6,8)+1);
  return leitoEm(i, new Date(+limite - 1));
}
module.exports = { instante, saida, leitoEm, leitoNoCenso };
