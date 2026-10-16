'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openStorageSession } = require('./harness/storage-session');
const { localStorageStub } = require('./harness/load');
const OLD = 'Synthetic-old-password-2026', NEW = 'Synthetic-new-password-2026';
const PAYLOAD = 'notenverwaltung_v1_state_enc', SALT = 'notenverwaltung_v1_salt', JOURNAL = 'notenverwaltung_v1_credential_journal', MIGRATION = 'notenverwaltung_v2_migration_backup';
const snapshot = s => Object.fromEntries(s._keys().sort().map(k => [k, s.getItem(k)]));
function state(app, name = 'Synthetic original') { const s = app.DomainModel.createEmptyState(); s.settings.schoolProfile = {name, logoMode:'none', logoDataUrl:''}; return s; }
async function setup(app, name) { const draft = await app.Storage.prepareRecoveryEnrollment({password:OLD, state:state(app,name)}); await app.Storage.confirmPreparedProtection(draft.token,draft.recoveryCode); await app.Storage.commitPreparedProtection(draft.token); return draft; }

test('preparation is write-free, confirmation is mandatory and opaque tokens cannot be forged or reused', async () => {
 const app = await openStorageSession(); const before = snapshot(app.storage);
 const d = await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});
 assert.deepEqual(snapshot(app.storage),before);
 await assert.rejects(app.Storage.commitPreparedProtection(d.token), {code:'RECOVERY_CONFIRMATION_REQUIRED'});
 await assert.rejects(app.Storage.confirmPreparedProtection({},d.recoveryCode));
 await assert.rejects(app.Storage.confirmPreparedProtection(d.token,'NV2-INVALID'));
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
 assert.deepEqual(snapshot(app.storage),before);
 const result = await app.Storage.commitPreparedProtection(d.token); assert.ok(result.receipt);
 await assert.rejects(app.Storage.commitPreparedProtection(d.token));
 assert.equal(app.storage.getItem(SALT),'v2-envelope'); assert.equal(app.Storage.hasSessionPassword(),true);
 assert.equal(app.storage.getItem(JOURNAL),null);
 const bytes = JSON.stringify(snapshot(app.storage)); for (const secret of [OLD,d.recoveryCode,'Synthetic original']) assert.equal(bytes.includes(secret),false);
 await app.Storage.lockSession();
});

test('save after prepare invalidates the original dialog snapshot', async () => {
 const app = await openStorageSession(); await setup(app);
 const d = await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});
 await app.Storage.saveState(state(app,'Synthetic newer'));
 await assert.rejects(app.Storage.confirmPreparedProtection(d.token,d.recoveryCode));
 const reader = await openStorageSession({storage:app.storage,password:OLD}); assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name,'Synthetic newer'); await reader.Storage.lockSession();
});

for (const legacy of [false,true]) test(`migration authenticates actual ${legacy?'plaintext':'V1'} state and retains encrypted backup`, async () => {
 const app = await openStorageSession();
 if (legacy) app.storage.setItem('notenverwaltung_v1_state',JSON.stringify(state(app)));
 else await app.Storage.enableEncryption(OLD,state(app));
 const before = snapshot(app.storage);
 const d = await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app,'Wrong caller state')});
 assert.deepEqual(snapshot(app.storage),before);
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode); await app.Storage.commitPreparedProtection(d.token);
 assert.equal((await app.Storage.loadCurrentSessionState()).settings.schoolProfile.name,'Synthetic original');
 const backup = app.Storage.getRecoveryMigrationBackup(); assert.ok(backup); assert.equal(backup.includes('Synthetic original'),false);
 assert.equal((await app.Storage.importStateEncryptedFromText(backup,OLD)).settings.schoolProfile.name,'Synthetic original');
 await app.Storage.resetState(); assert.equal(app.storage.getItem(MIGRATION),null); await app.Storage.lockSession();
});

test('V2 backup import keeps local protection and rotation revokes old credentials only for new files', async () => {
 const app = await openStorageSession(); const old = await setup(app); const backup = await app.Storage.encryptForBackup(JSON.stringify(state(app)));
 const d = await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode); await app.Storage.commitPreparedProtection(d.token);
 const current = app.storage.getItem(PAYLOAD);
 const imported = await app.Storage.importStateEncryptedWithRecovery(backup,old.recoveryCode); await app.Storage.replaceState(imported);
 assert.equal(app.Storage.getRecoveryStatus().metadata.generationId,d.metadata.generationId);
 await assert.rejects(app.Storage.importStateEncryptedWithRecovery(current,old.recoveryCode));
 assert.equal((await app.Storage.importStateEncryptedFromText(backup,OLD)).settings.schoolProfile.name,'Synthetic original');
 await assert.rejects(app.Storage.changePassword(NEW,OLD),{code:'RECOVERY_CONFIRMATION_REQUIRED'}); await assert.rejects(app.Storage.enableEncryption(OLD,state(app)),{code:'RECOVERY_CONFIRMATION_REQUIRED'});
 await app.Storage.lockSession();
});

