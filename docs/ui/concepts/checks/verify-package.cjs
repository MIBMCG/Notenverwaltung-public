const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(base,p),'utf8');
const fragment=read('notenverwaltung-ansichten.fragment.html');
const document=read('notenverwaltung-ansichten.html');
const encoded=document.match(/\bsrcdoc="([\s\S]*?)"><\/iframe>/)[1];
const frame=encoded.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
// Python's portable text reader normalizes Windows line endings in the export.
assert(frame.includes(fragment.replace(/\r\n/g,'\n')),'Portable edition must contain the concept source with normalized line endings');
assert(!/<(?:script|link|img)[^>]+(?:src|href)\s*=\s*["']https?:/i.test(frame),'No external resources');
assert(frame.includes("connect-src 'none'"),'Network access disabled');
assert(frame.includes('globalThis.Tweak = class'),'Portable design controls present');
assert(frame.includes('lucide v1.17.0'),'Pinned icons bundled');
assert(!/\b(?:localStorage|sessionStorage|fetch|XMLHttpRequest|WebSocket)\b/.test(fragment),'Concept must stay isolated from data/network APIs');
let scripts=0;
for(const match of frame.matchAll(/<script>([\s\S]*?)<\/script>/g)){new vm.Script(match[1]);scripts++;}
assert.equal(scripts,3,'Icons, portable controls and concept script parse');
assert(!fs.existsSync(path.join(base,'reference-screenshots')) || fs.readdirSync(path.join(base,'reference-screenshots')).length === 0,
  'Retired reference screenshots must not be included in the portable package');
console.log('Package OK: unchanged fragment, 3 scripts parse, offline resources and controls; no retired reference screenshots.');
