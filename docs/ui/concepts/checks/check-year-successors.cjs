const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/../notenverwaltung-ansichten.fragment.html','utf8');

function makeRuntime(program){
  const events={},fields={
    '#hwg-year-plan-0':{value:'continue'},'#hwg-year-plan-1':{value:'end'},'#hwg-year-plan-2':{value:'continue'},
    '#hwg-year-name-0':{value:'<Bio weiter>'},'#hwg-year-class-0':{value:'  11a  '},
    '#hwg-year-name-1':{value:'Mathematik'},'#hwg-year-class-1':{value:'10b'},
    '#hwg-year-name-2':{value:'Biologie Leistungskurs'},'#hwg-year-class-2':{value:'Q3/Q4'},
    '#hwg-year-weight':{checked:true},'#hwg-year-target':{value:'2027'},
    '#hwg-year-retention':{value:'2029-07-31'},'#hwg-year-note':{value:''},'#hwg-year-confirm':{checked:true},
    '#hwg-year-error':{textContent:''}
  };
  const main={querySelector(selector){return fields[selector]||null;}};
  const context={
    root:{addEventListener(type,handler){events[type]=handler;}},main,
    modal:{querySelector:()=>null},state:{page:'year',detail:null,tool:null},security:{locked:false},
    extra:{qualification:'q1-q2'},
    admin:{courseMeta:{bio:{name:'<Naturkunde>',className:'10c'},math:{name:'Mathematik neu',className:'10d'},upper:{name:'Biologie Leistungskurs',className:'GK Biologie'}}},
    pupils:[['Becker, Emil',['2','3','4']]],upperRows:[{name:'Becker, Emil',scores:{Q1:['13']}}],
    heading:(title,subtitle,body)=>`${title}|${subtitle}|${body}`,
    btn:(label,action)=>`<button data-action="${action}">${label}</button>`,
    wField:(label,id,value)=>`<label>${label}<input id="${id}" value="${String(value)}"></label>`,
    wSelect:(label,id,items,current)=>`<label>${label}<select id="${id}">${items.map(([v,l])=>`<option value="${v}" ${v===current?'selected':''}>${l}</option>`).join('')}</select></label>`,
    noteBox:text=>`<aside>${text}</aside>`,detailRows:rows=>rows.map(row=>row.join('|')).join('\n'),
    sampleTable:(headers,rows)=>`<table>${headers.join('|')}|${rows.join('')}</table>`,
    upperTerms:()=>['Q1','Q2'],esc:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
    render(){},go(){},canNavigate:()=>true,categoryDialog(){},weightsDialog(){},openDialog(){},notice(){},performanceDialog(){},performanceList(){return [];},securityClick:()=>false,adminClick:()=>false,extraClick:()=>false,
    globalThis:null
  };
  context.globalThis=context;
  vm.createContext(context);
  const start=program.indexOf('const work=');
  const end=program.indexOf("root.addEventListener('change'",start);
  assert.ok(start>=0&&end>start,'Could not isolate active year workflow.');
  vm.runInContext(program.slice(start,end)+';globalThis.k5={work,yearView,workflowClick,readYearPlans,extra};',context);
  const clickStart=program.indexOf("root.addEventListener('click',e=>{");
  const clickEnd=program.indexOf("root.addEventListener('change'",clickStart);
  assert.ok(clickStart>=0&&clickEnd>clickStart,'Could not isolate the real delegated root click handler.');
  vm.runInContext(program.slice(clickStart,clickEnd),context);
  const delegatedClick=button=>{const realButton={dataset:button.dataset,classList:{contains:()=>false},hasAttribute:()=>false};events.click({target:{closest:selector=>selector==='button'?realButton:null}});};
  return {fields,delegatedClick,admin:context.admin,pupils:context.pupils,upperRows:context.upperRows,...context.k5};
}

const existingData=runtime=>JSON.stringify({admin:runtime.admin,pupils:runtime.pupils,upperRows:runtime.upperRows});

