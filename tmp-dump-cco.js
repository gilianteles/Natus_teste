const XLSX = require('xlsx');
const wb = XLSX.readFile('C:/Users/gilia/Downloads/CCO_CENSO - 2026.xlsx', {cellDates:true});
console.log('SHEETS:', wb.SheetNames);
const ws = wb.Sheets['CENSO'];
const ref = ws['!ref']; console.log('REF', ref);
const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:'', blankrows:false, raw:false});
console.log('ROWS', rows.length);
for (let i=0;i<Math.min(rows.length,60);i++){
  const r = rows[i];
  const cells = r.map((v,c)=> v!=='' ? c+':'+String(v).replace(/\s+/g,' ').slice(0,60) : null).filter(Boolean);
  if (cells.length) console.log(i+1, JSON.stringify(cells));
}
