const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

function button(dataset={}){return {dataset,classList:{contains:()=>false},hasAttribute:()=>false};}
function runtime(program=source){
 const events={},toast={hidden:false,textContent:'Alte Meldung'},select={value:'upper'},appearance={value:'dark'},caption={textContent:''},dialogBody={innerHTML:''},menu={textContent:'Menü öffnen',attributes:{'aria-expanded':'false'},setAttribute(name,value){this.attributes[name]=value;}};
 const root={dataset:{},append(){},addEventListener(type,listener){events[type]=listener;},querySelector(selector){
   if(selector==='.hwg-toast')return toast;if(selector==='.hwg-dialog-body')return dialogBody;if(selector==='#hwg-current-course')return select;if(selector==='#hwg-appearance')return appearance;if(selector==='.hwg-family-caption')return caption;if(selector==='.hwg-mobile-menu')return menu;
   if(selector==='.hwg-effects-preview')return null;if(selector==='.hwg-shell')return {hidden:false,inert:false};return null;
 },querySelectorAll(){return [];}};
 const main={innerHTML:'',invalid:null,querySelector(selector){return selector==='[aria-invalid="true"]'?this.invalid:null;},querySelectorAll(){return [];}};
 const nav={innerHTML:'',open:false,classList:{remove(name){if(name==='hwg-open')nav.open=false;},toggle(name){if(name==='hwg-open')nav.open=!nav.open;return nav.open;}}};
 let context;context={root,main,nav,modal:{shown:0,showModal(){this.shown++;},close(){},querySelector(){return null;}},document:{createElement(){return {className:'',hidden:true,innerHTML:'',querySelector(){return null;},append(){},focus(){}};}},matchMedia:()=>({matches:false,addEventListener(){}}),globalThis:null,
  pages:[['overview','Übersicht','layout-dashboard'],['grades','Noten','table-2']],icon:()=>'',fmt:value=>Number.isFinite(value)?value.toFixed(2).replace('.',','):'–',esc:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  upperGrades(){return '<section>Aktive Sek-II-Noteneingabe</section>';},
  security:{locked:false},admin:{courseMeta:{bio:{name:'Biologie',subject:'Biologie',className:'10a'},math:{name:'Mathematik',subject:'Mathematik',className:'10b'},upper:{name:'Biologie',subject:'Biologie',className:'Sek II'}},people:[{courses:['bio']},{courses:['math']},{courses:['upper']}]},adminCourseKeys:['bio','math','upper'],
  extra:{upperTerm:'Q3',qualification:'q3-q4'},upperTerms(){return context.extra.qualification==='q1-q2'?['Q1','Q2']:['Q3','Q4'];},
  work:{templates:[]},wField:()=>'',wSelect:()=>'',noteBox:()=>'',detailRows:()=>'',sampleTable:()=>'',
  securityClick(){return false;},adminClick(){return false;},workflowClick(){return false;},extraClick(){return false;},resetTransferFlow(){},syncCourseCardDesign(){},bindCourseCards(){},paintGrades(){},icons(){},
  coursesAdmin(){return '';},studentsAdmin(){return '';},analysisAdmin(){return '';},adminReports(){return '';},toolsView(){return '';},transferView(){return '<section>Import</section>';},settings(){return '';},archiveView(){return '';},reportView(){return '';},performanceView(){return '';},calculatorView(){return '';},yearView(){return '';},globalThis:null};
 context.globalThis=context;vm.createContext(context);
 const start=program.indexOf('const state=');const end=program.indexOf("root.addEventListener('input'",start);
 const cardStart=program.indexOf('function renderCourseCard(',end),cardEnd=program.indexOf('function bindCourseCards(',cardStart);
 assert.ok(start>=0&&end>start&&cardStart>=0&&cardEnd>cardStart,'Could not isolate the active dashboard renderer, course cards and delegated routes.');
 vm.runInContext(program.slice(start,end),context,{filename:'dashboard-resume.fragment.js'});
 vm.runInContext(program.slice(cardStart,cardEnd),context,{filename:'dashboard-resume-cards.fragment.js'});
 const extraStart=program.indexOf('function extraClick('),extraEnd=program.indexOf("root.addEventListener('change'",extraStart),adminStart=program.indexOf('function adminClick('),adminEnd=program.indexOf("root.addEventListener('input'",adminStart),securityStart=program.indexOf('function securityClick('),securityEnd=program.indexOf("modal.addEventListener('close'",securityStart);
 assert.ok(extraStart>=0&&extraEnd>extraStart&&adminStart>=0&&adminEnd>adminStart&&securityStart>=0&&securityEnd>securityStart,'Could not isolate actual K8 delegated handlers.');
 vm.runInContext(program.slice(extraStart,extraEnd),context,{filename:'dashboard-resume-extra.fragment.js'});
 vm.runInContext(program.slice(adminStart,adminEnd),context,{filename:'dashboard-resume-admin.fragment.js'});
 vm.runInContext(program.slice(securityStart,securityEnd),context,{filename:'dashboard-resume-security.fragment.js'});
 context.render();
 const click=data=>events.click({target:{closest:selector=>selector==='button'?button(data):null}});
 const mobileClick=()=>events.click({target:{closest:selector=>selector==='button'?{dataset:{},classList:{contains:name=>name==='hwg-mobile-menu'},hasAttribute:()=>false,setAttribute:menu.setAttribute.bind(menu),get textContent(){return menu.textContent;},set textContent(value){menu.textContent=value;}}:null}});
 const change=target=>events.change({target});
 return {context,state:vm.runInContext('state',context),markup:()=>main.innerHTML,click,mobileClick,change,select,menu,nav,toast,main,dialogBody};
}