const step1Escape=makeRuntime(source);step1Escape.work.yearStep=1;
const step1=step1Escape.yearView();
assert.match(step1,/&lt;Naturkunde&gt; · 10c/,'Step 1 escapes dynamic current-course metadata.');
assert.doesNotMatch(step1,/<Naturkunde> · 10c/,'Step 1 never inserts the dynamic course-name sentinel as markup.');

const runtime=makeRuntime(source);
const dataBefore=existingData(runtime);
runtime.work.yearStep=2;
let step2=runtime.yearView();
assert.match(step2,/Neue Kursbezeichnung/,'Every continuing course needs a separately labelled successor-name field.');
assert.match(step2,/Neue Kursklasse/,'Every continuing course needs a separately labelled successor-class field.');
for(const index of [0,1,2]){
  assert.match(step2,new RegExp(`id="hwg-year-name-${index}"`),`Course ${index} has its own editable successor-name field.`);
  assert.match(step2,new RegExp(`id="hwg-year-class-${index}"`),`Course ${index} has its own editable successor-class field.`);
}
assert.match(step2,/value="&lt;Naturkunde&gt;"/,'The successor name is prefilled from the current course metadata.');
assert.match(step2,/value="10c"/,'The successor class is prefilled from the current course metadata.');
assert.match(step2,/value="Biologie Leistungskurs"/,'The Q successor name is prefilled from the current course metadata.');
assert.match(step2,/value="GK Biologie"/,'The Q successor class is prefilled from the current course.');

runtime.fields['#hwg-year-name-1'].value='END-NAME-SENTINEL';runtime.fields['#hwg-year-class-1'].value='END-CLASS-SENTINEL';
runtime.fields['#hwg-year-class-0'].value='<11 & a>';
runtime.delegatedClick({dataset:{action:'year-next'}});
assert.equal(runtime.work.yearStep,3,'The active workflow click route advances after valid successor entries.');
assert.deepEqual([...runtime.work.yearSuccessorNames],['<Bio weiter>','END-NAME-SENTINEL','Biologie Leistungskurs'],'The workflow keeps successor names when moving forward.');
assert.deepEqual([...runtime.work.yearSuccessorClasses],['<11 & a>','END-CLASS-SENTINEL','Q3/Q4'],'The workflow keeps successor classes when moving forward.');
assert.equal(existingData(runtime),dataBefore,'Planning successor courses changes neither current metadata nor example people or grades.');
let summary=runtime.yearView();
assert.match(summary,/Neue Kursbezeichnung/,'The review labels the successor name separately.');
assert.match(summary,/Neue Kursklasse/,'The review labels the successor class separately.');
assert.match(summary,/&lt;Bio weiter&gt;/,'The review escapes edited successor names.');
assert.match(summary,/&lt;11 &amp; a&gt;/,'The review escapes the edited successor class.');
assert.match(summary,/Biologie Leistungskurs/,'The Q1/Q2 successor is listed by its edited name.');
assert.match(summary,/Q3\/Q4/,'The Q1/Q2 successor is listed by its edited class.');
assert.match(summary,/<tr><td>Mathematik neu · 10d<\/td><td>Beenden<\/td><td>–<\/td><td>–<\/td><\/tr>/,'The actual ended-course row has no successor name or class.');
assert.doesNotMatch(summary,/END-(?:NAME|CLASS)-SENTINEL/,'Ended-course sentinel values must not appear as successors in the summary.');

runtime.delegatedClick({dataset:{action:'year-prev'}});
step2=runtime.yearView();
assert.match(step2,/value="&lt;Bio weiter&gt;"/,'Back navigation retains the edited successor name.');
assert.match(step2,/value="&lt;11 &amp; a&gt;"/,'Back navigation retains the escaped successor class.');

runtime.fields['#hwg-year-name-0'].value='   ';
runtime.delegatedClick({dataset:{action:'year-next'}});
assert.match(runtime.fields['#hwg-year-error'].textContent,/Kursbezeichnung/,'Whitespace-only successor names are rejected.');
runtime.fields['#hwg-year-name-0'].value='Biologie';
runtime.fields['#hwg-year-class-0'].value='   ';
runtime.delegatedClick({dataset:{action:'year-next'}});
assert.match(runtime.fields['#hwg-year-error'].textContent,/Kursklasse/,'Whitespace-only successor classes are rejected.');

