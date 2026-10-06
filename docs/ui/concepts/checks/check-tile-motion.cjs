const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
const begin=html.indexOf('function runTileEffect('),end=html.indexOf("root.addEventListener('pointerover'",begin);
const ctx={state:{family:'modern',effects:'vivid'},reducedMotion:{matches:false},tileTimers:new WeakMap(),clearMotionTimer(){},scheduleMotion(fn){ctx.finish=fn;return 1;}};
vm.createContext(ctx);vm.runInContext(html.slice(begin,end),ctx);
const classes=new Set();const tile={classList:{contains:n=>classes.has(n),add:n=>classes.add(n),remove:n=>classes.delete(n)}};
for(const family of ['modern','aurora']){ctx.state.family=family;ctx.runTileEffect(tile);assert(classes.has('hwg-tile-run'));ctx.finish();assert(!classes.size);}
ctx.state.family='classic';ctx.runTileEffect(tile);assert(!classes.size);
ctx.state.family='aurora';ctx.state.effects='off';ctx.runTileEffect(tile);assert(!classes.size);
ctx.state.effects='vivid';ctx.reducedMotion.matches=true;ctx.runTileEffect(tile);assert(!classes.size);
console.log('Syntax OK; Modern/Aurora trigger and cleanup, Classic/off/reduced-motion guards OK.');
