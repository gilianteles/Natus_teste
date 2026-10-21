const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/gilia/AppData/Local/Temp/opencode/CCO_CENSO.xlsx', { cellDates: true, cellFormula: true });
console.log('SHEETS:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  console.log('\n===== SHEET', name, 'REF', ws['!ref'], '=====');
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
  console.log('ROWS', rows.length);
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i];
    const cells = r.map((v, c) => v !== '' ? c + ':' + String(v).replace(/\s+/g, ' ').slice(0, 70) : null).filter(Boolean);
    if (cells.length) console.log(i + 1, JSON.stringify(cells));
  }
  const merges = (ws['!merges'] || []).slice(0, 40).map(m => XLSX.utils.encode_range(m));
  if (merges.length) console.log('MERGES', JSON.stringify(merges));
}
