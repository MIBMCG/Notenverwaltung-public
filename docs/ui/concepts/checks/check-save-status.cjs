// Regression: K9 save feedback follows real concept mutations and rejects stale completions.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

function control(value=''){
 return {value:String(value),checked:false,hidden:false,disabled:false,focused:false,textContent:'',innerHTML:'',dataset:{},attributes:{},handlers:{},parentElement:{dataset:{}},
  focus(){this.focused=true;},setAttribute(name,value){this.attributes[name]=String(value);if(name==='aria-invalid')this.ariaInvalid=String(value);},removeAttribute(name){delete this.attributes[name];},hasAttribute(name){return Object.hasOwn(this.attributes,name);},addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);},remove(){this.removed=true;},querySelector(){return null;},querySelectorAll(){return [];}};
}
function button(dataset={}){return {...control(),dataset,hasAttribute(name){return name==='data-close'&&Object.hasOwn(dataset,'close');},classList:{contains:()=>false}};}
function parseFields(markup,controls){
 for(const match of markup.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g))controls['#'+match[1]]??=control();
 for(const match of markup.matchAll(/<(input|select|textarea)\b([^>]*)\bid="([^"]+)"([^>]*)>/g)){
  const tag=match[0],id=match[3],value=(tag.match(/\bvalue="([^"]*)"/)||[])[1]||'';
  const field=control(value);field.checked=/\bchecked\b/.test(tag);field.attributes={};controls['#'+id]=field;
 }
 for(const match of markup.matchAll(/<select\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)){
  const selected=match[2].match(/<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/);
  if(selected&&controls['#'+match[1]])controls['#'+match[1]].value=selected[1];
 }
 for(const match of markup.matchAll(/<textarea\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))if(controls['#'+match[1]])controls['#'+match[1]].value=match[2];
}

