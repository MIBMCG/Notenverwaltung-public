// Regression: the status controls are a real dialog route, never a substitute grade value.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');
const events={},notices=[];
function control(value=''){return {value,checked:false,disabled:false,focused:false,dataset:{},attrs:{},handlers:{},focus(){this.focused=true;},setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},addEventListener(type,handler){this.handlers[type]=handler;},querySelector(){return control();}};}
const controls={},body={_html:'',get innerHTML(){return this._html;},set innerHTML(value){this._html=value;controls.confirm=control();for(const tag of value.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const field=control((tag[0].match(/\bvalue="([^"]*)"/)||[])[1]||'');field.checked=/\bchecked\b/.test(tag[0]);controls['#'+tag[1]]=field;}}};
const modal={shown:false,closed:false,showModal(){this.shown=true;},close(){this.closed=true;},querySelector(selector){return selector==='[data-confirm]'?controls.confirm:controls[selector];}};
const root={addEventListener(type,handler){events[type]=handler;},querySelector(selector){if(selector==='.hwg-dialog-body')return body;return control();}};
const context={root,modal,main:{querySelector:()=>null},nav:{classList:{remove(){}}},security:{locked:false},notice(message){notices.push(message);},icons(){},icon:()=>'',esc:value=>String(value),noteBox:()=>'',render(){context.rendered=(context.rendered||0)+1;},canNavigate(){return true;},securityClick(){return false;},adminClick(){return false;},workflowClick(){return false;},document:{},console};
vm.createContext(context);

const dialogStart=source.indexOf('function openDialog');
const dialogEnd=source.indexOf("root.addEventListener('click'",dialogStart);
vm.runInContext(source.slice(dialogStart,dialogEnd),context);
const dataStart=source.indexOf('const state=');
const dataEnd=source.indexOf('const settingItems=',dataStart);
vm.runInContext(source.slice(dataStart,dataEnd),context);
const clickStart=source.indexOf("root.addEventListener('click'");
const statusStart=source.indexOf('if(b.dataset.cell||b.dataset.note)',clickStart);
const statusEnd=source.indexOf('const a=b.dataset.action;',statusStart);
vm.runInContext(`function actualSekIStatusClick(b){${source.slice(statusStart,statusEnd)}}`,context);
const upperStart=source.indexOf('function extraClick');
const upperEnd=source.indexOf("if(a==='upper-context')",upperStart);
const extraStart=source.indexOf('const extra=');
vm.runInContext(source.slice(extraStart,upperStart),context);
vm.runInContext(source.slice(upperStart,upperEnd)+'}',context);
vm.runInContext('globalThis.statusApi={pupils,upperRows,grades,state};',context);
const {pupils,upperRows,grades,state}=context.statusApi;

function button(dataset){return {dataset,classList:{contains:()=>false},hasAttribute:()=>false};}
function renderedSekIButton(row=0,column=null){state.course='bio';state.gradeTab='current';const markup=grades();const match=column===null?markup.match(new RegExp(`data-note="${row}"`)):markup.match(new RegExp(`data-cell="${row},${column}"`));assert.ok(match,'The rendered Sek-I table exposes the requested status route');return button(column===null?{note:String(row)}:{cell:`${row},${column}`});}
function openSekI(row=0,col=2){modal.closed=false;context.actualSekIStatusClick(renderedSekIButton(row,col));assert.equal(modal.shown,true,'Rendered Sek-I F/E status button opens the dialog');}
function openSekIRow(row=0){modal.closed=false;context.actualSekIStatusClick(renderedSekIButton(row));assert.equal(modal.shown,true,'Rendered Sek-I row action opens the status dialog');}
function openSekII(row=0,col=2){modal.closed=false;context.extraClick(button({upperStatus:`${row},${col}`}));assert.equal(modal.shown,true,'Rendered Sek-II status button opens the dialog');}
function installStatus(value,grade=''){controls['#hwg-note-status']=control(value);controls['#hwg-note-grade']=control(grade);controls['#hwg-point-column']=control('2');controls['#hwg-point-status']=controls['#hwg-note-status'];controls['#hwg-point-grade']=controls['#hwg-note-grade'];controls['#hwg-q4-exam']=control();}

// The actual row action is reachable for normal and blank oral values, then selects all columns.
pupils[0][2]=['2','','1'];
openSekIRow();
assert.match(body.innerHTML,/Gültig/,'Sek-I status dialog offers a valid grade route');
assert.match(body.innerHTML,/hwg-note-column/,'Sek-I row action exposes all performance columns');
assert.match(body.innerHTML,/value="1"/,'Row action pre-fills its default Test-1 grade instead of clearing it');
controls['#hwg-note-column'].value='0';controls['#hwg-note-column'].handlers.change();
assert.equal(controls['#hwg-note-status'].value,'valid','M1 selection reflects its valid status');
assert.equal(controls['#hwg-note-grade'].value,'2','M1 selection pre-fills the normal grade');
controls['#hwg-note-status'].value='F';controls.confirm.onclick();
assert.equal(pupils[0][2][0],'F','Actual row action can set normal M1 to Fehlt');
assert.equal(pupils[0][2][2],'1','Changing M1 leaves Test 1 unchanged');

openSekIRow();controls['#hwg-note-column'].value='1';controls['#hwg-note-column'].handlers.change();
assert.equal(controls['#hwg-note-status'].value,'valid','M2 selection reflects a blank value as valid entry');
assert.equal(controls['#hwg-note-grade'].value,'','M2 selection keeps a blank value blank');
controls['#hwg-note-status'].value='E';controls.confirm.onclick();
assert.equal(pupils[0][2][1],'E','Actual row action can set blank M2 to Entschuldigt');
assert.equal(pupils[0][2][0],'F','Changing M2 preserves M1');

openSekI(0,0);installStatus('valid','3');controls['#hwg-note-column'].value='0';controls.confirm.onclick();
assert.equal(pupils[0][2][0],'3','Sek-I F/E status can become grade 3');

pupils[0][2][2]='F';openSekI(0,2);installStatus('valid','');controls['#hwg-note-column'].value='2';controls.confirm.onclick();
assert.equal(pupils[0][2][2],'','Sek-I valid route may remain blank and is not zero');

openSekIRow();installStatus('valid','9');controls['#hwg-note-column'].value='1';controls.confirm.onclick();
assert.equal(pupils[0][2][1],'E','Invalid Sek-I input does not mutate the selected column');
assert.equal(modal.closed,false,'Invalid Sek-I input keeps the dialog open');
assert.equal(controls['#hwg-note-grade'].focused,true,'Invalid Sek-I input receives focus');

openSekI(0,1);installStatus('valid','3');controls['#hwg-note-column'].value='1';modal.close();
assert.equal(pupils[0][2][1],'E','Closing the Sek-I dialog does not mutate');

upperRows[1].scores.Q3[0]='F';openSekII(1,0);installStatus('valid','0');controls['#hwg-point-column'].value='0';controls['#hwg-q4-exam'].checked=true;controls.confirm.onclick();
assert.equal(upperRows[1].scores.Q3[0],'0','Sek-II valid route accepts 0 points');
assert.equal(upperRows[1].exam,true,'Q4 context checkbox remains available through the status dialog');

openSekII(1,2);controls['#hwg-point-column'].value='1';controls['#hwg-point-column'].handlers.change();
assert.equal(controls['#hwg-point-status'].value,'valid','Changing performance reflects the selected column status');
assert.equal(controls['#hwg-point-grade'].value,4,'Changing performance pre-fills its valid score');
controls['#hwg-point-grade'].value='5';controls.confirm.onclick();
assert.equal(upperRows[1].scores.Q3[1],'5','Sek-II status dialog updates the selected oral column');
assert.equal(upperRows[1].scores.Q3[2],3,'Sek-II column choice leaves the other column unchanged');

upperRows[0].scores.Q3[2]='F';openSekII(0,2);installStatus('valid','');controls['#hwg-q4-exam'].checked=upperRows[0].exam;controls.confirm.onclick();
assert.equal(upperRows[0].scores.Q3[2],'','Sek-II F/E status may become blank');

upperRows[0].scores.Q3[2]='E';const examBefore=upperRows[0].exam;openSekII(0,2);installStatus('valid','16');controls['#hwg-q4-exam'].checked=!examBefore;controls.confirm.onclick();
assert.equal(upperRows[0].scores.Q3[2],'E','Invalid Sek-II input does not mutate the score');
assert.equal(upperRows[0].exam,examBefore,'Invalid Sek-II input does not change Q4 context');
assert.equal(modal.closed,false,'Invalid Sek-II input keeps the dialog open');

console.log('Entry status OK: real Sek-I/Sek-II dialog routes preserve valid, blank, invalid, cancel, column and Q4 context behavior.');
