const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

const activeStart=source.indexOf('function coursesAdmin()');
const activeEnd=source.indexOf('function statsValues(',activeStart);
assert.ok(activeStart>=0&&activeEnd>activeStart,'Could not isolate the active coursesAdmin renderer.');
const activeRenderer=source.slice(activeStart,activeEnd);
assert.match(activeRenderer,/btn\('Archivieren','admin-course-archive'/,'Only the active coursesAdmin renderer may expose course archiving.');
assert.match(activeRenderer,/btn\('Löschen prüfen','admin-course-delete'/,'Only the active coursesAdmin renderer may expose course deletion review.');

function snapshot(runtime){
  return JSON.stringify({state:runtime.state,extra:runtime.extra,pupils:runtime.pupils,upperRows:runtime.upperRows,admin:runtime.admin});
}

function createRuntime(program){
  const events={},renderedButtons=[],fields={
    '#hwg-course-archive-retention':{value:'2029-07-31'},
    '#hwg-course-archive-note':{value:'<Archivnotiz>'}
  };
  const dialogBody={innerHTML:''},toast={textContent:'',hidden:true};
  const confirmButton={onclick:null};
  const modal={shown:0,closed:0,showModal(){this.shown++;},close(){this.closed++;},querySelector(selector){
    if(selector==='[data-confirm]')return confirmButton;
    return fields[selector]||null;
  }};
  const root={
    addEventListener(type,listener){events[type]=listener;},
    querySelector(selector){
      if(selector==='.hwg-dialog-body')return dialogBody;
      if(selector==='.hwg-toast')return toast;
      return null;
    }
  };
  const state={course:'bio',detail:'general'},extra={};
  const pupils=[['Becker, Emil',['2','3','4']],['Fischer, Amir',['3','2','1']]],upperRows=[];
  const context={
    root,modal,state,extra,pupils,upperRows,birthdays:['2011-02-03','2011-04-05'],security:{locked:false},
    heading:(title,subtitle,body)=>`${title}|${subtitle}|${body}`,
    btn:(label,action)=>{const button=makeButton({action});renderedButtons.push({label,button});return `<button data-action="${action}">${label}</button>`;},
    wField:(label,id,value)=>`<label>${label}<input id="${id}" value="${String(value)}"></label>`,
    wButton:(label,attribute,value)=>`<button data-${attribute}="${value}">${label}</button>`,
    tabs:()=>'',wSelect:()=>'',noteBox:text=>`<aside>${text}</aside>`,sampleTable:()=>'',detailRows:rows=>rows.map(row=>row.join('|')).join('\n'),
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    upperTerms:()=>['Q3','Q4'],fmt:value=>String(value),pointBand:()=>'',gradeBand:()=>'',total:()=>'',
    icons:()=>{},securityClick:()=>false,adminClick:()=>false,workflowClick:()=>false,
    main:{querySelector:()=>null},nav:{classList:{remove:()=>{}}},matchMedia:()=>({matches:false}),globalThis:null
  };
  context.globalThis=context;
  vm.createContext(context);
  const dialogStart=program.indexOf('function notice(');
  const dialogEnd=program.indexOf("root.addEventListener('change'",dialogStart);
  const actionStart=program.indexOf('function extraClick(');
  const actionEnd=program.indexOf("root.addEventListener('change'",actionStart);
  const adminStart=program.indexOf('const admin=');
  const adminEnd=program.indexOf("root.addEventListener('input'",adminStart);
  assert.ok(dialogStart>=0&&dialogEnd>dialogStart&&actionStart>=0&&actionEnd>actionStart&&adminStart>=0&&adminEnd>adminStart,'Could not isolate real K4 renderer, dialog or click handler.');
  vm.runInContext(program.slice(dialogStart,dialogEnd),context);
  vm.runInContext(program.slice(actionStart,actionEnd),context);
  vm.runInContext(program.slice(adminStart,adminEnd)+';globalThis.k4={coursesAdmin,admin};',context);
  const click=button=>events.click({target:{closest:selector=>selector==='button'?button:null}});
  const actionButton=action=>renderedButtons.find(entry=>entry.button.dataset.action===action)?.button;
  return {state,extra,pupils,upperRows,admin:context.k4.admin,modal,dialogBody,toast,confirmButton,click,actionButton,render:context.k4.coursesAdmin};
}

function makeButton(dataset={},close=false){
  return {dataset,classList:{contains:()=>false},hasAttribute:name=>close&&name==='data-close'};
}

const runtime=createRuntime(source);
const detail=runtime.render();
assert.match(detail,/Archivieren/);
assert.match(detail,/Löschen prüfen/);
const archiveButton=runtime.actionButton('admin-course-archive'),deleteButton=runtime.actionButton('admin-course-delete');
assert.ok(archiveButton&&deleteButton,'Rendered administration actions must provide both delegated click targets.');

const beforeArchive=snapshot(runtime);
runtime.click(archiveButton);
assert.equal(runtime.modal.shown,1,'The delegated root click opens the actual source dialog.');
assert.match(runtime.dialogBody.innerHTML,/Kurs archivieren/);
assert.match(runtime.dialogBody.innerHTML,/Biologie/);
assert.match(runtime.dialogBody.innerHTML,/Archivierungsdatum/);
assert.match(runtime.dialogBody.innerHTML,/Aufbewahren bis \(optional\)/);
assert.match(runtime.dialogBody.innerHTML,/maximal 1000 Zeichen/);
assert.match(runtime.dialogBody.innerHTML,/Leistungen, Noten und Bewertungsgrundlagen bleiben erhalten/);
assert.match(runtime.dialogBody.innerHTML,/Archivierung simulieren/);
assert.equal(snapshot(runtime),beforeArchive,'Opening archive review changes no reachable example data.');
runtime.click(makeButton({},true));
assert.equal(runtime.modal.closed,1,'The actual delegated close action closes archive review.');
assert.equal(snapshot(runtime),beforeArchive,'Closing archive review changes no reachable example data.');

runtime.click(archiveButton);
runtime.confirmButton.onclick();
assert.equal(runtime.modal.closed,2,'The actual source confirmation closes archive review.');
assert.equal(snapshot(runtime),beforeArchive,'Archive confirmation creates no archive or mutation.');
assert.match(runtime.toast.textContent,/2029-07-31/,'Actual notice text includes the entered retention date.');
assert.match(runtime.toast.textContent,/<Archivnotiz>/,'Actual notice text preserves the entered note.');
assert.match(runtime.toast.textContent,/Kein Archiv wurde erzeugt/);

const beforeDelete=snapshot(runtime);
runtime.click(deleteButton);
assert.equal(runtime.modal.shown,3,'The delegated root click opens deletion review.');
assert.match(runtime.dialogBody.innerHTML,/Kurs löschen prüfen/);
assert.match(runtime.dialogBody.innerHTML,/Leistungen und die darin enthaltenen Noteneinträge/);
assert.match(runtime.dialogBody.innerHTML,/Personenstammdaten bleiben erhalten/);
assert.match(runtime.dialogBody.innerHTML,/Löschen simulieren/);
assert.equal(snapshot(runtime),beforeDelete,'Opening deletion review changes no reachable example data.');
runtime.click(makeButton({},true));
assert.equal(runtime.modal.closed,3,'The actual delegated close action closes deletion review.');
assert.equal(snapshot(runtime),beforeDelete,'Closing deletion review changes no reachable example data.');

runtime.click(deleteButton);
runtime.confirmButton.onclick();
assert.equal(runtime.modal.closed,4,'The actual source confirmation closes deletion review.');
assert.equal(snapshot(runtime),beforeDelete,'Deletion confirmation creates no course, score, metadata or context mutation.');
assert.match(runtime.toast.textContent,/keine Kursdaten, Leistungen oder Noteneinträge gelöscht/);

runtime.state.course='upper';runtime.admin.courseMeta.upper.name='<Sek II>';
const beforeUpper=snapshot(runtime);
runtime.render();
runtime.click(runtime.actionButton('admin-course-archive'));
assert.match(runtime.dialogBody.innerHTML,/&lt;Sek II&gt;/,'Selected Sek-II course identity is HTML-escaped in the actual dialog body.');
runtime.click(makeButton({},true));
assert.equal(snapshot(runtime),beforeUpper,'Sek-II archive review remains non-mutating.');

const routingMutant=createRuntime(source.replace("if(a==='admin-course-delete')","if(a==='admin-course-delete-disabled')"));
routingMutant.render();
routingMutant.click(routingMutant.actionButton('admin-course-delete'));
assert.equal(routingMutant.modal.shown,0,'Mutation check: removing deletion routing prevents the real delegated click from opening a dialog.');

console.log('Course actions OK: rendered buttons use the real delegated click handler and source dialog; close/confirmation, all reachable fixture data, metadata notice, Sek-II escaping and mutation sensitivity verified.');