function runtime(program=source){
 const listeners={},timers=[],controls={},mainControls={};
 const initialStatus=(program.match(/class="hwg-save-state"[\s\S]*?<span>([^<]+)<\/span>/)||[])[1]||'';
 const statusText=control();statusText.textContent=initialStatus;
 const status=control();status.dataset={};status.querySelector=selector=>selector==='span'?statusText:null;
 const saveButton=button({action:'save'}),saveButtonText=control();saveButtonText.textContent='Speichern';saveButton.querySelector=selector=>selector==='span'?saveButtonText:null;
 const outcome=/id="hwg-save-outcome"/.test(program)?control('success'):null;if(outcome)outcome.id='hwg-save-outcome';
 const toast=control(),courseSelect=control('upper'),appearance=control('dark'),caption=control(),shell=control();shell.inert=false;
 let lockSurface=null;
 const dialogBody={_html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;controls.confirm=button({});parseFields(value,controls);}};
 const modal={open:false,shown:0,closed:0,handlers:{},showModal(){this.open=true;this.shown++;},close(){this.open=false;this.closed++;for(const fn of this.handlers.close||[])fn();},addEventListener(type,handler){(this.handlers[type]??=[]).push(handler);},querySelector(selector){if(selector==='[data-confirm]')return controls.confirm;return controls[selector]||null;},querySelectorAll(selector){if(selector==='input')return Object.entries(controls).filter(([key])=>key.startsWith('#')).map(([,value])=>value);if(selector==='input[type="password"]')return [];if(selector==='[data-sub-row]')return controls.subRows||[];if(selector==='[data-weight-value]')return controls.weightValues||[];return [];}};
 function makeSurface(){const surface=control();surface._controls={};Object.defineProperty(surface,'innerHTML',{get(){return this._html||'';},set(value){this._html=value;parseFields(value,this._controls);this._controls['[data-action="unlock-preview"]']=button({action:'unlock-preview'});this._controls.form=control();}});surface.querySelector=selector=>selector==='input'?surface._controls['#hwg-unlock-password']:selector==='form'?surface._controls.form:surface._controls[selector]||null;surface.replaceChildren=()=>{surface._controls={};};return surface;}
 const root={dataset:{},style:{setProperty(){}},append(node){lockSurface=node;},addEventListener(type,listener){(listeners[type]??=[]).push(listener);},querySelector(selector){
   if(selector==='.hwg-save-state')return status;if(selector==='[data-action="save"]')return saveButton;if(selector==='#hwg-save-outcome')return outcome;if(selector==='.hwg-toast')return toast;if(selector==='.hwg-dialog-body')return dialogBody;if(selector==='#hwg-current-course')return courseSelect;if(selector==='#hwg-appearance')return appearance;if(selector==='.hwg-family-caption')return caption;if(selector==='.hwg-shell')return shell;if(selector==='.hwg-lock-surface')return lockSurface;if(selector==='.hwg-mobile-menu')return control();if(selector==='.hwg-effects-preview')return null;if(selector==='.hwg-context')return control();return null;
 },querySelectorAll(){return [];}};
 const main={_html:'',nodes:new Set(),get innerHTML(){return this._html;},set innerHTML(value){this._html=value;this.nodes.clear();},querySelector(selector){if(selector==='[aria-invalid="true"]')return [...this.nodes].find(node=>node.ariaInvalid==='true')||null;if(mainControls[selector])return mainControls[selector];if(selector.startsWith('[data-avg')||selector.startsWith('[data-upper-result'))return control();if(selector==='tbody'||selector==='#hwg-admin-count')return control();return null;},querySelectorAll(selector){return selector==='[data-map-value]'?(mainControls.mapValues||[]):[];}};
 const nav={innerHTML:'',classList:{remove(){},toggle(){return true;}}};
 const context={console,globalThis:null,document:{createElement:makeSurface},matchMedia:()=>({matches:false,addEventListener(){}}),setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){},root,main,nav,modal};context.globalThis=context;
 vm.createContext(context);
 const ranges=[
  [program.indexOf('const icon='),program.indexOf('const darkQuery=')],
  [program.indexOf('const extra='),program.indexOf('const work=')],
  [program.indexOf('const work='),program.indexOf('const admin=')],
  [program.indexOf('const admin='),program.indexOf('// Concept only: no storage')],
  [program.indexOf('const security='),program.indexOf('const courseCardControllers=')]
 ];
 assert.ok(ranges.every(([start,end])=>start>=0&&end>start),'Could not isolate the real concept handlers.');
 for(const [start,end] of ranges)vm.runInContext(program.slice(start,end),context);
 vm.runInContext('globalThis.k9={state,pupils,extra,upperRows,work,admin,security,performanceList,render};',context);
 context.renderCourseCard=id=>`<article data-course-card="${id}"></article>`;context.syncCourseCardDesign=()=>{};context.bindCourseCards=()=>{};
 const dispatch=(type,target)=>{target.dataset??={};target.hasAttribute??=()=>false;for(const listener of listeners[type]||[])listener({target});};
 const click=data=>dispatch('click',{closest:selector=>selector==='button'?button(data):null});
 const input=target=>{main.nodes.add(target);dispatch('input',target);},change=target=>dispatch('change',target);
 const flush=()=>{const pending=timers.splice(0);pending.forEach(fn=>fn());};
 const setMain=(selector,value)=>{mainControls[selector]=value;return value;};
 context.k9.render();
 return {context,api:context.k9,root,main,modal,controls,mainControls,statusText:()=>statusText.textContent,saveLabel:()=>saveButtonText.textContent,saveButton,outcome,timers,click,input,change,flush,setMain,get lockSurface(){return lockSurface;}};
}

function gradeInput(value,row=0,column=0){const field=control(value);field.dataset.grade=`${row},${column}`;return field;}
function upperInput(value,row=0,column=0){const field=control(value);field.dataset.upperScore=`${row},${column}`;return field;}
function confirm(app){assert.equal(typeof app.controls.confirm.onclick,'function','The real dialog exposes its confirmation handler.');app.controls.confirm.onclick();}

// The initial header must be honest before any interaction.
{
 const app=runtime();
 assert.match(app.statusText(),/Vorschau|Simulation/i,'Initial status identifies the transient preview.');
 assert.doesNotMatch(app.statusText(),/Im Browser gespeichert/i,'Initial status does not claim browser persistence.');
 app.click({page:'courses'});app.change({id:'hwg-appearance',value:'light'});app.input({id:'hwg-admin-search',value:'beck',dataset:{}});
 assert.match(app.statusText(),/unverändert/i,'Navigation, design and filters do not invent a data change.');
}

