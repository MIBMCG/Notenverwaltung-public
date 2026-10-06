const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

function button(dataset={}){return {dataset,classList:{contains:()=>false},hasAttribute:()=>false};}
function createRuntime(program=source){
 const events={},rendered=[],toast={textContent:'',hidden:true},pupils=[['Becker, Emil']],upperRows=[];
 let replaceChecked=false;const main={querySelector:selector=>selector==='#hwg-replace-confirm'?{checked:replaceChecked}:({checked:true})};
 const state={tool:'import',page:'tools'},extra={flowStep:1,flowDone:false,scenario:'match',decision:'skip',exportScope:'all',exportFormat:'excel',merge:'merge'};
 const context={state,extra,root:{addEventListener:(type,listener)=>events[type]=listener,querySelector:selector=>selector==='.hwg-toast'?toast:null},main,modal:{close:()=>{}},security:{locked:false},nav:{classList:{remove:()=>{}}},
  heading:(title,subtitle,body)=>`${title}|${subtitle}|${body}`,btn:(label,action)=>{const b=button({action});rendered.push({label,b});return `<button data-action="${action}">${label}</button>`;},
  courseName:()=>'<Biologie>',courseClass:()=>'10a',wSelect:()=>'',wField:()=>'',noteBox:text=>`<aside>${text}</aside>`,detailRows:rows=>rows.map(row=>row.join('|')).join('\n'),sampleTable:(head,rows)=>`<table>${rows.join('')}</table>`,esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
  pupils,upperRows,notice:text=>{toast.textContent=text;toast.hidden=false;},openDialog:(title,body)=>context.dialog={title,body},icons:()=>{},canNavigate:()=>true,securityClick:()=>false,adminClick:()=>false,workflowClick:()=>false,applyDesign:()=>{},bindCourseCards:()=>{},paintGrades:()=>{},pages:[],nav:null,matchMedia:()=>({matches:false}),globalThis:null};
 context.globalThis=context;context.nav={classList:{remove:()=>{}}};vm.createContext(context);
 const scenarioStart=program.indexOf('const csvImportScenarios='),transferStart=program.indexOf('function transferView()'),workStart=program.indexOf('const work=',transferStart),securityStart=program.indexOf('function securityClick'),securityEnd=program.indexOf("modal.addEventListener",securityStart),clickStart=program.indexOf("root.addEventListener('click'"),changeStart=program.indexOf("root.addEventListener('change'",clickStart);
 assert.ok(scenarioStart>=0&&transferStart>scenarioStart&&workStart>transferStart&&clickStart>=0&&changeStart>clickStart,'Could not isolate active CSV renderer and delegated click path.');
 vm.runInContext(program.slice(scenarioStart,workStart),context);
 context.render=()=>{context.markup=context.transferView();};
 vm.runInContext(program.slice(securityStart,securityEnd),context);
 vm.runInContext(program.slice(clickStart,changeStart),context);
 context.render();
 return {context,state,extra,toast,pupils,upperRows,get replaceChecked(){return replaceChecked;},set replaceChecked(value){replaceChecked=value;},markup:()=>context.markup,render:context.render,click:b=>events.click({target:{closest:selector=>selector==='button'?b:null}}),change:target=>events.change({target}),action:action=>rendered.filter(item=>item.b.dataset.action===action).at(-1)?.b};
}
function snapshot(runtime){return JSON.stringify({state:runtime.state,extra:runtime.extra});}

const runtime=createRuntime();
assert.match(runtime.markup(),/Vorhandener Schüler eindeutig erkannt/,'The active importer names the compatible-person scenario in teacher-facing language.');
assert.match(runtime.markup(),/Widersprüchliche Angaben zu einer Person/,'The active importer names the identity conflict without internal jargon.');
assert.match(runtime.markup(),/Person nicht eindeutig zuzuordnen/,'The active importer explains the ambiguity as a concrete assignment problem.');
assert.match(runtime.markup(),/Widersprüchliche Angaben zum Kurs/,'The active importer names the upper-secondary course conflict in teacher-facing language.');