for (const source of ['local','backup']) test(`locked ${source} recovery needs new confirmed code and file replacement consent`, async () => {
 const writer = await openStorageSession(); const initial = await setup(writer); const backup = writer.storage.getItem(PAYLOAD);
 const app = await openStorageSession({storage:writer.storage}); const before = snapshot(app.storage);
 const opened = await app.Storage.openRecoverySource({source,text:backup,code:initial.recoveryCode});
 const d = await app.Storage.prepareRecoveredProtection(opened.sourceToken,{newPassword:NEW});
 assert.deepEqual(snapshot(app.storage),before); await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
 if(source==='backup') await assert.rejects(app.Storage.commitPreparedProtection(d.token),{code:'RECOVERY_REPLACEMENT_REQUIRED'});
 await app.Storage.commitPreparedProtection(d.token,{replaceExisting:true});
 assert.equal((await app.Storage.loadCurrentSessionState()).settings.schoolProfile.name,'Synthetic original'); await app.Storage.lockSession();
});

test('lock discards drafts and source tokens', async () => {
 const app = await openStorageSession(); const d = await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)}); await app.Storage.lockSession();
 await app.sessionCoordinator.acquire(); await assert.rejects(app.Storage.confirmPreparedProtection(d.token,d.recoveryCode)); assert.equal(app.storage.getItem(PAYLOAD),null);
});

test('startup recovery accepts only a current authentic commit receipt', async () => {
 const writer = await openStorageSession(); const old = await setup(writer);
 const app = await openStorageSession({storage:writer.storage});
 app.sandbox.window.promptPassword = async options => { assert.equal(await options.onRecovery(),true); return null; };
 const loaded = await app.Storage.loadState({onRecoveryRequested:async () => { const s = await app.Storage.openRecoverySource({source:'local',code:old.recoveryCode}); const d=await app.Storage.prepareRecoveredProtection(s.sourceToken,{newPassword:NEW}); await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode); return app.Storage.commitPreparedProtection(d.token); }});
 assert.equal(loaded.settings.schoolProfile.name,'Synthetic original'); await app.Storage.lockSession();
 const fake = await openStorageSession({storage:writer.storage}); fake.sandbox.window.promptPassword=async options=>{assert.equal(await options.onRecovery(),false);return null;}; await fake.Storage.loadState({onRecoveryRequested:async()=>({receipt:{}})}); assert.equal(fake.Storage.hasSessionPassword(),false);
});
function restore(bytes) { const s=localStorageStub(); for(const [k,v] of Object.entries(bytes)) s.setItem(k,v); return s; }
function observe(storage, callback) { for(const method of ['setItem','removeItem']) {const original=storage[method].bind(storage);storage[method]=(...args)=>{original(...args);callback(snapshot(storage),args[0]);};} }
async function rawEnvelope(app,json,password=OLD) { const vm=require('node:vm'); const {bundleEsmGraph}=require('./harness/load-esm-graph'); vm.runInContext(bundleEsmGraph('src/infrastructure/recovery-envelope.js',{globalName:'__recovery_test'}),app.sandbox); return app.sandbox.__recovery_test.createEnvelope(json,password); }

for(const bad of ['null','{}','[]']) test(`authenticated ${bad} is rejected before domain repair`,async()=>{
 const app=await openStorageSession();const envelope=await rawEnvelope(app,bad); const before=snapshot(app.storage);
 await assert.rejects(app.Storage.openRecoverySource({source:'backup',text:envelope.envelopeText,code:envelope.recoveryCode}),{code:'STATE_CONTENT_INVALID'});
 await assert.rejects(app.Storage.importStateEncryptedFromText(envelope.envelopeText,OLD),{code:'STATE_CONTENT_INVALID'});
 assert.deepEqual(snapshot(app.storage),before);await app.Storage.lockSession();
});

