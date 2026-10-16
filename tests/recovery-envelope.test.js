'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');
const ENTRY = 'src/infrastructure/recovery-envelope.js';
const PASSWORD = ' Synthetisch ä \u0000 🦉 ';
const TEXT = ' {"text":"Grüße 🧬 é","array":[1,null]}\n';

function load(cryptoImpl = crypto) {
  assert.ok(fs.existsSync(path.join(__dirname, '..', ENTRY)), 'V2 recovery envelope module must exist');
  return loadEsmGraph(ENTRY, { globals: { crypto: cryptoImpl, TextEncoder, TextDecoder, btoa, atob } }).exports;
}
function hasCode(code) {
  return error => error.code === code && error.message === code;
}
function b64(bytes) { return Buffer.from(bytes).toString('base64'); }
function flip(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  bytes[0] ^= 1;
  return b64(bytes);
}
function base32(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map(group => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(group.padEnd(5, '0'), 2)]).join('');
}
function codeFor(key) {
  const checksum = nodeCrypto.createHash('sha256').update('notenverwaltung:recovery-code:v2\0').update(key).digest();
  const raw = base32(key) + base32(checksum).slice(0, 4);
  return 'NV2-' + raw.match(/.{4}/g).join('-');
}
function nodePasswordDek(e) {
  const key = nodeCrypto.pbkdf2Sync(PASSWORD, Buffer.concat([Buffer.from('notenverwaltung:password-wrap:v2\0'), Buffer.from(e.password.salt, 'base64')]), 600000, 32, 'sha256');
  const ciphertext = Buffer.from(e.password.wrappedKey, 'base64');
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.password.iv, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(JSON.stringify([e.format, e.version, e.algorithm, e.datasetId, e.generationId, e.createdAt,
    'password-wrap', e.password.kdf, e.password.iterations, e.password.salt])));
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
}

// Independent fixed input vector: node:crypto implements PBKDF2/GCM and a separate
// bit-string RFC4648 encoder, never importing production AAD or encoding helpers.
function independentVector({ plaintext = TEXT } = {}) {
  const dek = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
  const recoveryKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 32));
  const salt = Buffer.alloc(16, 7);
  const e = {
    format: 'notenverwaltung_envelope', version: 2,
    datasetId: '0123456789abcdef0123456789abcdef', generationId: 'abcdef0123456789abcdef0123456789',
    createdAt: '2026-10-16T08:00:00.000Z', algorithm: 'AES-256-GCM',
    password: { kdf: 'PBKDF2-SHA256', iterations: 600000, salt: b64(salt), iv: b64(Buffer.alloc(12, 8)), wrappedKey: '' },
    recovery: { encoding: 'base32-sha256-20-v1', iv: b64(Buffer.alloc(12, 9)), wrappedKey: '' },
    data: { savedAt: '2026-10-16T08:05:00.000Z', iv: b64(Buffer.alloc(12, 10)), ciphertext: '' }
  };
  const common = [e.format, e.version, e.algorithm, e.datasetId, e.generationId, e.createdAt];
  function encrypt(key, iv, aad, plain) {
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: 16 });
    cipher.setAAD(Buffer.from(JSON.stringify(aad)));
    return b64(Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
  }
  const passwordKey = nodeCrypto.pbkdf2Sync(PASSWORD, Buffer.concat([Buffer.from('notenverwaltung:password-wrap:v2\0'), salt]), 600000, 32, 'sha256');
  e.password.wrappedKey = encrypt(passwordKey, e.password.iv, [...common, 'password-wrap', e.password.kdf, e.password.iterations, e.password.salt], dek);
  e.recovery.wrappedKey = encrypt(recoveryKey, e.recovery.iv, [...common, 'recovery-wrap', e.recovery.encoding], dek);
  e.data.ciphertext = encrypt(dek, e.data.iv, [...common, 'state', e.data.savedAt,
    e.password.kdf, e.password.iterations, e.password.salt, e.password.iv, e.password.wrappedKey,
    e.recovery.encoding, e.recovery.iv, e.recovery.wrappedKey], Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext));
  return { e, envelopeText: JSON.stringify(e), recoveryCode: codeFor(recoveryKey) };
}