const app=runtime();
assert.doesNotMatch(app.markup(),/data-action="resume"/,'No grade visit means no resume card.');
app.change({id:'hwg-current-course',value:'bio'});
assert.doesNotMatch(app.markup(),/data-action="resume"/,'Selecting a course outside grades must not create a resume visit.');
app.click({openCourse:'upper'});
assert.equal(app.state.page,'grades','The active card route opens grades.');
app.click({page:'overview'});
assert.match(app.markup(),/data-action="resume"/,'A successful grade entry creates the resume card.');
assert.match(app.markup(),/Q3/,'The remembered upper term is shown on the resume card.');
app.change({id:'hwg-current-course',value:'bio'});
app.click({action:'resume'});
assert.equal(app.state.course,'upper','Resume restores the visited course instead of the current selection.');
assert.equal(app.context.extra.upperTerm,'Q3','Resume restores the visited upper term.');
app.click({upperTerm:'Q4'});assert.equal(app.context.extra.upperTerm,'Q4','The actual Q-tab route changes the active upper term.');
app.click({page:'overview'});assert.match(app.markup(),/Q4/,'The actual Q-tab route updates the resume visit.');
app.state.page='analysis';app.context.render();app.click({upperTerm:'Q3'});app.state.page='overview';app.context.render();
assert.match(app.markup(),/Q4/,'Changing an analysis term does not overwrite the last grade-entry visit.');
app.context.admin.courseMeta.upper.name='Umbenannte Biologie';app.click({page:'overview'});
assert.match(app.markup(),/Umbenannte Biologie/,'Resume reads the current course metadata instead of a stale label.');
app.context.admin.courseMeta.upper.name='<Umbenannte Biologie>';app.context.render();assert.match(app.markup(),/&lt;Umbenannte Biologie&gt;/,'Resume escapes current course metadata.');
app.context.extra.qualification='q1-q2';app.context.extra.upperTerm='Q1';app.context.render();
assert.doesNotMatch(app.markup(),/data-action="resume"/,'An old upper term becomes unusable after its qualification changes.');

const sek=runtime();sek.click({openCourse:'bio'});assert.deepEqual(JSON.parse(JSON.stringify(sek.state.lastGradeVisit)),{courseId:'bio',term:'H1'},'A Sek-I card stores the actual H1 editor.');
sek.change({id:'hwg-current-course',value:'math'});assert.equal(sek.state.course,'math','Changing the current course within grades opens the selected course.');assert.equal(sek.state.gradeTab,'current','Changing the current course within grades returns Sek I to the current editor.');assert.deepEqual(JSON.parse(JSON.stringify(sek.state.lastGradeVisit)),{courseId:'math',term:'H1'},'Changing the current course within grades updates the resume visit.');
sek.click({gradeTab:'year'});assert.deepEqual(JSON.parse(JSON.stringify(sek.state.lastGradeVisit)),{courseId:'math',term:'H1'},'Year view cannot invent a Sek-I H2 visit.');
sek.click({gradeTab:'archive'});assert.deepEqual(JSON.parse(JSON.stringify(sek.state.lastGradeVisit)),{courseId:'math',term:'H1'},'Archive view cannot replace the current Sek-I visit.');
sek.click({gradeTab:'current'});assert.deepEqual(JSON.parse(JSON.stringify(sek.state.lastGradeVisit)),{courseId:'math',term:'H1'},'Returning to the current Sek-I editor remains H1.');
const beforeInvalid=JSON.stringify({state:sek.state,extra:sek.context.extra});sek.main.invalid={focus(){}};sek.click({openCourse:'math'});
assert.equal(JSON.stringify({state:sek.state,extra:sek.context.extra}),beforeInvalid,'Invalid grade input blocks the actual card route without changing the visit.');sek.main.invalid=null;
sek.context.security.locked=true;const beforeLocked=JSON.stringify({state:sek.state,extra:sek.context.extra});sek.change({id:'hwg-current-course',value:'math'});sek.click({openCourse:'math'});
assert.equal(JSON.stringify({state:sek.state,extra:sek.context.extra}),beforeLocked,'A locked session ignores stale course changes and card clicks.');sek.context.security.locked=false;