for(const transition of ['setup','V1 migration','plain migration','rotation','file recovery']) test(`every ${transition} write prefix reopens complete confirmed data`,async()=>{
 const app=await openStorageSession();let d;
 if(transition==='setup') d=await app.Storage.prepareRecoveryEnrollment({password:NEW,state:state(app)});
 if(transition==='V1 migration') {await app.Storage.enableEncryption(OLD,state(app));d=await app.Storage.prepareRecoveryEnrollment({password:OLD});}
 if(transition==='plain migration') {app.storage.setItem('notenverwaltung_v1_state',JSON.stringify(state(app)));d=await app.Storage.prepareRecoveryEnrollment({password:NEW});}
 if(transition==='rotation') {await setup(app);d=await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'code-replacement'});}
 if(transition==='file recovery') {const e=await rawEnvelope(app,JSON.stringify(state(app)));const source=await app.Storage.openRecoverySource({source:'backup',text:e.envelopeText,code:e.recoveryCode});d=await app.Storage.prepareRecoveredProtection(source.sourceToken,{newPassword:NEW});}
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);const prefixes=[];observe(app.storage,bytes=>prefixes.push(bytes));await app.Storage.commitPreparedProtection(d.token,{replaceExisting:true});await app.Storage.lockSession();
 for(const [i,bytes] of prefixes.entries()) {const reader=await openStorageSession({storage:restore(bytes),password:transition==='V1 migration'?OLD:NEW});try{const loaded=await reader.Storage.loadState();assert.equal(reader.Storage.hasSessionPassword(),true,`prefix ${i}`);assert.equal(loaded.settings.schoolProfile.name,'Synthetic original');assert.equal(reader.storage.getItem(JOURNAL),null);}finally{await reader.Storage.lockSession();}}
});

test('migration quota before active switch preserves original credentials and no plaintext copy',async()=>{
 const app=await openStorageSession();await app.Storage.enableEncryption(OLD,state(app));const before=snapshot(app.storage);const d=await app.Storage.prepareRecoveryEnrollment({password:OLD});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
 const set=app.storage.setItem.bind(app.storage);app.storage.setItem=(key,value)=>{if(key===MIGRATION) throw new Error('Synthetic quota');set(key,value);};
 await assert.rejects(app.Storage.commitPreparedProtection(d.token));assert.deepEqual(snapshot(app.storage),before);assert.equal(app.Storage.hasSessionPassword(),false);
});

test('startup receipt cannot unlock after lock during callback completion',async()=>{
 const writer=await openStorageSession();const old=await setup(writer);const app=await openStorageSession({storage:writer.storage});
 app.sandbox.window.promptPassword=async options=>{assert.equal(await options.onRecovery(),false);return null;};
 await assert.rejects(app.Storage.loadState({onRecoveryRequested:async()=>{const opened=await app.Storage.openRecoverySource({source:'local',code:old.recoveryCode});const d=await app.Storage.prepareRecoveredProtection(opened.sourceToken,{newPassword:NEW});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);const result=await app.Storage.commitPreparedProtection(d.token);await app.Storage.lockSession();return result;}}),{code:'STORAGE_GENERATION_STALE'});
 assert.equal(app.Storage.hasSessionPassword(),false);
});

test('token timeout in locked recovery clears pending secrets and prevents later confirmation',async()=>{
 let now=Date.now();class Clock extends Date {static now(){return now;}}
 const app=await openStorageSession({dateImpl:Clock});const d=await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});now+=15*60*1000;
 await assert.rejects(app.Storage.confirmPreparedProtection(d.token,d.recoveryCode),{code:'RECOVERY_TOKEN_INVALID'});assert.equal(app.storage.getItem(PAYLOAD),null);await app.Storage.lockSession();
});

