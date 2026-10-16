const { query } = require('./db');
async function registrarLog(clientOuNull, usuario, acao, detalhe) {
  try {
    await (clientOuNull || { query }).query('INSERT INTO logs (usuario, acao, detalhes) VALUES ($1,$2,$3)', [usuario || 'Sistema', acao, detalhe || '']);
  } catch (e) { console.error('Erro ao gravar log:', e.message); }
}
module.exports = { registrarLog };