const q12=runtime();q12.context.extra.qualification='q1-q2';q12.context.extra.upperTerm='Q1';q12.click({openCourse:'upper'});assert.deepEqual(JSON.parse(JSON.stringify(q12.state.lastGradeVisit)),{courseId:'upper',term:'Q1'},'A valid Q1 card entry stores Q1.');q12.click({upperTerm:'Q2'});assert.deepEqual(JSON.parse(JSON.stringify(q12.state.lastGradeVisit)),{courseId:'upper',term:'Q2'},'The actual Q2 tab updates a Q1/Q2 grade-entry visit.');q12.click({page:'overview'});q12.change({id:'hwg-current-course',value:'bio'});q12.click({action:'resume'});assert.equal(q12.state.course,'upper','Resume restores a valid Q1/Q2 course.');assert.equal(q12.context.extra.upperTerm,'Q2','Resume restores Q2 from a valid Q1/Q2 visit.');

const empty=runtime();empty.click({action:'dashboard-empty'});const emptyBefore=JSON.stringify({state:empty.state,extra:empty.context.extra,meta:empty.context.admin.courseMeta});
assert.match(empty.markup(),/Noch keine aktiven Kurse/,'The actual dashboard route renders the empty scene.');assert.doesNotMatch(empty.markup(),/data-open-course|data-action="resume"/,'The empty scene exposes no course cards or resume action.');
empty.click({action:'admin-new-course'});assert.equal(empty.context.modal.shown,1,'The empty scene reaches the real new-course dialog.');assert.match(empty.dialogBody.innerHTML,/Kurs anlegen/);assert.equal(JSON.stringify({state:empty.state,extra:empty.context.extra,meta:empty.context.admin.courseMeta}),emptyBefore,'Opening course creation does not mutate the sample data.');
empty.click({action:'dashboard-empty'});empty.click({action:'data-import'});assert.equal(empty.state.page,'tools','The empty scene reaches the real import route.');assert.equal(empty.state.tool,'import');assert.equal(JSON.stringify(empty.context.admin.courseMeta),JSON.stringify(JSON.parse(emptyBefore).meta),'Opening import does not mutate the sample courses.');

const stale=runtime();stale.click({openCourse:'upper'});stale.click({page:'overview'});stale.context.adminCourseKeys.splice(stale.context.adminCourseKeys.indexOf('upper'),1);stale.state.course='bio';stale.context.render();const staleBefore=JSON.stringify({state:stale.state,extra:stale.context.extra});stale.click({action:'resume'});
assert.equal(JSON.stringify({state:stale.state,extra:stale.context.extra}),staleBefore,'A stale resume click cannot open a replacement course.');assert.doesNotMatch(stale.markup(),/data-action="resume"/,'A removed course suppresses resume.');

const mutant=runtime(source.replace("lastGradeVisit:null","lastGradeVisit:{courseId:'upper',term:'Q3'}"));
assert.match(mutant.markup(),/data-action="resume"/,'Mutation check: a fabricated initial visit would incorrectly show resume.');
const wrongResume=runtime(source.replace('openGradeCourse(visit.courseId,visit.term)','openGradeCourse(state.course,visit.term)'));wrongResume.click({openCourse:'upper'});wrongResume.click({page:'overview'});wrongResume.change({id:'hwg-current-course',value:'bio'});wrongResume.click({action:'resume'});
assert.equal(wrongResume.state.course,'bio','Mutation check: a resume route using the current selection returns to the wrong course and is detected.');
const missingGradeChange=runtime(source.replace("if(state.page==='grades'){openGradeCourse(e.target.value);return;}",''));missingGradeChange.click({openCourse:'bio'});missingGradeChange.change({id:'hwg-current-course',value:'math'});
assert.deepEqual(JSON.parse(JSON.stringify(missingGradeChange.state.lastGradeVisit)),{courseId:'bio',term:'H1'},'Mutation check: removing the grades-course branch leaves the old resume visit behind.');

const mobile=runtime();mobile.mobileClick();assert.equal(mobile.nav.open,true,'Opening the mobile menu exposes navigation.');mobile.click({page:'grades'});
assert.equal(mobile.nav.open,false,'The actual grades navigation closes the mobile menu.');
assert.equal(mobile.menu.attributes['aria-expanded'],'false','The mobile toggle reports the closed navigation after opening grades.');
assert.equal(mobile.menu.textContent,'Menü öffnen','The mobile toggle returns to its opening label after opening grades.');
assert.equal(mobile.toast.hidden,true,'Opening grades clears an old toast like ordinary navigation.');
console.log('Dashboard resume OK: active renderer and delegated course/select/resume routes, independent visit context, and mutation sensitivity verified.');