test('a second interrupted recovery preserves all complete generations from its prior journal',async()=>{
 const writer=await openStorageSession();await setup(writer);const rotated=await writer.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});await writer.Storage.confirmPreparedProtection(rotated.token,rotated.recoveryCode);const prefixes=[];observe(writer.storage,bytes=>prefixes.push(bytes));await writer.Storage.commitPreparedProtection(rotated.token);await writer.Storage.lockSession();
 const mixed=prefixes.find(bytes=>bytes[JOURNAL] && bytes[PAYLOAD]!==JSON.parse(bytes[JOURNAL]).after[0]);assert.ok(mixed);
 const app=await openStorageSession({storage:restore(mixed)});const source=await app.Storage.openRecoverySource({source:'local',code:rotated.recoveryCode});const d=await app.Storage.prepareRecoveredProtection(source.sourceToken,{newPassword:'Synthetic third password'});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);const second=[];observe(app.storage,bytes=>second.push(bytes));await app.Storage.commitPreparedProtection(d.token);await app.Storage.lockSession();
 for(const bytes of second){const reader=await openStorageSession({storage:restore(bytes),password:'Synthetic third password'});try{assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name,'Synthetic original');assert.equal(reader.Storage.hasSessionPassword(),true);}finally{await reader.Storage.lockSession();}}
});
for(const phase of ['prepare','confirm','commit']) for(const disruption of ['lock','owner loss','foreign write']) test(`${disruption} during ${phase} never publishes a late V2 session`,async()=>{
 let hook=null;const facade={getRandomValues:crypto.getRandomValues.bind(crypto),subtle:new Proxy(crypto.subtle,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return async(...args)=>{const result=await fn.apply(target,args);if(hook){const run=hook;hook=null;await run();}return result;};}})};
 const app=await openStorageSession({cryptoImpl:facade});let draft;
 if(phase!=='prepare') draft=await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});
 if(phase==='commit')await app.Storage.confirmPreparedProtection(draft.token,draft.recoveryCode);
 hook=async()=>{if(disruption==='lock')await app.Storage.lockSession();else if(disruption==='owner loss')await app.sessionCoordinator.release();else app.storage.setItem(MIGRATION,'Synthetic foreign bytes');};
 const pending=phase==='prepare'?app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)}):phase==='confirm'?app.Storage.confirmPreparedProtection(draft.token,draft.recoveryCode):app.Storage.commitPreparedProtection(draft.token);
 await assert.rejects(pending);assert.equal(app.Storage.hasSessionPassword(),false);
 if(disruption==='foreign write')assert.equal(app.storage.getItem(MIGRATION),'Synthetic foreign bytes');
 if(phase!=='commit')assert.equal(app.storage.getItem(PAYLOAD),null);await app.Storage.lockSession();
});

for(const disruption of ['lock','owner loss']) test(`commit rechecks ${disruption} after final journal cleanup microtask`,async()=>{
 const app=await openStorageSession();const d=await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
 const remove=app.storage.removeItem.bind(app.storage);app.storage.removeItem=key=>{remove(key);if(key===JOURNAL)queueMicrotask(()=>{if(disruption==='lock')app.Storage.lockSession();else app.sessionCoordinator.release();});};
 await assert.rejects(app.Storage.commitPreparedProtection(d.token));assert.equal(app.Storage.hasSessionPassword(),false);await app.Storage.lockSession();
});

for(const failure of ['before','after']) test(`every setup mutation ${failure}-write failure leaves a complete recoverable candidate`,async()=>{
 for(let failAt=1;failAt<=6;failAt++){
  const app=await openStorageSession();const d=await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
  let calls=0;for(const method of ['setItem','removeItem']){const original=app.storage[method].bind(app.storage);app.storage[method]=(...args)=>{calls++;const fail=calls===failAt;if(fail && failure==='before')throw new Error('Synthetic quota');original(...args);if(fail)throw new Error('Synthetic mutate then throw');};}
  await assert.rejects(app.Storage.commitPreparedProtection(d.token));assert.equal(app.Storage.hasSessionPassword(),false);const bytes=snapshot(app.storage);
  if(bytes[PAYLOAD]||bytes[JOURNAL]){const reader=await openStorageSession({storage:restore(bytes),password:OLD});assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name,'Synthetic original');assert.equal(reader.Storage.hasSessionPassword(),true);await reader.Storage.lockSession();}
  await app.Storage.lockSession();
 }
});
test('V1 password change migrates directly with old-password backup and new confirmed V2 access',async()=>{
 const app=await openStorageSession();await app.Storage.enableEncryption(OLD,state(app));const before=snapshot(app.storage);
 const d=await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});assert.deepEqual(snapshot(app.storage),before);
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);await app.Storage.commitPreparedProtection(d.token);
 assert.equal((await app.Storage.importStateEncryptedFromText(app.Storage.getRecoveryMigrationBackup(),OLD)).settings.schoolProfile.name,'Synthetic original');
 const reader=await openStorageSession({storage:app.storage,password:NEW});assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name,'Synthetic original');await reader.Storage.lockSession();
});
test('raw invalid term results are rejected before normalization in a fully authenticated file',async()=>{
 const app=await openStorageSession();const raw=state(app);raw.courses=[{id:'synthetic-course',termResults:{unexpected:'invalid'}}];const envelope=await rawEnvelope(app,JSON.stringify(raw));
 await assert.rejects(app.Storage.verifyRecoveryCode({source:'backup',text:envelope.envelopeText,code:envelope.recoveryCode}),{code:'STATE_CONTENT_INVALID'});assert.equal(app.storage.getItem(PAYLOAD),null);await app.Storage.lockSession();
});

