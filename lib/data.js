// Carregadores de dados (SELECT) com memoização por requisição. Devolvem objetos com as
// mesmas chaves da planilha original, para que as regras de negócio permaneçam idênticas.
const { query, selectCols } = require('./db');

function criarContexto(client) {
  const q = (t, p) => (client || { query }).query(t, p);
  const memo = new Map();
  const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  const rows = async (t, p) => (await q(t, p)).rows;
  const D = {
    q, rows,
    setores: () => once('setores', () => rows(`SELECT ${selectCols('setores')} FROM setores ORDER BY nome_setor`)),
    leitos: (setor) => once('leitos:' + (setor || '*'), () => setor
      ? rows(`SELECT ${selectCols('leitos')} FROM leitos WHERE upper(setor_nome)=upper($1) ORDER BY numero_leito, id_leito`, [setor])
      : rows(`SELECT ${selectCols('leitos')} FROM leitos ORDER BY setor_nome, numero_leito, id_leito`)),
    pacientes: (setor) => once('pac:' + (setor || '*'), () => setor
      ? rows(`SELECT ${selectCols('pacientes', 'p')} FROM pacientes p WHERE p.id_paciente IN (SELECT id_paciente FROM internacoes WHERE upper(setor_nome)=upper($1))`, [setor])
      : rows(`SELECT ${selectCols('pacientes')} FROM pacientes`)),
    internacoes: (setor) => once('int:' + (setor || '*'), async () => {
      const filtro = setor ? ' WHERE upper(setor_nome)=upper($1)' : '';
      const args = setor ? [setor] : [];
      const [ints, trocas] = await Promise.all([
        rows(`SELECT ${selectCols('internacoes')}, encerrada_em AS "Encerrada_Em" FROM internacoes${filtro} ORDER BY data_hora_entrada`, args),
        rows(`SELECT id_internacao,leito_origem,leito_destino,data_hora FROM trocas_leito${filtro} ORDER BY data_hora,id_troca`, args)
      ]);
      const porId = new Map(ints.map(i => [i.ID_Internacao, i]));
      for (const t of trocas) { const i = porId.get(t.id_internacao); if (i) (i.Trocas_Leito ||= []).push(t); }
      return ints;
    }),
    // movimentações pertencem ao setor da internação de origem (mesma semântica da planilha)
    movimentacoes: (setor) => once('mov:' + (setor || '*'), () => setor
      ? rows(`SELECT ${selectCols('movimentacoes', 'm')} FROM movimentacoes m JOIN internacoes i ON i.id_internacao=m.id_internacao WHERE upper(i.setor_nome)=upper($1) ORDER BY m.data_hora_saida`, [setor])
      : rows(`SELECT ${selectCols('movimentacoes')} FROM movimentacoes ORDER BY data_hora_saida`))
  };
  return D;
}
module.exports = { criarContexto };