test('V2 exports exactly the opaque session API', () => {
  assert.deepEqual(Object.keys(load()).sort(), ['createEnvelope', 'disposeEnvelopeSession', 'inspectEnvelope', 'normalizeRecoveryCode', 'reencryptState', 'unlockEnvelope'].sort());
});

test('independent fixed Node crypto vector unlocks through password and recovery', async () => {
  const h = load();
  const v = independentVector();
  for (const access of [{ kind: 'password', value: PASSWORD }, { kind: 'recovery', value: v.recoveryCode }]) {
    const result = await h.unlockEnvelope(v.envelopeText, access);
    assert.equal(result.stateJson, TEXT);
    assert.ok(Object.isFrozen(result.session));
    assert.deepEqual(Object.keys(result.session), []);
  }
  const info = h.inspectEnvelope(v.envelopeText);
  assert.equal(info.createdAt, v.e.createdAt);
  assert.equal(info.savedAt, v.e.data.savedAt);
  assert.deepEqual(Object.keys(info).sort(), ['version', 'datasetId', 'generationId', 'createdAt', 'savedAt'].sort());
});

test('created envelope preserves exact Unicode and password bytes over both accesses', async () => {
  const h = load();
  const created = await h.createEnvelope(TEXT, PASSWORD, { datasetId: '1'.repeat(32) });
  assert.match(created.recoveryCode, /^NV2-(?:[A-Z2-7]{4}-){13}[A-Z2-7]{4}$/);
  assert.equal(h.inspectEnvelope(created.envelopeText).datasetId, '1'.repeat(32));
  for (const access of [{ kind: 'password', value: PASSWORD }, { kind: 'recovery', value: created.recoveryCode }]) {
    assert.equal((await h.unlockEnvelope(created.envelopeText, access)).stateJson, TEXT);
  }
  await assert.rejects(h.unlockEnvelope(created.envelopeText, { kind: 'password', value: PASSWORD.trim() + ' ' }), hasCode('AUTH'));
});

test('wrong secrets and invalid checksum have separate fixed errors', async () => {
  const h = load();
  const v = independentVector();
  await assert.rejects(h.unlockEnvelope(v.envelopeText, { kind: 'password', value: 'wrong synthetic' }), hasCode('AUTH'));
  await assert.rejects(h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: codeFor(Buffer.alloc(32, 99)) }), hasCode('AUTH'));
  await assert.rejects(h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode.slice(0, -1) + (v.recoveryCode.endsWith('A') ? 'B' : 'A') }), hasCode('RECOVERY_CODE_INVALID'));
});

test('recovery normalization permits only ASCII case, whitespace and hyphens', async () => {
  const h = load();
  const { recoveryCode } = independentVector();
  assert.equal(await h.normalizeRecoveryCode(' \t' + recoveryCode.toLowerCase().replace(/-/g, ' \n-') + '\r'), recoveryCode);
  for (const value of [null, '', recoveryCode.replace('NV2', 'NV1'), recoveryCode + 'A', recoveryCode.replace('-', '\u00a0'), recoveryCode.replace('-', '–'), recoveryCode.replace('A', '0')]) {
    await assert.rejects(h.normalizeRecoveryCode(value), hasCode('RECOVERY_CODE_INVALID'));
  }
});

test('noncanonical recovery key padding bits are rejected even with the same decoded key', async () => {
  const h = load();
  const { recoveryCode } = independentVector();
  const compact = recoveryCode.replace(/-/g, '');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const index = 3 + 51;
  const malformed = compact.slice(0, index) + alphabet[alphabet.indexOf(compact[index]) | 1] + compact.slice(index + 1);
  await assert.rejects(h.normalizeRecoveryCode(malformed), hasCode('RECOVERY_CODE_INVALID'));
});