const peopleBefore=JSON.stringify({pupils:runtime.pupils,upperRows:runtime.upperRows});runtime.click(runtime.action('flow-check'));
assert.match(runtime.markup(),/Becker, Emil/,'The delegated check exposes the matched identity.');
assert.match(runtime.markup(),/vorhandene Person/,'A unique identity match uses an existing person rather than creating a duplicate.');
runtime.change({dataset:{flowField:'scenario'},value:'warning'});assert.equal(runtime.extra.scenario,'match','A stale scenario change in checked step 2 is ignored.');runtime.click(button({action:'flow-confirm'}));assert.equal(runtime.extra.flowDone,false,'A stale confirmation in checked step 2 cannot simulate success.');
runtime.click(runtime.action('flow-next'));assert.equal(runtime.extra.flowStep,3,'A checked compatible import may reach explicit confirmation.');
runtime.change({dataset:{flowField:'scenario'},value:'warning'});assert.equal(runtime.extra.scenario,'match','A stale scenario change in confirmation step 3 is ignored.');assert.doesNotMatch(runtime.markup(),/fehlendem Namen/,'Confirmation remains bound to the checked compatible scenario.');
runtime.click(runtime.action('flow-confirm'));assert.equal(runtime.extra.flowDone,true,'Only explicit confirmation reaches the simulation result.');
assert.equal(JSON.stringify({pupils:runtime.pupils,upperRows:runtime.upperRows}),peopleBefore,'CSV simulation leaves fixture data unchanged.');
runtime.click(runtime.action('flow-reset'));assert.equal(runtime.extra.flowStep,1,'Reset returns a completed import to selection.');assert.equal(runtime.extra.flowDone,false,'Reset clears the completion state.');

const fatalVisibleCauses={
 'identity-conflict':/In einem Eintrag steht Becker, Emil, in einem anderen Becker, Emilia/,
 ambiguous:/Für Klein, Alex gibt es zwei passende Personen\. Ohne Geburtsdatum ist nicht erkennbar, welche gemeint ist/,
 'context-conflict':/In der Datei steht einmal Grundkurs, Q3\/Q4 und in Zeile 4 Leistungskurs, Q1\/Q2/
};
for(const scenario of Object.keys(fatalVisibleCauses)){
 runtime.extra.flowStep=1;runtime.extra.flowDone=false;runtime.render();runtime.change({dataset:{flowField:'scenario'},value:scenario});runtime.click(runtime.action('flow-check'));
 assert.match(runtime.markup(),/Bis dahin wird nichts übernommen/,'Conflict is visibly fatal and states the import outcome: '+scenario);
 assert.match(runtime.markup(),fatalVisibleCauses[scenario],'The visible fatal result names its actual cause: '+scenario);
 if(scenario==='context-conflict')assert.match(runtime.markup(),/3 Datenzeilen/,'Context conflict line 4 is consistent with the stated three data rows.');
 const before=runtime.extra.flowStep;runtime.click(runtime.action('flow-next'));assert.equal(runtime.extra.flowStep,before,'Fatal conflict cannot reach confirmation: '+scenario);
 runtime.click(runtime.action('flow-confirm'));assert.equal(runtime.extra.flowDone,false,'A stale confirmation action cannot bypass a fatal conflict: '+scenario);
 assert.doesNotMatch(runtime.markup(),/CSV-SchuelerID|KursID|Fataler Identitätskonflikt|Fataler Kurskontextkonflikt|erste vollständige Zeile/i,'Primary conflict guidance omits internal identifiers and jargon: '+scenario);
 runtime.click(runtime.action('flow-errors'));assert.match(runtime.context.dialog.body,/Technische Details/,'The error report gives diagnostics a clear closed technical-details label.');assert.match(runtime.context.dialog.body,/CSV-SchuelerID|KursID|Geburtstag/,'Exact source identifiers remain available in technical details.');
 runtime.click(runtime.action('flow-back'));assert.equal(runtime.extra.flowStep,1,'Back from a checked conflict returns consistently to selection.');
}