// Real Sek-I input drives changed -> saving -> delayed success, and double click stays single-flight.
{
 const app=runtime(),field=gradeInput('4');app.input(field);
 assert.equal(app.api.pupils[0][2][0],'4');assert.match(app.statusText(),/geändert/i);
 app.click({action:'save'});assert.match(app.statusText(),/speicher/i);assert.doesNotMatch(app.statusText(),/gespeichert/i);
 const count=app.timers.length;app.click({action:'save'});assert.equal(app.timers.length,count,'A second click cannot start a concurrent save attempt.');
 app.flush();assert.match(app.statusText(),/gespeichert/i);assert.match(app.statusText(),/Simulation/i);
}

// Failure exposes a focused retry, and retry can succeed without changing the sample data.
{
 const app=runtime();app.input(gradeInput('4'));app.outcome.value='failure';app.change(app.outcome);app.click({action:'save'});app.flush();
 assert.match(app.statusText(),/fehlgeschlagen|Fehler/i);assert.match(app.saveLabel(),/Wiederholen/i);assert.equal(app.saveButton.focused,true);
 assert.equal(app.api.pupils[0][2][0],'4','A save failure leaves edited sample data visible.');
 app.outcome.value='success';app.change(app.outcome);app.click({action:'save'});app.flush();assert.match(app.statusText(),/gespeichert/i);
}

// An older result cannot confirm a newer edit or an invalid draft.
{
 const app=runtime();app.input(gradeInput('4'));app.click({action:'save'});app.input(gradeInput('5',0,1));app.flush();
 assert.match(app.statusText(),/geändert/i);assert.doesNotMatch(app.statusText(),/Im Beispiel gespeichert/i);
 app.click({action:'save'});const before=app.api.pupils[0][2][2],invalid=gradeInput('99',0,2);app.input(invalid);app.flush();
 assert.equal(app.api.pupils[0][2][2],before);assert.match(app.statusText(),/Eingabe prüfen/i);assert.doesNotMatch(app.statusText(),/Im Beispiel gespeichert/i);
}

// Lock wins even if the old success callback runs after the actual unlock path.
{
 const app=runtime();app.input(gradeInput('4'));app.click({action:'save'});app.click({action:'lock'});
 assert.equal(app.api.security.locked,true);const surface=app.lockSurface,field=surface.querySelector('input');field.value='Vorschau123';
 for(const handler of surface.querySelector('[data-action="unlock-preview"]').handlers.click)handler();
 assert.equal(app.api.security.locked,false);app.flush();assert.match(app.statusText(),/geändert/i);assert.doesNotMatch(app.statusText(),/Im Beispiel gespeichert/i);
}

// Dialog validation, cancellation and no-op confirmation do not create revisions.
{
 const app=runtime();app.click({cell:'0,0'});app.modal.close();assert.match(app.statusText(),/unverändert/i);
 app.click({cell:'0,0'});app.controls['#hwg-note-column'].value='0';app.controls['#hwg-note-status'].value='valid';app.controls['#hwg-note-grade'].value='2';confirm(app);assert.match(app.statusText(),/unverändert/i);
 app.click({cell:'0,0'});app.controls['#hwg-note-grade'].value='9';confirm(app);assert.equal(app.api.pupils[0][2][0],2);assert.match(app.statusText(),/Eingabe prüfen|unverändert/i);
 app.controls['#hwg-note-grade'].value='3';confirm(app);assert.match(app.statusText(),/geändert/i);
}

// Scalar normalization and invalid-field aggregation preserve no-op and correction semantics.
{
 const unchanged=runtime();unchanged.input(gradeInput('2'));assert.match(unchanged.statusText(),/unverändert/i,'Numeric 2 and DOM text 2 are the same value.');unchanged.input(gradeInput('',4,0));assert.match(unchanged.statusText(),/unverändert/i,'An untouched blank remains clean.');unchanged.input(gradeInput('',0,0));assert.match(unchanged.statusText(),/geändert/i,'Deliberately clearing a nonblank value is a real change.');
 const invalids=runtime(),first=gradeInput('99',0,0),second=gradeInput('99',0,1);invalids.input(first);invalids.input(second);second.value='4';invalids.input(second);assert.match(invalids.statusText(),/Eingabe prüfen/i,'Correcting one field cannot hide another invalid field.');first.value='2';invalids.input(first);assert.match(invalids.statusText(),/geändert/i,'The valid second field remains a data change after all errors are corrected.');
 const cancelled=runtime();cancelled.click({cell:'0,0'});cancelled.controls['#hwg-note-grade'].value='9';confirm(cancelled);assert.match(cancelled.statusText(),/Eingabe prüfen/i);cancelled.modal.close();assert.match(cancelled.statusText(),/unverändert/i,'Closing an invalid dialog clears its draft error without changing data.');
}