test('invalid schema and bounds fail before expensive key derivation', async () => {
  let derives = 0;
  const h = load({ getRandomValues: crypto.getRandomValues.bind(crypto), subtle: {
    importKey: crypto.subtle.importKey.bind(crypto.subtle), deriveKey() { derives++; throw new Error('provider secret'); }
  } });
  const { e } = independentVector();
  const mutations = [
    x => { x.extra = 1; }, x => { x.version = 3; }, x => { x.format = 'other'; },
    x => { x.password.extra = 1; }, x => { x.recovery.extra = 1; }, x => { x.data.extra = 1; },
    x => { x.password.iterations = 600001; }, x => { x.password.kdf = 'PBKDF2-SHA1'; },
    x => { x.recovery.encoding = 'base32'; }, x => { x.algorithm = 'AES-128-GCM'; },
    x => { x.datasetId = 'A'.repeat(32); }, x => { x.generationId = 'g'.repeat(32); },
    x => { x.createdAt = '2026-02-31T00:00:00.000Z'; }, x => { x.data.savedAt = '2026-10-16'; },
    x => { x.password.salt = 'A'.repeat(100000); }, x => { x.password.iv = ''; },
    x => { x.recovery.wrappedKey = b64(Buffer.alloc(49)); }, x => { x.data.ciphertext = b64(Buffer.alloc(15)); },
    x => { x.password = null; }, x => { delete x.data; },
    x => { x.data.ciphertext = b64(Buffer.alloc(10 * 1024 * 1024 + 17)); }
  ];
  for (const mutate of mutations) {
    const candidate = JSON.parse(JSON.stringify(e)); mutate(candidate);
    assert.throws(() => h.inspectEnvelope(JSON.stringify(candidate)), hasCode('ENCRYPTED_FORMAT_INVALID'));
    await assert.rejects(h.unlockEnvelope(JSON.stringify(candidate), { kind: 'password', value: PASSWORD }), hasCode('ENCRYPTED_FORMAT_INVALID'));
  }
  for (const text of ['null', '[]', '{', 'x'.repeat(20 * 1024 * 1024 + 1)]) {
    await assert.rejects(h.unlockEnvelope(text, { kind: 'password', value: PASSWORD }), hasCode('ENCRYPTED_FORMAT_INVALID'));
  }
  assert.equal(derives, 0);
});

test('canonical Base64 rejects alternate padding bits and missing padding', () => {
  const h = load();
  const { e } = independentVector();
  e.password.salt = e.password.salt.slice(0, -3) + 'x==';
  assert.throws(() => h.inspectEnvelope(JSON.stringify(e)), hasCode('ENCRYPTED_FORMAT_INVALID'));
  e.password.salt = b64(Buffer.alloc(16, 7)).replace(/=/g, '');
  assert.throws(() => h.inspectEnvelope(JSON.stringify(e)), hasCode('ENCRYPTED_FORMAT_INVALID'));
});

test('every public header, wrap, and payload is authenticated including unused wrap', async () => {
  const h = load();
  const { e, recoveryCode } = independentVector();
  const mutations = [
    x => { x.datasetId = 'f'.repeat(32); }, x => { x.generationId = 'f'.repeat(32); },
    x => { x.createdAt = '2026-10-16T08:00:00.001Z'; }, x => { x.data.savedAt = '2026-10-16T08:05:00.001Z'; },
    x => { x.password.salt = flip(x.password.salt); }, x => { x.password.iv = flip(x.password.iv); },
    x => { x.password.wrappedKey = flip(x.password.wrappedKey); }, x => { x.recovery.iv = flip(x.recovery.iv); },
    x => { x.recovery.wrappedKey = flip(x.recovery.wrappedKey); }, x => { x.data.iv = flip(x.data.iv); },
    x => { x.data.ciphertext = flip(x.data.ciphertext); }
  ];
  for (const mutate of mutations) {
    const candidate = JSON.parse(JSON.stringify(e)); mutate(candidate);
    for (const access of [{ kind: 'password', value: PASSWORD }, { kind: 'recovery', value: recoveryCode }]) {
      await assert.rejects(h.unlockEnvelope(JSON.stringify(candidate), access), hasCode('AUTH'));
    }
  }
});

