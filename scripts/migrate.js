require('../lib/tz');
const fs = require('fs'), path = require('path');
const { getPool } = require('../lib/db');
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('Schema aplicado com sucesso.');
  await getPool().end();
})().catch(e => { console.error('Falha na migração:', e.message); process.exit(1); });
