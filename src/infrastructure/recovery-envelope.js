// Self-contained V2 format. Legacy encryption intentionally lives in its own module.
const FORMAT = 'notenverwaltung_envelope';
const ALGORITHM = 'AES-256-GCM';
const KDF = 'PBKDF2-SHA256';
const ITERATIONS = 600000;
const ENCODING = 'base32-sha256-20-v1';
const PASSWORD_PREFIX = 'notenverwaltung:password-wrap:v2\0';
const RECOVERY_PREFIX = 'notenverwaltung:recovery-code:v2\0';
const MAX_STATE = 10 * 1024 * 1024;
const MAX_ENVELOPE = 20 * 1024 * 1024;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const sessions = new WeakMap();
const ownErrors = new WeakSet();
// Importing the infrastructure graph must not require browser globals.
function utf8(value) { return new TextEncoder().encode(value); }

function fail(code) {
  const error = new Error(code);
  error.code = code;
  ownErrors.add(error);
  return error;
}
function invalid() { throw fail('ENCRYPTED_FORMAT_INVALID'); }
function wipe(...arrays) { for (const bytes of arrays) if (bytes) bytes.fill(0); }
function technical(error) {
  if (ownErrors.has(error)) return error;
  return fail('CRYPTO_OPERATION_FAILED');
}
function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function fromBase64(value, min, max = min) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || value.length < Math.ceil(min / 3) * 4 ||
      value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) invalid();
  // Avoid a repeated-group regexp: valid multi-megabyte ciphertext must not
  // exhaust the regexp engine's stack before its decoded size is checked.
  const padding = value.indexOf('=');
  if (padding !== -1 && (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding)))) invalid();
  let binary;
  try { binary = atob(value); } catch { invalid(); }
  if (binary.length < min || binary.length > max) invalid();
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (bytesToBase64(bytes) !== value) invalid();
  return bytes;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) invalid();
}
function id(value) { if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) invalid(); }
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid();
  const time = new Date(value);
  if (!Number.isFinite(time.getTime()) || time.toISOString() !== value) invalid();
}
function hasUnpairedSurrogate(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}
function textBytes(value, max = MAX_STATE) {
  if (typeof value !== 'string' || value.length > max || hasUnpairedSurrogate(value)) invalid();
  const bytes = utf8(value);
  if (bytes.length > max) { wipe(bytes); invalid(); }
  return bytes;
}
function freezeEnvelope(e) {
  Object.freeze(e.password); Object.freeze(e.recovery); Object.freeze(e.data);
  return Object.freeze(e);
}
function parseEnvelope(text) {
  if (typeof text !== 'string' || text.length > MAX_ENVELOPE) invalid();
  // Count UTF-8 without retaining an additional envelope-sized byte array.
  const encoded = utf8(text);
  if (encoded.length > MAX_ENVELOPE) invalid();
  let e;
  try { e = JSON.parse(text); } catch { invalid(); }
  exact(e, ['format', 'version', 'datasetId', 'generationId', 'createdAt', 'algorithm', 'password', 'recovery', 'data']);
  if (e.format !== FORMAT || e.version !== 2 || e.algorithm !== ALGORITHM) invalid();
  id(e.datasetId); id(e.generationId); timestamp(e.createdAt);
  exact(e.password, ['kdf', 'iterations', 'salt', 'iv', 'wrappedKey']);
  if (e.password.kdf !== KDF || e.password.iterations !== ITERATIONS) invalid();
  exact(e.recovery, ['encoding', 'iv', 'wrappedKey']);
  if (e.recovery.encoding !== ENCODING) invalid();
  exact(e.data, ['savedAt', 'iv', 'ciphertext']); timestamp(e.data.savedAt);
  fromBase64(e.password.salt, 16); fromBase64(e.password.iv, 12); fromBase64(e.password.wrappedKey, 48);
  fromBase64(e.recovery.iv, 12); fromBase64(e.recovery.wrappedKey, 48);
  fromBase64(e.data.iv, 12); fromBase64(e.data.ciphertext, 16, MAX_STATE + 16);
  return freezeEnvelope(e);
}
function context(e) { return [e.format, e.version, e.algorithm, e.datasetId, e.generationId, e.createdAt]; }
function aad(e, purpose) {
  let fields;
  if (purpose === 'password-wrap') fields = [e.password.kdf, e.password.iterations, e.password.salt];
  else if (purpose === 'recovery-wrap') fields = [e.recovery.encoding];
  else fields = [e.data.savedAt,
    e.password.kdf, e.password.iterations, e.password.salt, e.password.iv, e.password.wrappedKey,
    e.recovery.encoding, e.recovery.iv, e.recovery.wrappedKey];
  return utf8(JSON.stringify([...context(e), purpose, ...fields]));
}
function random(length) { return crypto.getRandomValues(new Uint8Array(length)); }
function randomId() {
  const bytes = random(16);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
function concat(a, b) {
  const bytes = new Uint8Array(a.length + b.length);
  bytes.set(a); bytes.set(b, a.length);
  return bytes;
}
function importAes(bytes) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
async function passwordKey(password, salt) {
  const bytes = textBytes(password);
  const prefixedSalt = concat(utf8(PASSWORD_PREFIX), salt);
  try {
    const base = await crypto.subtle.importKey('raw', bytes, { name: 'PBKDF2' }, false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: prefixedSalt },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { wipe(bytes, prefixedSalt); }
}
async function encrypt(key, iv, additionalData, plaintext) {
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, plaintext));
}
async function decrypt(key, iv, additionalData, ciphertext) {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData, tagLength: 128 }, key, ciphertext));
  } catch (error) {
    if (error && error.name === 'OperationError') throw fail('AUTH');
    throw error;
  }
}
function base32(bytes) {
  let accumulator = 0, count = 0, output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte; count += 8;
    while (count >= 5) { count -= 5; output += ALPHABET[(accumulator >>> count) & 31]; }
  }
  if (count) output += ALPHABET[(accumulator << (5 - count)) & 31];
  return output;
}
function decodeRecoveryKey(text) {
  const bytes = new Uint8Array(32);
  let accumulator = 0, count = 0, index = 0;
  for (const char of text) {
    accumulator = (accumulator << 5) | ALPHABET.indexOf(char); count += 5;
    if (count >= 8) { count -= 8; bytes[index++] = (accumulator >>> count) & 255; }
  }
  if (index !== 32 || (accumulator & ((1 << count) - 1)) !== 0) { wipe(bytes); throw fail('RECOVERY_CODE_INVALID'); }
  return bytes;
}
async function checksum(bytes) {
  const input = concat(utf8(RECOVERY_PREFIX), bytes);
  let digest;
  try {
    digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    return base32(digest).slice(0, 4);
  } finally { wipe(input, digest); }
}
function printCode(compact) { return 'NV2-' + compact.match(/.{4}/g).join('-'); }
async function readRecoveryCode(input) {
  if (typeof input !== 'string' || input.length > 1024 || /[^A-Za-z0-9\x09-\x0d -]/.test(input)) throw fail('RECOVERY_CODE_INVALID');
  const compact = input.replace(/[\x09-\x0d -]/g, '').toUpperCase();
  if (!/^NV2[A-Z2-7]{56}$/.test(compact)) throw fail('RECOVERY_CODE_INVALID');
  const code = compact.slice(3);
  const bytes = decodeRecoveryKey(code.slice(0, 52));
  try {
    const expected = await checksum(bytes);
    let difference = 0;
    for (let i = 0; i < 4; i++) difference |= expected.charCodeAt(i) ^ code.charCodeAt(52 + i);
    if (difference) throw fail('RECOVERY_CODE_INVALID');
    return { bytes, canonical: printCode(code) };
  } catch (error) { wipe(bytes); throw error; }
}
function newSession(key, envelope) {
  const token = Object.freeze({});
  sessions.set(token, { key, envelope, active: true });
  return token;
}
function sessionRecord(token) {
  const record = token && sessions.get(token);
  if (!record || !record.active) throw fail('RECOVERY_SESSION_INVALID');
  return record;
}
function assertActive(token, record) {
  if (sessions.get(token) !== record || !record.active) throw fail('RECOVERY_SESSION_INVALID');
}