test('JSON key order is semantically irrelevant', async () => {
  const h = load();
  const { e } = independentVector();
  function reverse(value) {
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
  }
  assert.equal((await h.unlockEnvelope(JSON.stringify(reverse(e)), { kind: 'password', value: PASSWORD })).stateJson, TEXT);
});

test('session saves preserve wrappers, refresh IVs and savedAt, and need no secret', async () => {
  const h = load();
  const v = independentVector();
  const { session } = await h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode });
  const first = JSON.parse(await h.reencryptState(session, 'first'));
  const second = JSON.parse(await h.reencryptState(session, 'second'));
  assert.deepEqual(first.password, v.e.password);
  assert.deepEqual(first.recovery, v.e.recovery);
  assert.equal(first.createdAt, v.e.createdAt);
  assert.notEqual(first.data.savedAt, v.e.data.savedAt);
  assert.notEqual(first.data.iv, v.e.data.iv);
  assert.notEqual(second.data.iv, first.data.iv);
  assert.equal((await h.unlockEnvelope(JSON.stringify(second), { kind: 'recovery', value: v.recoveryCode })).stateJson, 'second');
});

test('new generations use independent data/recovery keys and sessions remain isolated', async () => {
  const h = load();
  const a = await h.createEnvelope('a', PASSWORD);
  const b = await h.createEnvelope('b', PASSWORD, { datasetId: h.inspectEnvelope(a.envelopeText).datasetId });
  assert.notEqual(h.inspectEnvelope(a.envelopeText).generationId, h.inspectEnvelope(b.envelopeText).generationId);
  assert.notEqual(a.recoveryCode, b.recoveryCode);
  const ea = JSON.parse(a.envelopeText), eb = JSON.parse(b.envelopeText);
  assert.notEqual(ea.password.wrappedKey, eb.password.wrappedKey);
  assert.notDeepEqual(nodePasswordDek(ea), nodePasswordDek(eb), 'independent decoder verifies each new generation has a fresh data key');
  await assert.rejects(h.unlockEnvelope(b.envelopeText, { kind: 'recovery', value: a.recoveryCode }), hasCode('AUTH'));
  h.disposeEnvelopeSession(a.session);
  await assert.rejects(h.reencryptState(a.session, 'x'), hasCode('RECOVERY_SESSION_INVALID'));
  assert.equal((await h.unlockEnvelope(await h.reencryptState(b.session, 'still b'), { kind: 'recovery', value: b.recoveryCode })).stateJson, 'still b');
});

test('foreign, forged and disposed tokens fail without leaking implementation details', async () => {
  const h = load();
  const other = load();
  const v = independentVector();
  const { session } = await h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode });
  for (const candidate of [null, {}, Object.freeze({}), session]) {
    await assert.rejects(other.reencryptState(candidate, 'x'), hasCode('RECOVERY_SESSION_INVALID'));
  }
  h.disposeEnvelopeSession(session); h.disposeEnvelopeSession(session); h.disposeEnvelopeSession({});
  await assert.rejects(h.reencryptState(session, 'x'), hasCode('RECOVERY_SESSION_INVALID'));
});

test('dispose during pending encryption invalidates that operation', async () => {
  let reached;
  const pending = new Promise(resolve => { reached = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = load({ getRandomValues: crypto.getRandomValues.bind(crypto), subtle: {
    digest: crypto.subtle.digest.bind(crypto.subtle), importKey: crypto.subtle.importKey.bind(crypto.subtle),
    decrypt: crypto.subtle.decrypt.bind(crypto.subtle),
    async encrypt(...args) { reached(); await gate; return crypto.subtle.encrypt(...args); }
  } });
  const v = independentVector();
  const { session } = await h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode });
  const operation = h.reencryptState(session, 'pending');
  await pending;
  h.disposeEnvelopeSession(session); release();
  await assert.rejects(operation, hasCode('RECOVERY_SESSION_INVALID'));
});