runtime.extra.flowStep=1;runtime.render();runtime.change({dataset:{flowField:'scenario'},value:'warning'});runtime.click(runtime.action('flow-check'));
assert.match(runtime.markup(),/In Zeile 4 fehlt ein Vor- oder Nachname/,'The nonfatal warning explains the concrete problem in teacher-facing language.');
assert.match(runtime.markup(),/übersprungen oder trotz des fehlenden Namens übernommen/,'The warning preserves both explicit decisions.');
assert.doesNotMatch(runtime.markup(),/Sek X/,'No fatal schema failure is presented as a skippable warning.');
runtime.change({dataset:{flowField:'decision'},value:'accept'});runtime.click(runtime.action('flow-next'));
assert.equal(runtime.extra.flowStep,3,'The documented nonfatal warning may reach confirmation after an explicit decision.');
assert.match(runtime.markup(),/trotz fehlendem Namen mit Warnung übernehmen/,'Confirmation reports the selected nonfatal warning decision.');
runtime.click(runtime.action('flow-back'));assert.equal(runtime.extra.flowStep,2,'Back returns the warning decision to the checked result.');
runtime.extra.flowStep=1;runtime.change({dataset:{flowField:'scenario'},value:'manipulated'});runtime.click(runtime.action('flow-check'));
assert.equal(runtime.extra.flowStep,1,'An invalid manipulated scenario cannot create a checked import.');assert.equal(runtime.extra.flowDone,false,'An invalid manipulated scenario cannot create apparent success.');

runtime.extra.flowStep=1;runtime.render();runtime.change({dataset:{flowField:'scenario'},value:'date'});runtime.click(runtime.action('flow-check'));
assert.match(runtime.markup(),/Das Geburtsdatum 31\.02\.2011 in Zeile 3 gibt es nicht/,'An invalid date is explained concretely.');assert.match(runtime.markup(),/Bis dahin wird nichts übernommen/,'A fatal date error states that nothing is imported.');