export function inspectEnvelope(envelopeText) {
  const e = parseEnvelope(envelopeText);
  // Schema validation alone cannot establish authenticity.
  return Object.freeze({ version: 2, datasetId: e.datasetId, generationId: e.generationId, createdAt: e.createdAt, savedAt: e.data.savedAt });
}

export async function normalizeRecoveryCode(input) {
  let code;
  try { code = await readRecoveryCode(input); return code.canonical; }
  catch (error) { throw technical(error); }
  finally { if (code) wipe(code.bytes); }
}

export async function createEnvelope(stateJson, password, options = {}) {
  let plaintext, dekBytes, recoveryBytes;
  try {
    plaintext = textBytes(stateJson);
    const checkedPassword = textBytes(password); wipe(checkedPassword);
    exact(options, Object.prototype.hasOwnProperty.call(options || {}, 'datasetId') ? ['datasetId'] : []);
    if (options.datasetId !== undefined) id(options.datasetId);
    dekBytes = random(32); recoveryBytes = random(32);
    const e = {
      format: FORMAT, version: 2, datasetId: options.datasetId || randomId(), generationId: randomId(),
      createdAt: new Date().toISOString(), algorithm: ALGORITHM,
      password: { kdf: KDF, iterations: ITERATIONS, salt: bytesToBase64(random(16)), iv: bytesToBase64(random(12)), wrappedKey: '' },
      recovery: { encoding: ENCODING, iv: bytesToBase64(random(12)), wrappedKey: '' },
      data: { savedAt: new Date().toISOString(), iv: bytesToBase64(random(12)), ciphertext: '' }
    };
    const key = await importAes(dekBytes);
    const pwKey = await passwordKey(password, fromBase64(e.password.salt, 16));
    e.password.wrappedKey = bytesToBase64(await encrypt(pwKey, fromBase64(e.password.iv, 12), aad(e, 'password-wrap'), dekBytes));
    const recoveryKey = await importAes(recoveryBytes);
    e.recovery.wrappedKey = bytesToBase64(await encrypt(recoveryKey, fromBase64(e.recovery.iv, 12), aad(e, 'recovery-wrap'), dekBytes));
    const recoveryCode = printCode(base32(recoveryBytes) + await checksum(recoveryBytes));
    wipe(dekBytes, recoveryBytes);
    e.data.ciphertext = bytesToBase64(await encrypt(key, fromBase64(e.data.iv, 12), aad(e, 'state'), plaintext));
    freezeEnvelope(e);
    return { envelopeText: JSON.stringify(e), session: newSession(key, e), recoveryCode };
  } catch (error) { throw technical(error); }
  finally { wipe(plaintext, dekBytes, recoveryBytes); }
}

