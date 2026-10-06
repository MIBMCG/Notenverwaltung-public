// Regression: report scope follows performance metadata without changing the grade-sheet examples.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');
const context={console,globalThis:{},matchMedia:()=>({matches:false,addEventListener(){}}),root:{addEventListener(){}},main:{querySelectorAll(){return []}},nav:{},modal:{},document:{}};
context.globalThis=context;
vm.createContext(context);
const start=source.indexOf('const icon=');
const end=source.indexOf('function transferView()',start);
vm.runInContext(source.slice(start,end),context,{filename:'report-scope-base.fragment.js'});
const workStart=source.indexOf('const work=');
const workEnd=source.indexOf('function adminClick',workStart);
vm.runInContext(source.slice(workStart,workEnd)+'\nglobalThis.reportApi={state,extra,work,pupils,h2Example,upperRows,performanceList,reportModel,currentReportSections,reportView,performanceView,admin,adminReports,numericGrade,pointValue};',context,{filename:'report-scope-work.fragment.js'});
const api=context.reportApi;

// Removing this projection, or calculating from the fixed column order, must fail these hand-checked values.
api.state.course='bio';
let model=api.reportModel(0,['H1']);
assert.equal(model.sections[0].result,1.75,'H1 uses visible M1=2, M2=3 and Test=1 at the labeled 50/50 example weights');
api.performanceList('bio','H1')[2].report=false;
model=api.reportModel(0,['H1']);
assert.equal(model.sections[0].result,2.5,'hiding the written seed removes it before the category result is calculated');
api.performanceList('bio','H1')[0].report=false;
model=api.reportModel(0,['H1']);
assert.equal(model.sections[0].result,3,'the remaining visible oral seed retains its source score after another seed is hidden');
api.performanceList('bio','H1')[1].report=false;
model=api.reportModel(0,['H1']);
assert.ok(Number.isNaN(model.sections[0].result),'an all-hidden report has no invented zero or stale result');

// Reset the deliberately hidden seeds, then prove source id and source term survive list changes.
const h1=api.performanceList('bio','H1');
h1.forEach(p=>p.report=true);
h1.splice(0,1);
assert.equal(api.reportModel(0,['H1']).sections[0].entries.find(e=>e.performance.id===1).raw,3,'deleting seed 0 does not shift M2 onto M1\'s score');
h1.push({id:'new-1',name:'Neue Leistung',category:0,date:'2026-09-15',term:'H1',sourceTerm:null,weight:1,report:true,seed:false});
assert.equal(api.reportModel(0,['H1']).sections[0].entries.at(-1).raw,'','a new performance has no invented score');
const moved=h1.find(p=>p.id===2);moved.name='<Test umbenannt>';moved.date='2026-10-11';moved.term='H2';
const movedSection=api.reportModel(0,['H2']).sections[0];
assert.equal(movedSection.entries.find(e=>e.performance.id===2).raw,1,'a displayed-term edit retains the original source value');
api.extra.reportTerm='h2';
assert.match(api.currentReportSections(0),/&lt;Test umbenannt&gt;[\s\S]*2026-10-11/,'the paper escapes renamed metadata and reflects its date');

// H2 is an annual report scope: visible H1 and H2 entries are pooled before category means.
api.state.course='math';
const mathH1=api.performanceList('math','H1'),mathH2=api.performanceList('math','H2');
mathH1.forEach(p=>p.report=true);mathH2.forEach(p=>p.report=true);
let annual=api.reportModel(0,['H2']).sections[0];
assert.equal(annual.result,1.875,'H2 annual value pools H1 [2,3,1] and H2 [2,2,2], not semester means');
mathH1.find(p=>p.id===2).report=false;
annual=api.reportModel(0,['H2']).sections[0];
assert.equal(annual.result,2.125,'a hidden H1 written value cannot leak into the H2 annual value');
assert.equal(api.reportModel(0,['H2']).sections[0].entries.find(e=>e.performance.id===0).raw,2,'H2 fixture supplies its fixed fictional values');

