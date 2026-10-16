require('../lib/tz');
const { query } = require('../lib/db');
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await query('SELECT 1'); res.status(200).json({ ok: true, db: 'ok', tz: new Date().getTimezoneOffset() === 240 ? 'America/Manaus' : 'desvio' }); }
  catch (e) { res.status(503).json({ ok: false, db: 'indisponível' }); }
};
