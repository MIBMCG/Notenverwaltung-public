// Local replacement for the two presentation controls supplied by the chat host.
// This adapter changes only the in-memory concept state, never browser storage.
globalThis.Tweak = class {
  constructor({container,onChange}) {
    this.onChange=onChange;
    this.panel=document.createElement('details');
    this.panel.className='hwg-standalone-controls';
    this.panel.innerHTML='<summary>Entwurfsoptionen</summary><div class="hwg-standalone-fields"></div>';
    container.querySelector('.hwg-designbar').append(this.panel);
  }
  addSelect(state,key,{label,options}) {
    const select=document.createElement('select');select.className='hwg-select';
    options.forEach(({label,value})=>select.add(new Option(label,value)));
    select.value=state[key];
    select.addEventListener('change',()=>{state[key]=select.value;this.onChange();});
    this.addField(label,select);
  }
  addSlider(state,key,{label,min,max,step,unit}) {
    const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=state[key];
    const output=document.createElement('span');output.textContent=`${state[key]} ${unit}`;
    input.addEventListener('input',()=>{state[key]=Number(input.value);output.textContent=`${state[key]} ${unit}`;this.onChange();});
    this.addField(label,input).append(output);
  }
  addField(text,input) {
    const label=document.createElement('label');label.className='hwg-field';label.append(document.createTextNode(text),input);
    this.panel.querySelector('div').append(label);return label;
  }
};