const transferRuntime=createRuntime();
transferRuntime.click(button({tool:'restore'}));
assert.equal(transferRuntime.state.tool,'restore','Delegated tool selection opens restore.');
assert.equal(transferRuntime.extra.scenario,'warning','Restore starts with a matching warning scenario.');
transferRuntime.click(transferRuntime.action('flow-check'));
assert.match(transferRuntime.markup(),/Einzelnoten/,'Default restore warning exposes its checked conflict result.');
assert.ok(transferRuntime.action('flow-errors'),'Restore warning keeps the error-report action.');
transferRuntime.click(transferRuntime.action('flow-errors'));assert.match(transferRuntime.context.dialog.body,/Backup-Prüfung/,'Restore error report uses the actual dialog route.');
transferRuntime.extra.flowStep=1;transferRuntime.change({dataset:{flowField:'scenario'},value:'fatal'});transferRuntime.click(transferRuntime.action('flow-check'));
assert.match(transferRuntime.markup(),/Übernahme gesperrt/,'Unreadable backup is visibly fatal.');
assert.doesNotMatch(transferRuntime.markup(),/data-action="flow-next"/,'Unreadable backup exposes no forward action.');
assert.ok(transferRuntime.action('flow-errors'),'Unreadable backup keeps its error-report action.');transferRuntime.click(transferRuntime.action('flow-errors'));assert.match(transferRuntime.context.dialog.body,/Übernahme bleibt gesperrt; es wurde nichts übernommen\./,'Unreadable backup error report uses the same fatal decision in plain language.');assert.match(transferRuntime.context.dialog.body,/Datei nicht lesbar/,'Unreadable backup error report names the read failure.');assert.doesNotMatch(transferRuntime.context.dialog.body,/Warnung: Entscheidung vor Übernahme erforderlich\./,'Unreadable backup error report does not present a fatal failure as a warning.');
transferRuntime.click(button({action:'flow-next'}));assert.equal(transferRuntime.extra.flowStep,2,'A stale restore next action cannot bypass fatal backup validation.');
transferRuntime.click(button({action:'flow-confirm'}));assert.equal(transferRuntime.extra.flowDone,false,'A stale restore confirmation cannot simulate success.');
transferRuntime.extra.flowStep=1;transferRuntime.change({dataset:{flowField:'scenario'},value:'valid'});transferRuntime.extra.merge='merge';transferRuntime.click(transferRuntime.action('flow-check'));transferRuntime.click(transferRuntime.action('flow-next'));transferRuntime.click(transferRuntime.action('flow-confirm'));assert.equal(transferRuntime.extra.flowDone,true,'Valid restore merge reaches explicit simulation.');
transferRuntime.click(transferRuntime.action('flow-reset'));transferRuntime.change({dataset:{flowField:'scenario'},value:'valid'});transferRuntime.extra.merge='replace';transferRuntime.click(transferRuntime.action('flow-check'));transferRuntime.click(transferRuntime.action('flow-next'));transferRuntime.replaceChecked=false;transferRuntime.click(transferRuntime.action('flow-confirm'));assert.equal(transferRuntime.extra.flowDone,false,'Restore replace requires its explicit checkbox.');transferRuntime.replaceChecked=true;transferRuntime.click(transferRuntime.action('flow-confirm'));assert.equal(transferRuntime.extra.flowDone,true,'Checked restore replace may simulate completion.');
transferRuntime.click(transferRuntime.action('flow-reset'));transferRuntime.click(button({tool:'export'}));transferRuntime.change({dataset:{flowField:'exportFormat'},value:'csv'});transferRuntime.click(transferRuntime.action('flow-check'));assert.match(transferRuntime.markup(),/Exportumfang prüfen/,'Delegated export route reaches checked export.');assert.match(transferRuntime.markup(),/Format\|CSV/,'Checked export keeps the selected CSV format.');transferRuntime.click(transferRuntime.action('flow-next'));transferRuntime.click(transferRuntime.action('flow-confirm'));assert.equal(transferRuntime.extra.flowDone,true,'CSV export reaches explicit simulation.');
transferRuntime.click(transferRuntime.action('flow-reset'));transferRuntime.click(button({action:'data-restore'}));assert.equal(transferRuntime.state.tool,'restore','Settings data entry opens restore through the active security click path.');assert.ok(['warning','valid','fatal'].includes(transferRuntime.extra.scenario),'Settings data entry keeps a valid restore scenario.');
transferRuntime.change({dataset:{flowField:'scenario'},value:'fatal'});transferRuntime.click(button({tool:'import'}));assert.equal(transferRuntime.state.tool,'import','Cross-tool navigation returns to CSV import.');assert.equal(transferRuntime.extra.scenario,'match','Cross-tool navigation normalizes a restore-only scenario for CSV import.');
transferRuntime.click(button({tool:'export'}));transferRuntime.change({dataset:{flowField:'exportFormat'},value:'excel'});transferRuntime.click(transferRuntime.action('flow-check'));assert.match(transferRuntime.markup(),/Format\|Excel/,'Checked export keeps the selected Excel format.');transferRuntime.click(transferRuntime.action('flow-next'));transferRuntime.click(transferRuntime.action('flow-confirm'));assert.equal(transferRuntime.extra.flowDone,true,'Excel export reaches explicit simulation.');

const fatalGate="if(extra.flowStep!==2||!checkedTransferMatches()||transferIsFatal()||state.tool==='import'&&extra.scenario==='warning'&&!['skip','accept'].includes(extra.decision))return true;";
const weakenedFatalGate="if(extra.flowStep!==2||!checkedTransferMatches()||state.tool==='import'&&extra.scenario==='warning'&&!['skip','accept'].includes(extra.decision))return true;";
assert.ok(source.includes(fatalGate),'Could not locate the actual fatal conflict gate for mutation testing.');
const mutant=createRuntime(source.replace(fatalGate,weakenedFatalGate));
mutant.change({dataset:{flowField:'scenario'},value:'identity-conflict'});mutant.click(mutant.action('flow-check'));mutant.click(button({action:'flow-next'}));
assert.equal(mutant.extra.flowStep,3,'Mutation check: weakening the actual fatal gate incorrectly reaches confirmation, so the check detects the missing guard.');
console.log('CSV conflicts OK: active renderer, delegated workflow, fatal conflict block, real warning, explicit confirmation, reset and mutation sensitivity verified.');