export async function unlockEnvelope(envelopeText, access) {
  let rawKey, recovery, plaintext;
  try {
    const e = parseEnvelope(envelopeText);
    exact(access, ['kind', 'value']);
    if (access.kind !== 'password' && access.kind !== 'recovery') invalid();
    let wrappingKey, wrapper;
    if (access.kind === 'password') {
      wrappingKey = await passwordKey(access.value, fromBase64(e.password.salt, 16)); wrapper = e.password;
    } else {
      recovery = await readRecoveryCode(access.value);
      wrappingKey = await importAes(recovery.bytes); wrapper = e.recovery;
    }
    rawKey = await decrypt(wrappingKey, fromBase64(wrapper.iv, 12), aad(e, access.kind === 'password' ? 'password-wrap' : 'recovery-wrap'), fromBase64(wrapper.wrappedKey, 48));
    if (rawKey.length !== 32) invalid();
    const key = await importAes(rawKey);
    wipe(rawKey); if (recovery) wipe(recovery.bytes);
    plaintext = await decrypt(key, fromBase64(e.data.iv, 12), aad(e, 'state'), fromBase64(e.data.ciphertext, 16, MAX_STATE + 16));
    let stateJson;
    try { stateJson = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plaintext); }
    catch { invalid(); }
    return { stateJson, session: newSession(key, e) };
  } catch (error) { throw technical(error); }
  finally { wipe(rawKey, plaintext); if (recovery) wipe(recovery.bytes); }
}

export async function reencryptState(session, stateJson) {
  let record, plaintext;
  try {
    record = sessionRecord(session);
    plaintext = textBytes(stateJson);
    const e = { ...record.envelope, data: { savedAt: new Date().toISOString(), iv: bytesToBase64(random(12)), ciphertext: '' } };
    e.data.ciphertext = bytesToBase64(await encrypt(record.key, fromBase64(e.data.iv, 12), aad(e, 'state'), plaintext));
    assertActive(session, record);
    return JSON.stringify(e);
  } catch (error) {
    if (record) assertActive(session, record);
    throw technical(error);
  } finally { wipe(plaintext); }
}

export function disposeEnvelopeSession(session) {
  const record = session && sessions.get(session);
  if (record) { record.active = false; record.key = null; record.envelope = null; sessions.delete(session); }
}