test('a backup readback failure retains the journal and allows a fresh authenticated restart',async()=>{
 let failDecrypt=false;const facade={getRandomValues:crypto.getRandomValues.bind(crypto),subtle:new Proxy(crypto.subtle,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return async(...args)=>{if(key==='decrypt'&&failDecrypt)throw new DOMException('Synthetic readback failure','NotSupportedError');return fn.apply(target,args);};}})};
 const app=await openStorageSession({cryptoImpl:facade});const d=await app.Storage.prepareRecoveryEnrollment({password:OLD,state:state(app)});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);failDecrypt=true;
 await assert.rejects(app.Storage.commitPreparedProtection(d.token));assert.ok(app.storage.getItem(JOURNAL));assert.equal(app.Storage.hasSessionPassword(),false);
 const reader=await openStorageSession({storage:app.storage,password:OLD});assert.equal((await reader.Storage.loadState()).settings.schoolProfile.name,'Synthetic original');await reader.Storage.lockSession();
});

test('a second mutation failure during rollback leaves journal candidates usable',async()=>{
 for(const failAt of [2,3,4,5]) {
  const app=await openStorageSession();await app.Storage.enableEncryption(OLD,state(app));const d=await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);
  let count=0;for(const method of ['setItem','removeItem']){const original=app.storage[method].bind(app.storage);app.storage[method]=(...args)=>{count++;original(...args);if(count===failAt||count===failAt+1)throw new Error('Synthetic rollback failure');};}
  await assert.rejects(app.Storage.commitPreparedProtection(d.token));const bytes=snapshot(app.storage);let reopened=false;
  for(const password of [OLD,NEW]){const reader=await openStorageSession({storage:restore(bytes),password});try{const loaded=await reader.Storage.loadState();if(reader.Storage.hasSessionPassword()){assert.equal(loaded.settings.schoolProfile.name,'Synthetic original');reopened=true;}}finally{await reader.Storage.lockSession();}}
  assert.equal(reopened,true);await app.Storage.lockSession();
 }
});

