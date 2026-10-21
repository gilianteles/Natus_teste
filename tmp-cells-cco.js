const XLSX=require('xlsx');
const wb=XLSX.readFile('C:/Users/gilia/Downloads/CCO_CENSO - 2026.xlsx',{cellDates:true,cellFormula:true});
const ws=wb.Sheets['CENSO'];
for(let r=1;r<=4;r++){for(let c=40;c<=47;c++){const a=XLSX.utils.encode_cell({r:r-1,c});if(ws[a])console.log(a,JSON.stringify(ws[a]));}}
console.log('MERGES',(ws['!merges']||[]).filter(m=>m.s.r<4&&m.s.c>=24).map(m=>XLSX.utils.encode_range(m)));