// Upper-secondary context remains independent of report projection and treats 0 as valid.
api.state.course='upper';api.extra.upperTerm='Q3';api.extra.courseType='basic';
const q3=api.performanceList('upper','Q3'),q4=api.performanceList('upper','Q4');q3.forEach(p=>p.report=true);q4.forEach(p=>p.report=true);
let upper=api.reportModel(1,['Q3']).sections[0];
assert.equal(upper.categoryMeans[0],2,'0 points is a valid oral value, while F/E/blank would not be zero');
assert.ok(Math.abs(upper.result-7/3)<1e-12,'upper report uses the labeled 2/3 oral and 1/3 written example weights');
api.extra.upperTerm='Q4';
upper=api.reportModel(1,['Q4']).sections[0];
assert.equal(upper.result,4.5,'Q4 basic non-exam excludes the written category, not merely a column slot');
assert.equal(upper.entries.find(e=>e.performance.category===1).raw,3,'excluded Q4 written raw context stays present for disclosure');
q3[0].report=false;
assert.equal(q4[0].report,true,'Q3 report visibility is isolated from Q4');
const courseBefore=api.state.course,termBefore=api.extra.upperTerm,rawBefore=JSON.stringify(api.upperRows);
api.reportModel(1,['Q3','Q4']);
assert.equal(api.state.course,courseBefore,'report projection does not change the selected course');
assert.equal(api.extra.upperTerm,termBefore,'report projection does not change the selected upper term');
assert.equal(JSON.stringify(api.upperRows),rawBefore,'report projection does not mutate grade-sheet raw arrays');

// Full renderer routes keep excluded names outside the paper and retain the H1 scope for H2 annual reporting.
api.state.course='math';mathH1.forEach(p=>p.report=true);mathH2.forEach(p=>p.report=true);
mathH1.find(p=>p.id===1).name='H1 verborgen';mathH1.find(p=>p.id===1).report=false;
mathH2.find(p=>p.id===0).sub='<H2-Unterkategorie>';
api.extra.reportPreview=true;api.extra.reportScope='person';api.extra.reportPerson='0';api.extra.reportTerm='h2';
let rendered=api.reportView(),paperStart=rendered.indexOf('<article class="hwg-paper">'),paperEnd=rendered.indexOf('</article>',paperStart),paper=rendered.slice(paperStart,paperEnd),outside=rendered.slice(0,paperStart);
const scopeText=outside.replace(/<[^>]+>/g,'');
assert.ok(rendered.indexOf('hwg-report-scope')<paperStart,'explicit H2 scope card precedes its paper');
assert.match(paper,/Auswahl: 2026\/27 H2/,'explicit H2 preview has an H2 header');
assert.match(paper,/feste fiktive Beispieldaten/,'H2 paper discloses its fixed fictional fixture');
assert.match(paper,/&lt;H2-Unterkategorie&gt;/,'the paper escapes and renders editable subcategory metadata');
assert.doesNotMatch(paper,/Berichtsumfang|H1 verborgen/,'the paper excludes the scope summary and hidden performance names');
assert.match(scopeText,/H1: 2 enthalten · 1 ausgeblendet: H1 verborgen/,'H2 annual scope reports the relevant H1 count and hidden name outside the paper');
assert.match(scopeText,/H2: 3 enthalten · 0 ausgeblendet/,'H2 annual scope also reports its H2 count outside the paper');
assert.match(paper,/Gesamtdurchschnitt: 1,75/,'hidden H1 data changes the annual H2 result before rendering');
mathH1.find(p=>p.id===1).report=true;
rendered=api.reportView();
assert.match(rendered,/Gesamtdurchschnitt: 1,88/,'initial explicit H2 route uses the H1 plus H2 annual result');
api.extra.reportTerm='all';rendered=api.reportView();
assert.match(rendered,/Mathematik · H2[\s\S]*Gesamtdurchschnitt: 1,88/,'initial all route applies the same H1 plus H2 annual aggregation');
assert.ok(rendered.indexOf('hwg-report-scope')<rendered.indexOf('<article class="hwg-paper">'),'all-route scope card precedes its paper');
assert.match(api.performanceView(),/data-action="print"/,'performance management links directly to existing report preparation');
api.admin.reportIds=[0];
assert.match(api.adminReports(),/Kurzbericht[\s\S]*nicht der ausgewählte ausführliche Leistungsbericht/,'admin renderer labels its separate short report scope');
console.log('Report scope OK: metadata-driven detailed scope, annual H2 and upper context are covered.');
