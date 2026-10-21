const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/gilia/AppData/Local/Temp/opencode/CCO_CENSO.xlsx', { cellDates: true });
const ws = wb.Sheets['CENSO'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
const uniq = c => [...new Set(rows.slice(3).map(r => String(r[c] ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
const out = { proc1: uniq(5), proc2: uniq(6), indicacoes: uniq(8), sala: uniq(10), anestesia: uniq(17), antibiotico: uniq(20), checklist: uniq(22), igcl: uniq(4), sexo: uniq(28), pele: uniq(30), amamentacao: uniq(31).filter(x => x.length <= 20) };
console.log(JSON.stringify(out, null, 1));