test('surrogate text, oversized UTF8 and invalid options are rejected before crypto', async () => {
  const h = load({ getRandomValues() { throw new Error('must not reach crypto'); } });
  for (const value of ['\ud800', '\udc00', 'ä'.repeat(5 * 1024 * 1024 + 1), null]) {
    await assert.rejects(h.createEnvelope(value, PASSWORD), hasCode('ENCRYPTED_FORMAT_INVALID'));
  }
  await assert.rejects(h.createEnvelope(TEXT, PASSWORD, { datasetId: 'bad' }), hasCode('ENCRYPTED_FORMAT_INVALID'));
  await assert.rejects(h.createEnvelope(TEXT, '\ud800'), hasCode('ENCRYPTED_FORMAT_INVALID'));
});

test('authenticated malformed UTF8 payload fails instead of replacing bytes', async () => {
  const h = load();
  const v = independentVector({ plaintext: Buffer.from([0xc0, 0x80]) });
  await assert.rejects(h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode }), hasCode('ENCRYPTED_FORMAT_INVALID'));
});

test('provider failures use a fixed error and no provider detail', async () => {
  const h = load({ getRandomValues() { throw new Error('secret provider detail'); } });
  await assert.rejects(h.createEnvelope(TEXT, PASSWORD), hasCode('CRYPTO_OPERATION_FAILED'));
});

test('provider error code collisions cannot bypass fixed technical errors', async () => {
  const providerError = Object.assign(new Error('synthetic provider detail'), { code: 'AUTH' });
  const h = load({ getRandomValues() { throw providerError; } });
  await assert.rejects(h.createEnvelope(TEXT, PASSWORD), hasCode('CRYPTO_OPERATION_FAILED'));
});

test('empty text, BOM and exact UTF8 limit survive session save without JSON normalization', async () => {
  const h = load();
  const v = independentVector();
  const { session } = await h.unlockEnvelope(v.envelopeText, { kind: 'recovery', value: v.recoveryCode });
  for (const text of ['', '\ufefftext\u0000', 'ä'.repeat(5 * 1024 * 1024)]) {
    const envelope = await h.reencryptState(session, text);
    assert.equal((await h.unlockEnvelope(envelope, { kind: 'recovery', value: v.recoveryCode })).stateJson, text);
  }
  await assert.rejects(h.reencryptState(session, '\ud800'), hasCode('ENCRYPTED_FORMAT_INVALID'));
  await assert.rejects(h.reencryptState(session, 'ä'.repeat(5 * 1024 * 1024 + 1)), hasCode('ENCRYPTED_FORMAT_INVALID'));
});

test('session data key is nonextractable and every AES operation requests a 128 bit tag', async () => {
  const imports = [], operations = [], derivations = [];
  const h = load({ getRandomValues: crypto.getRandomValues.bind(crypto), subtle: {
    digest: crypto.subtle.digest.bind(crypto.subtle),
    async importKey(...args) { const result = await crypto.subtle.importKey(...args); imports.push({ extractable: result.extractable, algorithm: result.algorithm.name }); return result; },
    async deriveKey(...args) { derivations.push([{ ...args[0], salt: Buffer.from(args[0].salt) }, ...args.slice(1)]); return crypto.subtle.deriveKey(...args); },
    async encrypt(...args) { operations.push(args[0]); return crypto.subtle.encrypt(...args); },
    async decrypt(...args) { operations.push(args[0]); return crypto.subtle.decrypt(...args); }
  } });
  const created = await h.createEnvelope(TEXT, PASSWORD);
  await h.reencryptState(created.session, 'next');
  await h.unlockEnvelope(created.envelopeText, { kind: 'password', value: PASSWORD });
  assert.ok(imports.length >= 5);
  assert.ok(imports.every(item => item.extractable === false));
  assert.ok(operations.length >= 6);
  assert.ok(operations.every(item => item.tagLength === 128 && item.iv.length === 12));
  assert.ok(derivations.every(args => args[0].iterations === 600000 && args[0].hash === 'SHA-256' && args[3] === false));
  const e = JSON.parse(created.envelopeText);
  assert.deepEqual(Buffer.from(derivations[0][0].salt), Buffer.concat([Buffer.from('notenverwaltung:password-wrap:v2\0'), Buffer.from(e.password.salt, 'base64')]));
});