const q3Guard=makeRuntime(source);q3Guard.work.yearStep=2;q3Guard.extra.qualification='q3-q4';
q3Guard.fields['#hwg-year-plan-0'].value='end';q3Guard.fields['#hwg-year-plan-1'].value='end';q3Guard.fields['#hwg-year-plan-2'].value='continue';
q3Guard.delegatedClick({dataset:{action:'year-next'}});
assert.equal(q3Guard.work.yearStep,2,'Q3/Q4 cannot advance as a regular successor.');
assert.match(q3Guard.fields['#hwg-year-error'].textContent,/Q3\/Q4 endet regulär/,'The existing Q3/Q4 completion guard remains active.');

const weightGuard=makeRuntime(source);weightGuard.work.yearStep=2;
weightGuard.fields['#hwg-year-plan-0'].value='end';weightGuard.fields['#hwg-year-plan-1'].value='end';weightGuard.fields['#hwg-year-plan-2'].value='continue';weightGuard.fields['#hwg-year-weight'].checked=false;
weightGuard.delegatedClick({dataset:{action:'year-next'}});
assert.equal(weightGuard.work.yearStep,2,'Q1/Q2 cannot advance without the explicit Q3/Q4 weighting check.');
assert.match(weightGuard.fields['#hwg-year-error'].textContent,/Gewichtung für Q3\/Q4/,'The existing Q1/Q2 weighting guard remains active.');

const ended=makeRuntime(source);ended.work.yearStep=2;
for(const index of [0,1,2]){ended.fields['#hwg-year-plan-'+index].value='end';ended.fields['#hwg-year-name-'+index].value='   ';ended.fields['#hwg-year-class-'+index].value='';}
ended.delegatedClick({dataset:{action:'year-next'}});
assert.equal(ended.work.yearStep,3,'Ended courses can advance without successor fields.');
assert.equal(ended.fields['#hwg-year-error'].textContent,'','Ended courses do not produce successor-field validation errors.');
ended.fields['#hwg-year-confirm'].checked=false;ended.delegatedClick({dataset:{action:'year-apply'}});
assert.equal(ended.work.yearDone,false,'The existing confirmation requirement still blocks applying the simulation.');
assert.match(ended.fields['#hwg-year-error'].textContent,/bestätigen/,'The existing confirmation error remains visible.');
ended.fields['#hwg-year-confirm'].checked=true;ended.delegatedClick({dataset:{action:'year-apply'}});
assert.equal(ended.work.yearDone,true,'The existing confirmed simulation path remains reachable.');
assert.equal(existingData(ended),existingData(makeRuntime(source)),'The simulated apply path preserves current metadata, example people and grades.');

const mutant=makeRuntime(source.replace("work.yearSuccessorNames=yearNames().map((_,i)=>main.querySelector('#hwg-year-name-'+i).value);",''));
mutant.work.yearStep=2;
assert.throws(()=>mutant.delegatedClick({dataset:{action:'year-next'}}),/trim/,'Mutation check: removing name capture breaks the actual successor workflow.');

const endedCellMutant=makeRuntime(source.replace("continuing?esc(work.yearSuccessorNames[i]):'–'","esc(work.yearSuccessorNames[i])").replace("continuing?esc(work.yearSuccessorClasses[i]):'–'","esc(work.yearSuccessorClasses[i])"));
endedCellMutant.work.yearStep=2;endedCellMutant.yearView();endedCellMutant.fields['#hwg-year-name-1'].value='END-NAME-SENTINEL';endedCellMutant.fields['#hwg-year-class-1'].value='END-CLASS-SENTINEL';
endedCellMutant.delegatedClick({dataset:{action:'year-next'}});
assert.match(endedCellMutant.yearView(),/END-NAME-SENTINEL[\s\S]*END-CLASS-SENTINEL/,'Mutation check: showing successor cells for an ended course is observable.');

console.log('Year successors OK: active year view and delegated workflow preserve separate successor fields, guard Q3/Q4 and weighting, allow ended courses without successor data, require confirmation, preserve example data and omit ended successor cells.');
