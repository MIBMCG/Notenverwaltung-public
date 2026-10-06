const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

function between(program,start,end){const from=program.indexOf(start),to=program.indexOf(end,from);assert.ok(from>=0&&to>from,`Could not isolate ${start}.`);return program.slice(from,to);}
function snapshot(runtime){return JSON.stringify({state:runtime.state,extra:runtime.extra,pupils:runtime.pupils,upperRows:runtime.upperRows});}
function button(dataset={},close=false){return {dataset,classList:{contains:()=>false},hasAttribute:name=>close&&name==='data-close'};}

function createRuntime(program=source){
  const events={},buttons=[],dialogBody={innerHTML:''},toast={textContent:'',hidden:true},confirmButton={onclick:null};
  const modal={shown:0,closed:0,showModal(){this.shown++;},close(){this.closed++;},querySelector(selector){return selector==='[data-confirm]'?confirmButton:null;}};
  const root={addEventListener(type,listener){events[type]=listener;},querySelector(selector){return selector==='.hwg-dialog-body'?dialogBody:selector==='.hwg-toast'?toast:null;}};
  const state={course:'bio',page:'archive'},extra={archiveDetail:true,archiveUpper:false,archiveTab:'overview',retention:'2028-07-31',archiveNote:'Beispielarchiv',upperRetention:'2028-07-31',upperArchiveNote:'Oberstufenarchiv'};
  const pupils=[['Becker, Emil',['2','3','4']],['Fischer, Amir',['3','2','1']],['Groß, Sofia',['1','1','2']],['Hoffmann, Ben',['4','5','3']]],upperRows=[];
  const context={root,modal,state,extra,pupils,upperRows,security:{locked:false},main:{querySelector:()=>null},nav:{classList:{remove:()=>{}}},
    detailRows:rows=>rows.map(row=>row.join('|')).join('\n'),heading:(title,subtitle,body)=>`${title}|${subtitle}|${body}`,tabs:()=>'',sampleTable:()=>'',noteBox:text=>`<aside>${text}</aside>`,pointCell:value=>String(value),
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    btn:(label,action)=>{const item={label,button:button({action})};buttons.push(item);return `<button data-action="${action}">${label}</button>`;},icons:()=>{},canNavigate:()=>true,securityClick:()=>false,adminClick:()=>false,workflowClick:()=>false,go:()=>{},render:()=>{},globalThis:null};
  context.globalThis=context;vm.createContext(context);
  vm.runInContext(between(program,'function notice(',"root.addEventListener('click'"),context);
  vm.runInContext(between(program,'function archiveView()','function reportTerms()'),context);
  vm.runInContext(between(program,'function extraClick(','root.addEventListener(\'change\''),context);
  vm.runInContext(between(program,"root.addEventListener('click'","root.addEventListener('change'"),context);
  const click=target=>events.click({target:{closest:selector=>selector==='button'?target:null}});
  return {state,extra,pupils,upperRows,modal,dialogBody,toast,confirmButton,click,render:context.archiveView,buttonFor:action=>buttons.find(entry=>entry.button.dataset.action===action)?.button};
}

for(const upper of [false,true]){
  const runtime=createRuntime();runtime.extra.archiveUpper=upper;
  const rendered=runtime.render();
  assert.match(rendered,/Verschlüsseltes Archivpaket/,upper?'Sek-II archive detail exposes the encrypted package action.':'Sek-I archive detail exposes the encrypted package action.');
  const exportButton=runtime.buttonFor('archive-export');assert.ok(exportButton,'Actual renderer exposes a delegated archive export button.');
  const before=snapshot(runtime);runtime.click(exportButton);
  assert.equal(runtime.modal.shown,1,'The root delegated click opens the actual archive export dialog.');
  assert.match(runtime.dialogBody.innerHTML,upper?/Biologie GK · Jahrgang 12/:/Biologie · 10a/,'The dialog names the selected archive course for this route.');
  for(const required of ['Verschlüsseltes Archivpaket','Biologie','2025/26','Personen','Leistungen','Einstellungen','Archivinformationen','Gesamtbackup','CSV','Excel'])assert.match(runtime.dialogBody.innerHTML,new RegExp(required));
  assert.equal(snapshot(runtime),before,'Opening the export dialog changes no reachable example data.');
  runtime.click(button({},true));assert.equal(runtime.modal.closed,1,'The actual delegated close action closes export review.');
  assert.equal(snapshot(runtime),before,'Closing export review changes no reachable example data.');
  runtime.click(exportButton);runtime.confirmButton.onclick();assert.equal(runtime.modal.closed,2,'Actual export confirmation closes the dialog.');
  assert.equal(snapshot(runtime),before,'Export confirmation changes no reachable example data.');
  assert.match(runtime.toast.textContent,/keine Datei erzeugt/i,'Export confirmation explicitly says no file was created.');
}

const original=source.indexOf("if(a==='archive-export')");
assert.ok(original>=0,'The source has the archive-export routing branch.');
const mutatedSource=source.slice(0,original)+source.slice(original).replace("if(a==='archive-export')","if(a==='archive-export-disabled')");
assert.notEqual(mutatedSource,source,'Mutation setup removes the export routing branch.');
const routingMutant=createRuntime(mutatedSource);routingMutant.render();routingMutant.click(routingMutant.buttonFor('archive-export'));
assert.equal(routingMutant.modal.shown,0,'Mutation check: removing export routing prevents the delegated click from opening its dialog.');
const forcedSekIName=source.replaceAll("extra.archiveUpper?'Biologie GK · Jahrgang 12':'Biologie · 10a'","'Biologie · 10a'");
const courseIdentityMutant=createRuntime(forcedSekIName);courseIdentityMutant.extra.archiveUpper=true;courseIdentityMutant.render();courseIdentityMutant.click(courseIdentityMutant.buttonFor('archive-export'));
assert.throws(()=>assert.match(courseIdentityMutant.dialogBody.innerHTML,/Biologie GK · Jahrgang 12/),assert.AssertionError,'Mutation check: forcing the Sek-I course name makes the Sek-II identity assertion fail.');
console.log('Archive export RED/GREEN contract: both active archive renderers, selected-course identity, delegated routing, dialog content, close/confirmation, simulation-only notice and non-mutation verified.');
