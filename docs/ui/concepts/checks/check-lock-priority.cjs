// Regression: an invalid grade may block navigation, never the manual lock.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');
const events={},shell={hidden:false,inert:false};let focused=0;
function element(){return {hidden:false,innerHTML:'',value:'',handlers:{},focus(){focused++;},addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(){}};}
const field=element(),form=element(),unlock=element(),surface=element();
surface.querySelector=selector=>selector==='input'?field:selector==='form'?form:unlock;
const root={addEventListener(type,fn){events[type]=fn;},querySelector(selector){return selector==='.hwg-shell'?shell:surface;},append(){}};
const bad=element(),context={root,main:{querySelector:()=>bad},security:{locked:false},modal:{close(){}},icons(){},icon(){return '';},wField(){return '<input>';},notice(){},invalidatePreviewSave(){},document:{createElement:()=>surface},state:{page:'grades'},adminClick:()=>false,workflowClick:()=>false,extraClick:()=>false};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function canNavigate()'),source.indexOf('function go(')),context);
vm.runInContext(source.slice(source.indexOf('function showLock('),source.indexOf('function resetView(')),context);
vm.runInContext(source.slice(source.indexOf('function securityClick('),source.indexOf("modal.addEventListener('close'")),context);
vm.runInContext(source.slice(source.indexOf("root.addEventListener('click'"),source.indexOf("root.addEventListener('change'")),context);
function click(dataset){const button={dataset,classList:{contains:()=>false}};events.click({target:{closest:()=>button}});}
click({page:'overview'});
assert.equal(context.state.page,'grades','Invalid grade keeps ordinary navigation in grades');
assert.equal(context.security.locked,false);
click({action:'lock'});
assert.equal(context.security.locked,true,'Manual lock must win over an invalid grade');
assert.equal(shell.hidden,true,'Working views hidden after lock');
assert.equal(shell.inert,true,'Working views cannot receive input after lock');
assert.match(surface.innerHTML,/Anwendung gesperrt/);
console.log('Lock priority OK: invalid grade blocks navigation, manual lock hides and disables working views.');