// Actual Sek-II dialogs cover valid zero, fixed points and course/person context.
{
 const noOp=runtime();noOp.click({upperStatus:'1,0'});noOp.controls['#hwg-point-column'].value='0';noOp.controls['#hwg-point-status'].value='valid';noOp.controls['#hwg-point-grade'].value='0';noOp.controls['#hwg-q4-exam'].checked=noOp.api.upperRows[1].exam;confirm(noOp);assert.match(noOp.statusText(),/unverändert/i,'Numeric 0 and DOM text 0 are the same value.');
 const app=runtime();app.click({upperStatus:'0,0'});app.controls['#hwg-point-column'].value='0';app.controls['#hwg-point-status'].value='valid';app.controls['#hwg-point-grade'].value='0';app.controls['#hwg-q4-exam'].checked=app.api.upperRows[0].exam;confirm(app);
 assert.equal(app.api.upperRows[0].scores.Q3[0],'0');assert.match(app.statusText(),/geändert/i);
 const finalApp=runtime();finalApp.click({upperFinal:'0'});finalApp.controls['#hwg-final-points'].value='11';confirm(finalApp);assert.equal(finalApp.api.upperRows[0].final.Q3,11);assert.match(finalApp.statusText(),/geändert/i);
 const contextApp=runtime();contextApp.click({action:'upper-context'});contextApp.controls['#hwg-upper-type'].value='advanced';contextApp.controls['#hwg-upper-year'].value='q3-q4';contextApp.controls['#hwg-upper-reason'].value='Beispielbegründung';confirm(contextApp);assert.equal(contextApp.api.extra.courseType,'advanced');assert.match(contextApp.statusText(),/geändert/i);
}

// Representative archive, settings, performance, person, membership and course metadata handlers are real.
{
 const archive=runtime();archive.api.state.page='archive';archive.api.extra.archiveDetail=true;archive.api.extra.archiveUpper=false;archive.click({action:'archive-meta'});archive.controls['#hwg-retention'].value='2029-07-31';archive.controls['#hwg-archive-note'].value='Neue Archivnotiz';confirm(archive);assert.match(archive.statusText(),/geändert/i);

 const mapping=runtime();mapping.mainControls.mapValues=mapping.api.work.mapping.map((value,index)=>{const item=control(value);if(index===0)item.value='0.8';return item;});mapping.setMain('#hwg-mapping-error',control());mapping.click({action:'mapping-save'});assert.equal(mapping.api.work.mapping[0],0.8);assert.match(mapping.statusText(),/geändert/i);

 const category=runtime();category.click({categoryEdit:'0'});category.controls.subRows=[['Unterricht','60'],['Präsentation','40']].map(([name,weight])=>({querySelector(selector){return control(selector==='[data-sub-name]'?name:weight);}}));confirm(category);assert.match(category.statusText(),/unverändert/i,'Confirming the same category and subcategories is a no-op.');
 const weights=runtime();weights.click({weightEdit:'0'});weights.controls.weightValues=['55','45','0'].map(control);confirm(weights);assert.deepEqual([...weights.api.work.templates[0].weights],[55,45,0]);assert.match(weights.statusText(),/geändert/i);

 const performance=runtime();performance.api.state.course='bio';performance.api.performanceList();assert.match(performance.statusText(),/unverändert/i,'Lazy seed creation is not a user data change.');performance.click({performanceEdit:'0'});performance.controls['#hwg-performance-name'].value='Mitarbeit';confirm(performance);assert.equal(performance.api.performanceList()[0].name,'Mitarbeit');assert.match(performance.statusText(),/geändert/i);

 const person=runtime();person.click({adminEdit:'0'});person.controls['#hwg-person-last'].value='Beispiel';person.controls['#hwg-person-first'].value='Emil';confirm(person);assert.equal(person.api.admin.people[0].last,'Beispiel');assert.match(person.statusText(),/geändert/i);

 const membership=runtime();membership.api.admin.people.push({id:20,last:'Ohne',first:'Kurs',birth:'',className:'10c',courses:[]});membership.click({adminAssign:'20'});membership.controls['#hwg-assign-course'].value='bio';confirm(membership);assert.deepEqual([...membership.api.admin.people.at(-1).courses],['bio']);assert.match(membership.statusText(),/geändert/i);

 const course=runtime();course.api.state.course='bio';for(const [key,value] of Object.entries({name:'Biologie neu',subject:'Biologie',class:'10a',start:'2026-08-01',end:'2027-01-31',next:'2027-02-01'}))course.setMain('#hwg-meta-'+key,control(value));const own=course.setMain('#hwg-meta-own',control());own.checked=false;course.setMain('#hwg-meta-error',control());course.click({action:'admin-course-check'});confirm(course);assert.equal(course.api.admin.courseMeta.bio.name,'Biologie neu');assert.match(course.statusText(),/geändert/i);

 const timeout=runtime();timeout.setMain('#hwg-idle-minutes',control('15'));timeout.setMain('#hwg-security-error',control());timeout.click({action:'idle-save'});assert.match(timeout.statusText(),/unverändert/i);timeout.mainControls['#hwg-idle-minutes'].value='20';timeout.click({action:'idle-save'});assert.equal(timeout.api.security.minutes,20);assert.match(timeout.statusText(),/geändert/i);
}

