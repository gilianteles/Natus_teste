const XLSX=require('xlsx');
const wb=XLSX.readFile('C:/Users/gilia/Downloads/CCO_CENSO - 2026.xlsx',{cellDates:true});
const ws=wb.Sheets['CENSO'];
const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
const cols=[4,5,6,7,8,10,17,22,27,28,30,31,42];
for(const c of cols){const m=new Map();for(const r of rows.slice(3)){const v=String(r[c]??'').trim();if(!v)continue;m.set(v,(m.get(v)||0)+1);}const top=[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,40);console.log('COL',c,'UNIQUE',m.size,JSON.stringify(top));}
