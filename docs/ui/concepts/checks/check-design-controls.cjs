const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

const designbar=(source.match(/<div class="hwg-designbar">([\s\S]*?)<main class="hwg-content">/)||[])[1]||'';
const rootRule=(source.match(/#hwg-concepts\{([^}]+)\}/)||[])[1]||'';
assert.match(rootRule,/width:100%/,'The concept root fills the frame width.');
assert.match(rootRule,/padding:16px/,'The concept root retains the active-background breathing room.');
assert.match(rootRule,/box-sizing:border-box/,'Root padding is included in its 100% width, preventing document-level horizontal overflow.');
assert.match(designbar,/id="hwg-motion-level"/,'The active design bar exposes the motion-level control.');
for(const [value,label] of [['off','Ohne Bewegung'],['calm','Dezent'],['vivid','Deutlich']]){
  assert.match(designbar,new RegExp(`<option value="${value}"[^>]*>${label}<\\/option>`),`Motion level ${value} has its teacher-facing label.`);
}
const accentButtons=[...designbar.matchAll(/<button[^>]+data-accent="([^"]+)"[^>]*>/g)];
assert.deepEqual(accentButtons.map(match=>match[1]),['standard','blue','green','petrol','violet','amber'],'The palette offers the design default and five named accent choices in a stable order.');
assert.equal(accentButtons.filter(match=>/role="radio"/.test(match[0])).length,6,'Every accent choice participates in the keyboard-accessible radio group.');
for(const label of ['Standard des Designs','Blau','Grün','Petrol','Violett','Bernstein'])assert.match(designbar,new RegExp(`>${label}<`),`Accent ${label} is identified by text.`);
const backgroundButtons=[...designbar.matchAll(/<button[^>]+data-background="([^"]+)"[^>]*>/g)];
assert.deepEqual(backgroundButtons.map(match=>match[1]),['standard','blue','green','petrol','violet','amber'],'The background palette offers the design default and five named choices in a stable order.');
assert.equal(backgroundButtons.filter(match=>/role="radio"/.test(match[0])).length,6,'Every background choice participates in its own keyboard-accessible radio group.');
assert.match(designbar,/aria-label="Hintergrundfarbe"/,'Background choices have an unambiguous group label.');
assert.match(source,/root\.querySelectorAll\('\[data-background\]'\)\.forEach\(b=>\{const selected=b\.dataset\.background===state\.background;b\.setAttribute\('aria-checked',String\(selected\)\);b\.tabIndex=selected\?0:-1;\}\)/,'The selected background is the only tab stop after design state is applied.');

const luminance=hex=>{const full=hex.length===3?[...hex].map(char=>char+char).join(''):hex;const channels=full.match(/../g).map(pair=>parseInt(pair,16)/255).map(value=>value<=.03928?value/12.92:((value+.055)/1.055)**2.4);return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];};
const contrast=(a,b)=>{const first=luminance(a),second=luminance(b);return (Math.max(first,second)+.05)/(Math.min(first,second)+.05);};
const mix=(base,glow,amount)=>[0,2,4].map(offset=>Math.round(parseInt(base.slice(offset,offset+2),16)*(1-amount)+parseInt(glow.slice(offset,offset+2),16)*amount).toString(16).padStart(2,'0')).join('');
for(const mode of ['light','dark'])for(const accent of ['blue','green','petrol','violet','amber']){
  const selector=mode==='dark'?`#hwg-concepts[data-mode="dark"][data-accent="${accent}"]`:`#hwg-concepts[data-accent="${accent}"]`;
  const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),block=(source.match(new RegExp(escaped+'\\{([^}]+)\\}'))||[])[1]||'';
  const foreground=(block.match(/--hwg-accent:#([0-9a-f]+)/i)||[])[1],background=(block.match(/--hwg-on-accent:#([0-9a-f]+)/i)||[])[1];
  assert.ok(foreground&&background,`Palette tokens exist for ${mode} ${accent}.`);assert.ok(contrast(foreground,background)>=4.5,`Primary-button contrast is at least 4.5:1 for ${mode} ${accent}.`);
}

function rootVariables(attributes){
  const winners=new Map();let order=0;
  for(const match of source.matchAll(/(#hwg-concepts[^{}]*)\{([^{}]*)\}/g)){
    const selectors=match[1].split(',');
    for(const rawSelector of selectors){
      const selector=rawSelector.trim(),rest=selector.slice('#hwg-concepts'.length);
      if(!selector.startsWith('#hwg-concepts')||/\s/.test(rest))continue;
      const negated=[...rest.matchAll(/:not\(\[data-([^=]+)="([^"]+)"\]\)/g)];
      if(negated.some(([,name,value])=>attributes[name]===value))continue;
      const required=rest.replace(/:not\([^)]*\)/g,'');
      if([...required.matchAll(/\[data-([^=]+)="([^"]+)"\]/g)].some(([,name,value])=>attributes[name]!==value))continue;
      const specificity=(rest.match(/\[/g)||[]).length;
      for(const declaration of match[2].matchAll(/(--hwg-[\w-]+):([^;]+)/g)){
        const previous=winners.get(declaration[1]);
        if(!previous||specificity>previous.specificity||(specificity===previous.specificity&&order>=previous.order))winners.set(declaration[1],{value:declaration[2].trim(),specificity,order});
      }
      order++;
    }
  }
  const vars=Object.fromEntries([...winners].map(([name,entry])=>[name,entry.value]));
  const resolve=value=>value.replace(/var\((--hwg-[\w-]+)\)/g,(_,name)=>vars[name]===undefined?`var(${name})`:resolve(vars[name]));
  return Object.fromEntries(Object.entries(vars).map(([name,value])=>[name,resolve(value)]));
}
for(const family of ['modern','classic','aurora'])for(const mode of ['light','dark'])for(const accent of ['standard','blue','green','petrol','violet','amber']){
  const vars=rootVariables({family,mode,accent});
  assert.equal(vars['--hwg-focus-ring'],vars['--hwg-accent'],`${family} ${mode} ${accent} focus follows the effective accent.`);
}
assert.match(source,/\.hwg-score:focus\{[^}]*outline:3px solid var\(--hwg-focus-ring\)/,'Focused grade inputs consume the effective focus-ring token.');
for(const family of ['modern','classic','aurora'])for(const mode of ['light','dark']){
  const defaults=rootVariables({family,mode,accent:'standard'});
  assert.equal(defaults['--hwg-design-accent'],defaults['--hwg-accent'],`${family} ${mode} exposes its own default accent for the Standard swatch.`);
}
assert.match(source,/#hwg-concepts \[data-accent="standard"\]\{--swatch:var\(--hwg-design-accent\)\}/,'The Standard swatch keeps showing the current family default while another accent is selected.');
for(const family of ['modern','classic','aurora'])for(const mode of ['light','dark']){
  const defaults=rootVariables({family,mode,accent:'violet',background:'standard'});
  for(const background of ['blue','green','petrol','violet','amber']){
    const vars=rootVariables({family,mode,accent:'violet',background});
    assert.notEqual(vars['--hwg-app'],defaults['--hwg-app'],`${family} ${mode} ${background} visibly changes the application surface.`);
    assert.notEqual(vars['--hwg-panel'],defaults['--hwg-panel'],`${family} ${mode} ${background} changes large panel surfaces.`);
    assert.equal(vars['--hwg-accent'],defaults['--hwg-accent'],`${family} ${mode} background never changes the chosen accent.`);
    assert.equal(vars['--hwg-error-bg'],defaults['--hwg-error-bg'],`${family} ${mode} background leaves error fills semantic.`);
  }
}
assert.match(source,/#hwg-concepts \[data-background="standard"\]\{--swatch:var\(--hwg-design-app\)\}/,'The Standard background swatch reflects the current family surface.');
assert.match(source,/#hwg-concepts\[data-family="aurora"\] \.hwg-sidebar\{position:relative;isolation:isolate;overflow:hidden;background:linear-gradient\(158deg,var\(--hwg-nav\),color-mix\(in srgb,var\(--hwg-accent\) 16%,var\(--hwg-nav\)\) 55%,color-mix\(in srgb,var\(--hwg-accent\) 25%,var\(--hwg-nav\)\)\);\}/,'Aurora Standard retains its established sidebar gradient.');
assert.match(source,/#hwg-concepts\[data-family="aurora"\] \.hwg-card-front\{background:radial-gradient\(ellipse at 90% 0%,color-mix\(in srgb,var\(--hwg-fx-glow\) 65%,transparent\),transparent 65%\),linear-gradient\(140deg,var\(--hwg-soft\),var\(--hwg-panel\)\);\}/,'Aurora Standard retains its established course-card gradient.');
for(const background of ['blue','green','petrol','violet','amber']){
  const rule=`#hwg-concepts[data-mode="dark"] [data-background="${background}"]{--swatch:`;
  const swatch=source.split(rule)[1]?.split('}')[0];
  assert.match(swatch||'',/^#[0-9a-f]{6}$/i,'Every dark background choice has a color sample.');
  for(const family of ['modern','classic','aurora'])for(const surface of ['standard','blue','green','petrol','violet','amber']){
    const vars=rootVariables({family,mode:'dark',accent:'standard',background:surface});
    assert.ok(contrast(swatch.slice(1),vars['--hwg-panel'].slice(1))>=3,`${background} sample remains visible on ${family}/${surface} dark panels.`);
  }
}
for(const background of ['blue','green','petrol','violet','amber']){
  const vars=rootVariables({family:'aurora',mode:'light',accent:'standard',background});
  assert.ok(contrast(vars['--hwg-nav'].slice(1),vars['--hwg-nav-ink'].slice(1))>=4.5,`Aurora light ${background} sidebar text has sufficient contrast.`);
  assert.ok(contrast(vars['--hwg-nav'].slice(1),vars['--hwg-nav-muted'].slice(1))>=4.5,`Aurora light ${background} sidebar secondary text has sufficient contrast.`);
  assert.ok(contrast(mix(vars['--hwg-nav'].slice(1),vars['--hwg-background-glow'].slice(1),.25),vars['--hwg-nav-muted'].slice(1))>=4.5,`Aurora light ${background} secondary text has sufficient contrast at the 25% sidebar-gradient endpoint.`);
}
for(const mode of ['light','dark']){
  const defaults=rootVariables({family:'aurora',mode,accent:'standard'});
  const expected=mode==='dark'?['#b8a4f5','#7edce7','#efb0da','#211d36']:['#522a91','#235c78','#683682','#fff'];
  assert.deepEqual(['--hwg-fx-a','--hwg-fx-b','--hwg-fx-c','--hwg-fx-ink'].map(name=>defaults[name]),expected,`Aurora ${mode} Standard retains its established gradient.`);
  const signatures=['blue','green','petrol','violet','amber'].map(accent=>{const vars=rootVariables({family:'aurora',mode,accent});return [vars['--hwg-fx-a'],vars['--hwg-fx-b'],vars['--hwg-fx-c'],vars['--hwg-fx-ink']].join('|');});
  assert.equal(new Set(signatures).size,5,`The final Aurora ${mode} cascade gives every named accent a distinct primary-button gradient.`);
}

{
  const state={background:'standard',accent:'green'},savePreview={revision:7};let applied=0;
  const context={state,savePreview,backgroundChoices:new Set(['standard','blue','green','petrol','violet','amber']),applyDesign:()=>{applied++;},globalThis:null};context.globalThis=context;vm.createContext(context);
  vm.runInContext(sliceBetween('function setBackgroundChoice(','function setAccentChoice('),context);
  assert.equal(context.setBackgroundChoice('violet'),true);assert.deepEqual(state,{background:'violet',accent:'green'});assert.equal(applied,1,'A valid background change reapplies the design once without changing the accent.');assert.equal(savePreview.revision,7,'Background changes never alter the data revision.');
  assert.equal(context.setBackgroundChoice('violet'),false,'Selecting the active background is a no-op.');assert.equal(context.setBackgroundChoice('internal-id'),false,'Unknown background values are ignored.');
}

{
  const buttons=['standard','blue','green'].map(background=>({dataset:{background},focus(){this.focused=true;}})),events={},state={background:'standard'};
  const backgrounds={querySelectorAll:()=>buttons,addEventListener:(type,handler)=>events[type]=handler};
  const context={state,security:{locked:false},setBackgroundChoice:value=>{state.background=value;return true;},globalThis:null};context.globalThis=context;vm.createContext(context);
  vm.runInContext(sliceBetween('function bindBackgroundKeyboard(','function bindDesignControls('),context);
  context.bindBackgroundKeyboard(backgrounds);assert.equal(typeof events.keydown,'function','Background radiogroup receives keyboard input.');
  let prevented=false;events.keydown({key:'ArrowRight',target:{closest:()=>buttons[0]},preventDefault:()=>{prevented=true;}});assert.equal(prevented,true,'Arrow navigation prevents page scrolling.');assert.equal(state.background,'blue','ArrowRight selects the adjacent background.');assert.equal(buttons[1].focused,true,'Arrow navigation moves focus with the selected radio.');
}
assert.match(source,/\.hwg-primary\{background:var\(--hwg-accent\);color:var\(--hwg-on-accent\)/,'Primary buttons consume the selected accent and its paired text color.');
assert.match(source,/\.hwg-navigation button\[aria-current="page"\][^}]+var\(--hwg-accent\)/,'The selected Aurora navigation state consumes the chosen accent.');

function sliceBetween(startNeedle,endNeedle){const start=source.indexOf(startNeedle),end=source.indexOf(endNeedle,start);assert.ok(start>=0&&end>start,`Could not isolate ${startNeedle}.`);return source.slice(start,end);}

{
  const state={accent:'standard'},savePreview={revision:7};let applied=0;
  const context={state,savePreview,accentChoices:new Set(['standard','blue','green','petrol','violet','amber']),applyDesign:()=>{applied++;},globalThis:null};context.globalThis=context;vm.createContext(context);
  vm.runInContext(sliceBetween('function setAccentChoice(','function motionDisabled('),context);
  assert.equal(context.setAccentChoice('violet'),true);assert.equal(state.accent,'violet');assert.equal(applied,1,'A valid accent change reapplies the design once.');assert.equal(savePreview.revision,7,'Appearance changes never alter the data revision.');
  assert.equal(context.setAccentChoice('violet'),false,'Selecting the active accent is a no-op.');assert.equal(context.setAccentChoice('internal-id'),false,'Unknown accent values are ignored.');
}

{
  const state={effects:'vivid'};let stopped=0,applied=0,demos=0,suppressed=false;
  const context={state,motionChoices:new Set(['off','calm','vivid']),stopTransientEffects:()=>{stopped++;},applyDesign:()=>{applied++;},motionDisabled:()=>suppressed||state.effects==='off',runMotionDemo:()=>{demos++;},globalThis:null};context.globalThis=context;vm.createContext(context);
  vm.runInContext(sliceBetween('function setMotionLevel(','function bindDesignControls('),context);
  assert.equal(context.setMotionLevel('calm'),true);assert.deepEqual({effects:state.effects,stopped,applied,demos},{effects:'calm',stopped:1,applied:1,demos:1},'A real level change stops old work, applies once and demonstrates once.');
  assert.equal(context.setMotionLevel('calm'),false);assert.equal(demos,1,'Re-selecting a level cannot replay the demonstration.');
  assert.equal(context.setMotionLevel('off'),true);assert.equal(demos,1,'Turning motion off never starts a demonstration.');
  suppressed=true;assert.equal(context.setMotionLevel('vivid'),true);assert.equal(demos,1,'A system reduced-motion preference suppresses level-change demonstrations.');
}

{
  const events={},accentGroup={addEventListener:(type,handler)=>events['accent-'+type]=handler},backgroundGroup={addEventListener:(type,handler)=>events['background-'+type]=handler},motion={addEventListener:(type,handler)=>events['motion-'+type]=handler};
  const reducedEvents={},draft={value:'99',ariaInvalid:'true'},state={background:'standard',accent:'standard',effects:'vivid'},savePreview={revision:9,invalid:true};let applied=0,stopped=0,demos=0;
  const context={root:{querySelector:selector=>selector==='.hwg-backgrounds'?backgroundGroup:selector==='.hwg-accents'?accentGroup:selector==='#hwg-motion-level'?motion:null},state,savePreview,security:{locked:false},backgroundChoices:new Set(['standard','blue','green','petrol','violet','amber']),accentChoices:new Set(['standard','blue','green','petrol','violet','amber']),motionChoices:new Set(['off','calm','vivid']),reducedMotion:{matches:false,addEventListener:(type,handler)=>reducedEvents[type]=handler},applyDesign(){applied++;},stopTransientEffects(){stopped++;},motionDisabled(){return context.reducedMotion.matches||state.effects==='off';},runMotionDemo(){demos++;},globalThis:null};context.globalThis=context;vm.createContext(context);
  vm.runInContext(sliceBetween('function setBackgroundChoice(','function motionDisabled('),context);vm.runInContext(sliceBetween('function setMotionLevel(','function bindDesignControls('),context);
  const block=sliceBetween('function bindDesignControls(','// Design controls bound.');vm.runInContext(block,context);
  assert.equal(typeof events['background-click'],'function','The actual background control is bound to click input.');assert.equal(typeof events['accent-click'],'function','The actual accent control is bound to click input.');assert.equal(typeof events['motion-change'],'function','The actual motion select is bound to change input.');
  events['background-click']({target:{closest:selector=>selector==='[data-background]'?{dataset:{background:'violet'}}:null}});events['accent-click']({target:{closest:selector=>selector==='[data-accent]'?{dataset:{accent:'green'}}:null}});events['motion-change']({target:{value:'calm'}});
  assert.deepEqual({background:state.background,accent:state.accent,level:state.effects},{background:'violet',accent:'green',level:'calm'},'The bound controls route independent background, accent and motion input to the real state setters.');assert.deepEqual({revision:savePreview.revision,invalid:savePreview.invalid,draftValue:draft.value,draftInvalid:draft.ariaInvalid},{revision:9,invalid:true,draftValue:'99',draftInvalid:'true'},'Presentation changes preserve the invalid draft and its data revision.');
  context.reducedMotion.matches=true;reducedEvents.change();assert.equal(stopped,2,'Changing the system preference cancels outstanding transient work.');assert.equal(applied,4,'Changing the system preference refreshes the visible control explanation.');
  context.security.locked=true;events['background-click']({target:{closest:()=>({dataset:{background:'blue'}})}});events['accent-click']({target:{closest:()=>({dataset:{accent:'blue'}})}});events['motion-change']({target:{value:'vivid'}});assert.deepEqual({background:state.background,accent:state.accent,level:state.effects},{background:'violet',accent:'green',level:'calm'},'Locked preview ignores appearance input.');
}

console.log('Design controls OK: named palette and motion levels, real handlers, data-revision isolation, one-shot demonstration and reduced-motion suppression verified.');