// Lock/unlock replaces the main DOM, so discarded invalid drafts cannot outlive the clean, dirty or saved phase.
{
 const unlock=app=>{app.click({action:'lock'});const surface=app.lockSurface;surface.querySelector('input').value='Vorschau123';for(const handler of surface.querySelector('[data-action="unlock-preview"]').handlers.click)handler();assert.equal(app.api.security.locked,false);};
 const clean=runtime();clean.input(gradeInput('99'));assert.match(clean.statusText(),/Eingabe prüfen/i);unlock(clean);assert.match(clean.statusText(),/unverändert/i);
 const dirty=runtime();dirty.input(gradeInput('4'));dirty.input(gradeInput('99',0,1));assert.match(dirty.statusText(),/Eingabe prüfen/i);unlock(dirty);assert.match(dirty.statusText(),/geändert/i);
 const saved=runtime();saved.input(gradeInput('4'));saved.click({action:'save'});saved.flush();saved.input(gradeInput('99',0,1));assert.match(saved.statusText(),/Eingabe prüfen/i);unlock(saved);assert.match(saved.statusText(),/gespeichert/i);
 const dialog=runtime();dialog.click({cell:'0,0'});dialog.controls['#hwg-note-grade'].value='9';confirm(dialog);assert.match(dialog.statusText(),/Eingabe prüfen/i);dialog.api.render();assert.match(dialog.statusText(),/Eingabe prüfen/i,'Rendering behind an open invalid dialog keeps its validation status.');
}

// Targeted mutation probes prove that both stale-state guards matter.
{
 const withoutRevision=runtime(source.replace('request.revision!==savePreview.revision','false'));withoutRevision.input(gradeInput('4'));withoutRevision.click({action:'save'});withoutRevision.input(gradeInput('5',0,1));withoutRevision.flush();assert.match(withoutRevision.statusText(),/gespeichert/i,'Mutation probe exposes a false success when the revision guard is removed.');
 const withoutLock=runtime(source.replace('request.lockEpoch!==savePreview.lockEpoch','false'));withoutLock.input(gradeInput('4'));withoutLock.click({action:'save'});withoutLock.click({action:'lock'});const surface=withoutLock.lockSurface;surface.querySelector('input').value='Vorschau123';for(const handler of surface.querySelector('[data-action="unlock-preview"]').handlers.click)handler();withoutLock.flush();assert.match(withoutLock.statusText(),/gespeichert/i,'Mutation probe exposes a false success when the lock guard is removed.');
}

console.log('Save status OK: real edits, dialogs, deterministic outcomes, retry, revisions and lock invalidation verified.');
