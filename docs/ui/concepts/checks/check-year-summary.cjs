const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

const dividerRule=(source.match(/\.hwg-table \.hwg-year-group-start\{([^}]+)\}/)||[])[1]||'';
assert.match(dividerRule,/box-shadow:[^;]*var\(--hwg-year-edge-dark\)[^;]*var\(--hwg-year-edge-light\)[^;]*var\(--hwg-year-edge-dark\)/,'Year boundaries use a continuous dark-light-dark neutral edge over every cell background.');
assert.doesNotMatch(dividerRule,/--hwg-accent|border|padding|width/,'The year divider is palette-independent and does not change table geometry.');
const edgeDark=(source.match(/--hwg-year-edge-dark:#([0-9a-f]{6})/i)||[])[1],edgeLight=(source.match(/--hwg-year-edge-light:#([0-9a-f]{6})/i)||[])[1];
assert.ok(edgeDark&&edgeLight,'Both neutral year-divider edge tokens exist.');
const luminance=hex=>{const channels=hex.match(/../g).map(pair=>parseInt(pair,16)/255).map(value=>value<=.03928?value/12.92:((value+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
const contrast=(a,b)=>{const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);};
const cellBackgrounds=[...source.matchAll(/--hwg-(?:panel|grade-[1-6]):#([0-9a-f]{6})/gi)].map(match=>match[1]);
assert.ok(cellBackgrounds.length>=15,'The boundary contrast check covers family panels and both grade palettes.');
for(const background of cellBackgrounds)assert.ok(Math.max(contrast(edgeDark,background),contrast(edgeLight,background))>=3,`At least one neutral divider edge has 3:1 contrast against #${background}.`);

assert.match(source,/function summarizeYear\s*\(/,'The concept needs a pure annual-summary function.');

const start=source.indexOf('const state=');
const end=source.indexOf('const settingItems=',start);
assert.ok(start>=0&&end>start,'Could not isolate the real grade renderer.');
const context={
  icon:()=>'',
  esc:value=>String(value),
  upperGrades:()=>'<section>SEK-II-Q-AUSWAHL</section>',
  fmt:n=>Number.isFinite(n)?n.toFixed(2).replace('.',','):'–',
  globalThis:null
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(source.slice(start,end)+';globalThis.yearApi={summarizeYear,yearGradeView,grades,state,pupils};',context);
const {summarizeYear,yearGradeView,grades,state,pupils}=context.yearApi;

const h1=['2','4','3'],h2=['1','','1'];
const h1Before=[...h1],h2Before=[...h2];
const result=summarizeYear(h1,h2);
assert.ok(Math.abs(result.oral-7/3)<1e-10);
assert.equal(result.written,2);
assert.ok(Math.abs(result.total-13/6)<1e-10);
assert.equal(result.oralCount,3);
assert.equal(result.writtenCount,2);
assert.deepEqual(h1,h1Before,'Annual calculation must not mutate H1 inputs.');
assert.deepEqual(h2,h2Before,'Annual calculation must not mutate H2 inputs.');
assert.ok(Number.isNaN(summarizeYear(['','F','E'],['','','']).total));
assert.equal(summarizeYear(['2','','E'],['3','F','']).total,2.5);
assert.equal(summarizeYear(['0','7','2'],['F','E','']).total,2,'Sek-I 0 and invalid raw values are not grades.');

state.course='bio';state.gradeTab='current';
const current=grades();
state.gradeTab='year';
const year=grades();
assert.match(current,/hwg-score/,'H1 remains the editable grade table.');
assert.match(year,/Gesamtes Schuljahr · H1 \+ H2/);
assert.match(year,/H2: feste fiktive Beispieldaten; H1 aus der Eingabe\. Keine Zeugnisfestsetzung\./);
assert.match(year,/H2-Einzelwerte/,'The annual view exposes the fixed H2 source values.');
assert.match(year,/data-grade-color="[1-6]"/,'Annual values use the established grade colors.');
assert.match(year,/<small style="color:inherit">H2-Einzelwerte:/,'Details in colored annual cells inherit the grade ink.');
assert.doesNotMatch(year,/data-grade-color=""/,'Empty annual values stay neutral and retain the theme text color.');
assert.match(year,/data-grade-tab="current"/,'The annual view has a path back to editable H1 grades.');
const yearBody=(year.match(/<tbody>([\s\S]*?)<\/tbody>/)||[])[1]||'';
assert.equal((yearBody.match(/class="hwg-number hwg-year-group-start"/g)||[]).length,16,'Each annual row marks the real H2 and year group boundaries.');
assert.equal((year.match(/<th class="hwg-number hwg-year-group-start"/g)||[]).length,2,'The annual header marks the same H2 and year boundaries.');
assert.notEqual(year,current,'The annual tab cannot reuse the H1 renderer.');
const beforeChange=year;
pupils[0][2][0]='6';
assert.notEqual(yearGradeView(),beforeChange,'H1 edits are reflected in the annual view.');
state.gradeTab='archive';
assert.match(grades(),/Archiv · 2\. Halbjahr 2025\/26/,'Archive remains a separate renderer.');
state.course='upper';state.gradeTab='year';
assert.equal(grades(),'<section>SEK-II-Q-AUSWAHL</section>','Sek II continues to use its Q-term renderer.');

console.log('Year summary OK: real calculation, separated route, H1 update, archive and Sek-II guards verified.');