test('a stale startup recovery callback cannot start after another session has acquired ownership',async()=>{
 const writer=await openStorageSession();await setup(writer);const app=await openStorageSession({storage:writer.storage});let invoked=0;
 app.sandbox.window.promptPassword=async options=>{await app.Storage.lockSession();await app.sessionCoordinator.acquire();await assert.rejects(options.onRecovery(),{code:'STORAGE_GENERATION_STALE'});return null;};
 await assert.rejects(app.Storage.loadState({onRecoveryRequested:async()=>{invoked++;return null;}}),{code:'STORAGE_GENERATION_STALE'});assert.equal(invoked,0);await app.Storage.lockSession();
});
test('cancelling a recovery source during derivation leaves no orphan draft or token timeout',async()=>{
 let hook=null;let next=0;const timers=new Map();const facade={getRandomValues:crypto.getRandomValues.bind(crypto),subtle:new Proxy(crypto.subtle,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return async(...args)=>{const result=await fn.apply(target,args);if(hook){const run=hook;hook=null;run();}return result;};}})};
 const app=await openStorageSession({cryptoImpl:facade,setTimeoutImpl:fn=>{timers.set(++next,fn);return next;},clearTimeoutImpl:id=>timers.delete(id)});
 const envelope=await rawEnvelope(app,JSON.stringify(state(app)));const source=await app.Storage.openRecoverySource({source:'backup',text:envelope.envelopeText,code:envelope.recoveryCode});
 hook=()=>app.Storage.cancelPreparedProtection(source.sourceToken);
 await assert.rejects(app.Storage.prepareRecoveredProtection(source.sourceToken,{newPassword:NEW}));
 assert.equal(timers.size,0);assert.equal(app.storage.getItem(PAYLOAD),null);await app.Storage.lockSession();
});
test('a rejected crypto completion after owner loss clears the previously unlocked session',async()=>{
 let fail=false,app;const facade={getRandomValues:crypto.getRandomValues.bind(crypto),subtle:new Proxy(crypto.subtle,{get(target,key){const fn=Reflect.get(target,key,target);if(typeof fn!=='function')return fn;return async(...args)=>{if(fail&&key==='decrypt'){await app.sessionCoordinator.release();throw new DOMException('Synthetic failure','OperationError');}return fn.apply(target,args);};}})};
 app=await openStorageSession({cryptoImpl:facade});const d=await setup(app);fail=true;
 await assert.rejects(app.Storage.openRecoverySource({source:'local',code:d.recoveryCode}));assert.equal(app.Storage.hasSessionPassword(),false);await app.Storage.lockSession();
});
async function interruptedRotationFixture() {
 const app=await openStorageSession();await setup(app);
 const d=await app.Storage.prepareCredentialRotation({currentPassword:OLD,newPassword:NEW,reason:'password-change'});
 await app.Storage.confirmPreparedProtection(d.token,d.recoveryCode);let bytes;
 observe(app.storage,(current,key)=>{if(key===JOURNAL&&!bytes)bytes=current;});
 await app.Storage.commitPreparedProtection(d.token);await app.Storage.lockSession();
 return {bytes,code:d.recoveryCode};
}
async function failRepeatedRecovery(fixture,firstFailure,firstMode,secondOffset=null,secondMode='before') {
 const app=await openStorageSession({storage:restore(fixture.bytes)});
 const source=await app.Storage.openRecoverySource({source:'local',code:fixture.code});
 const draft=await app.Storage.prepareRecoveredProtection(source.sourceToken,{newPassword:'Synthetic third password'});
 await app.Storage.confirmPreparedProtection(draft.token,draft.recoveryCode);
 let calls=0;const prefixes=[];
 for(const method of ['setItem','removeItem']) {
  const original=app.storage[method].bind(app.storage);
  app.storage[method]=(...args)=>{
   calls++;
   const mode=calls===firstFailure?firstMode:calls===firstFailure+secondOffset&&secondOffset!==null?secondMode:null;
   if(mode==='before')throw new Error('Synthetic repeated recovery before-write failure');
   original(...args);prefixes.push({call:calls,bytes:snapshot(app.storage)});
   if(mode==='after')throw new Error('Synthetic repeated recovery mutate-then-throw failure');
  };
 }
 await assert.rejects(app.Storage.commitPreparedProtection(draft.token));
 assert.equal(app.Storage.hasSessionPassword(),false);
 const result={prefixes,calls,bytes:snapshot(app.storage),generation:draft.metadata.generationId};
 await app.Storage.lockSession();return result;
}
async function assertRepeatedRecoveryReadable(bytes,thirdGeneration,label) {
 const candidate=bytes[JOURNAL]?JSON.parse(bytes[JOURNAL]).after[0]:bytes[PAYLOAD];
 const password=JSON.parse(candidate).generationId===thirdGeneration?'Synthetic third password':NEW;
 const reader=await openStorageSession({storage:restore(bytes),password});
 try {
  const loaded=await reader.Storage.loadState();
  assert.equal(reader.Storage.hasSessionPassword(),true,label);
  assert.equal(loaded.settings.schoolProfile.name,'Synthetic original',label);
 } finally {await reader.Storage.lockSession();}
}

test('every rollback write prefix of a second recovery retains a readable complete generation',async()=>{
 const fixture=await interruptedRotationFixture();
 for(const mode of ['before','after'])for(let failAt=1;failAt<=6;failAt++){
  const result=await failRepeatedRecovery(fixture,failAt,mode);
  for(const prefix of result.prefixes)await assertRepeatedRecoveryReadable(prefix.bytes,result.generation,`${mode} failure ${failAt}, prefix ${prefix.call}`);
 }
});

test('a second before-write or mutate-then-throw rollback failure during repeated recovery stays readable',async()=>{
 const fixture=await interruptedRotationFixture();
 const probe=await failRepeatedRecovery(fixture,3,'after');
 for(const secondMode of ['before','after'])for(let offset=1;offset<=probe.calls-3;offset++){
  const result=await failRepeatedRecovery(fixture,3,'after',offset,secondMode);
  for(const prefix of result.prefixes)await assertRepeatedRecoveryReadable(prefix.bytes,result.generation,`second ${secondMode} ${offset}, prefix ${prefix.call}`);
  await assertRepeatedRecoveryReadable(result.bytes,result.generation,`second ${secondMode} ${offset}, final`);
 }
});
