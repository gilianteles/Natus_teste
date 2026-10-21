const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/gilia/AppData/Local/Temp/opencode/CCO_CENSO.xlsx', { cellDates: true });
const ws = wb.Sheets['CENSO'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
const maxc = 43;
for (let c = 0; c <= maxc; c++) {
  const h1 = String(rows[0][c] ?? '').trim();
  const h2 = String(rows[1][c] ?? '').trim();
  const h3 = String(rows[2][c] ?? '').trim();
  const m = new Map();
  for (const r of rows.slice(3)) { const v = String(r[c] ?? '').trim(); if (!v) continue; m.set(v, (m.get(v) || 0) + 1); }
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log(JSON.stringify({ col: c, h1, h2, h3, unique: m.size, top }));
}
