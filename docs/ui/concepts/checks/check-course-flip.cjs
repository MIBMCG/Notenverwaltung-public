const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');
for(const m of source.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
function node(){const classes=new Set(),attrs={},handlers={};return {textContent:'',handlers,attrs,classList:{toggle(k,on){on?classes.add(k):classes.delete(k);},contains:k=>classes.has(k)},setAttribute(k,v){attrs[k]=v;},addEventListener(k,f){handlers[k]=f;}};}
const info=node(),front=node(),back=node(),card=node();card.querySelector=s=>s.includes('info')?info:s.includes('front')?front:back;
let timers=new Map(),serial=0;const context={root:{querySelectorAll:()=>[card]},courseCardControllers:new WeakMap(),courseCardControllerSet:new Set(),state:{family:'aurora',effects:'vivid'},reducedMotion:{matches:false},motionDisabled(){return context.state.family==='classic'||context.state.effects==='off'||context.reducedMotion.matches;},scheduleMotion(fn){timers.set(++serial,fn);return serial;},clearMotionTimer(id){timers.delete(id);}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function bindCourseCards()'),source.indexOf('function syncCourseCardDesign()')),context);context.bindCourseCards();
const tick=()=>{const list=[...timers.values()];timers.clear();list.forEach(fn=>fn());};const open=()=>card.classList.contains('hwg-card-open');
card.handlers.pointerenter({pointerType:'mouse'});assert(!open());tick();assert(open());assert.equal(info.textContent,'Info');assert.equal(back.attrs['aria-hidden'],'false');
card.handlers.pointerleave();assert(!open());
info.handlers.click();assert(open());assert.equal(info.textContent,'×');card.handlers.pointerleave();assert(open());
card.handlers.keydown({key:'Escape'});assert(!open());assert.equal(info.textContent,'Info');
card.handlers.pointerleave();card.handlers.pointerenter({pointerType:'touch'});tick();assert(!open());info.handlers.click();assert(open());info.handlers.click();assert(!open());
for(const family of ['modern','classic']){context.state.family=family;card.handlers.pointerleave();card.handlers.pointerenter({pointerType:'mouse'});tick();assert.equal(open(),family==='modern');card.handlers.pointerleave();info.handlers.click();assert(open());info.handlers.click();assert(!open());}
context.state.family='aurora';context.courseCardControllers.get(card).preview();assert(open());tick();assert(!open());
card.handlers.pointerenter({pointerType:'mouse'});context.state.effects='off';context.courseCardControllers.get(card).resetHover();tick();assert(!open(),'A pending hover callback cannot reopen a card after motion is turned off.');
context.state.effects='vivid';card.handlers.pointerenter({pointerType:'mouse'});context.reducedMotion.matches=true;context.courseCardControllers.get(card).resetHover();tick();assert(!open(),'A pending hover callback cannot reopen a card after reduced motion activates.');
console.log('Syntax OK; hover delay/leave, pin, close, Escape, touch Info, Modern/Classic and preview verified.');
