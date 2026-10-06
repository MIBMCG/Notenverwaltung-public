'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadEsmGraph } = require('./harness/load-esm-graph.js');

const modulePath = path.join(__dirname, '..', 'src', 'infrastructure', 'encryption.js');
const PASSWORD = 'Synthetic-Wave42-Password';
const JSON_FIXTURE = '{"wave":42,"text":"Grüße"}';
const SALT_BYTES = Uint8Array.from({ length: 16 }, (_, index) => index);
const HISTORICAL_VECTOR = 'AAECAwQFBgcICQoLDA0ODw==:EBESExQVFhcYGRob:wschb4xIQCX/EWJ0JA5lhSfyHdE1i6ZtzwGvy1ndnjdktpHpT27OtXoAtlk=';

function loadHelpers({ cryptoImpl = crypto } = {}) {
  return loadEsmGraph('src/infrastructure/encryption.js', {
    globals: { crypto: cryptoImpl, TextEncoder, TextDecoder, btoa, atob }
  }).exports;
}

test('Wave 4.2 encryption loads without browser APIs', () => {
  assert.ok(fs.existsSync(modulePath), 'encryption infrastructure module missing');
  const { exports } = loadEsmGraph('src/infrastructure/encryption.js');
  assert.deepEqual(Object.keys(exports).sort(), [
    '_base64ToBuf', '_bufToBase64', '_decryptWithKey', '_deriveKey', '_encryptJsonWithKey'
  ]);
});

test('encryption exposes the direct decrypt helper without browser APIs', () => {
  const helpers = loadHelpers();
  assert.equal(typeof helpers._decryptWithKey, 'function');
});

test('encryption Base64 helpers retain empty and high-byte buffers and reject invalid input', () => {
  const helpers = loadHelpers();
  assert.equal(helpers._bufToBase64(new ArrayBuffer(0)), '');
  const highBytes = Uint8Array.of(0, 127, 128, 255);
  assert.equal(helpers._bufToBase64(highBytes.buffer), 'AH+A/w==');
  assert.deepEqual(Array.from(new Uint8Array(helpers._base64ToBuf('AH+A/w=='))), [0, 127, 128, 255]);
  assert.throws(() => helpers._base64ToBuf('not*base64'), /Invalid character/);
});

test('encryption derives the historical non-extractable AES-GCM key with PBKDF2 parameters', async () => {
  const importCalls = [];
  const deriveCalls = [];
  const helpers = loadHelpers({
    cryptoImpl: {
      subtle: {
        importKey: async (...args) => {
          importCalls.push(args);
          return crypto.subtle.importKey(...args);
        },
        deriveKey: async (...args) => {
          deriveCalls.push(args);
          return crypto.subtle.deriveKey(...args);
        }
      }
    }
  });
  const salt = SALT_BYTES.slice().buffer;
  const key = await helpers._deriveKey(PASSWORD, salt);

  assert.equal(importCalls[0][0], 'raw');
  assert.deepEqual(Array.from(importCalls[0][1]), Array.from(new TextEncoder().encode(PASSWORD)));
  assert.equal(importCalls[0][2].name, 'PBKDF2');
  assert.equal(importCalls[0][3], false);
  assert.deepEqual(Array.from(importCalls[0][4]), ['deriveKey']);
  assert.equal(deriveCalls[0][0].name, 'PBKDF2');
  assert.equal(deriveCalls[0][0].iterations, 200000);
  assert.equal(deriveCalls[0][0].hash, 'SHA-256');
  assert.deepEqual(Array.from(new Uint8Array(deriveCalls[0][0].salt)), Array.from(SALT_BYTES));
  assert.equal(deriveCalls[0][2].name, 'AES-GCM');
  assert.equal(deriveCalls[0][2].length, 256);
  assert.equal(deriveCalls[0][3], false);
  assert.deepEqual(Array.from(deriveCalls[0][4]), ['encrypt', 'decrypt']);
  assert.equal(key.extractable, false);
  assert.equal(key.algorithm.name, 'AES-GCM');
  assert.equal(key.algorithm.length, 256);
  assert.deepEqual(Array.from(key.usages).sort(), ['decrypt', 'encrypt']);
});

test('encryption matches the original Storage fixture with a fixed IV and decrypts it through Web Crypto', async () => {
  const helpers = loadHelpers({
    cryptoImpl: {
      subtle: crypto.subtle,
      getRandomValues(array) {
        array.set(Array.from({ length: array.length }, (_, index) => index + 16));
        return array;
      }
    }
  });
  const key = await helpers._deriveKey(PASSWORD, SALT_BYTES.slice().buffer);
  const payload = await helpers._encryptJsonWithKey(JSON_FIXTURE, key);
  const [, expectedIv, expectedCipher] = HISTORICAL_VECTOR.split(':');
  assert.equal(payload, `${expectedIv}:${expectedCipher}`);

  const [ivB64, cipherB64] = payload.split(':');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(ivB64, 'base64') },
    key,
    Buffer.from(cipherB64, 'base64')
  );
  assert.equal(new TextDecoder().decode(plaintext), JSON_FIXTURE);
});

test('encryption decrypts the historical Storage fixture and rejects wrong credentials or damaged ciphertext', async () => {
  const helpers = loadHelpers();
  const [, ivB64, cipherB64] = HISTORICAL_VECTOR.split(':');
  const iv = Uint8Array.from(Buffer.from(ivB64, 'base64'));
  const ciphertext = Uint8Array.from(Buffer.from(cipherB64, 'base64'));
  const key = await helpers._deriveKey(PASSWORD, SALT_BYTES.slice().buffer);

  const plaintext = await helpers._decryptWithKey(iv, key, ciphertext.buffer);
  assert.equal(new TextDecoder().decode(plaintext), JSON_FIXTURE);

  const wrongKey = await helpers._deriveKey('Synthetic-Wrong-Password', SALT_BYTES.slice().buffer);
  await assert.rejects(() => helpers._decryptWithKey(iv, wrongKey, ciphertext.buffer));

  const damaged = ciphertext.slice();
  damaged[0] ^= 1;
  await assert.rejects(() => helpers._decryptWithKey(iv, key, damaged.buffer));
});

test('encryption decrypt helper forwards its exact arguments, receiver and promise', () => {
  const expectedPromise = Promise.resolve(new ArrayBuffer(0));
  const iv = new Uint8Array(12);
  const key = {};
  const cipherBuf = new ArrayBuffer(16);
  const subtle = {
    decrypt(params, actualKey, actualCipher) {
      assert.equal(this, subtle);
      assert.equal(params.name, 'AES-GCM');
      assert.equal(params.iv, iv);
      assert.equal(actualKey, key);
      assert.equal(actualCipher, cipherBuf);
      return expectedPromise;
    }
  };
  const helpers = loadHelpers({ cryptoImpl: { subtle } });

  assert.equal(helpers._decryptWithKey(iv, key, cipherBuf), expectedPromise);
});

test('encryption decrypt helper preserves synchronous and rejected Error identity', async () => {
  const iv = new Uint8Array(12);
  const key = {};
  const cipherBuf = new ArrayBuffer(16);
  const syncError = new Error('Synthetic synchronous decrypt failure');
  const syncHelpers = loadHelpers({
    cryptoImpl: { subtle: { decrypt() { throw syncError; } } }
  });
  assert.throws(
    () => syncHelpers._decryptWithKey(iv, key, cipherBuf),
    error => error === syncError
  );

  const rejection = new Error('Synthetic rejected decrypt failure');
  const rejectedHelpers = loadHelpers({
    cryptoImpl: { subtle: { decrypt() { return Promise.reject(rejection); } } }
  });
  await assert.rejects(
    () => rejectedHelpers._decryptWithKey(iv, key, cipherBuf),
    error => error === rejection
  );
});

test('encryption requests a fresh 12-byte IV for every payload', async () => {
  let requests = 0;
  const helpers = loadHelpers({
    cryptoImpl: {
      subtle: crypto.subtle,
      getRandomValues(array) {
        requests += 1;
        array.fill(requests);
        return array;
      }
    }
  });
  const key = await helpers._deriveKey(PASSWORD, SALT_BYTES.slice().buffer);
  const first = await helpers._encryptJsonWithKey(JSON_FIXTURE, key);
  const second = await helpers._encryptJsonWithKey(JSON_FIXTURE, key);
  assert.equal(requests, 2);
  assert.notEqual(first.split(':')[0], second.split(':')[0]);
});

test('encryption preserves derive and encrypt rejection identity', async () => {
  const deriveError = new Error('Synthetic derivation failure');
  const deriveHelpers = loadHelpers({
    cryptoImpl: { subtle: { importKey: async () => { throw deriveError; } } }
  });
  await assert.rejects(
    () => deriveHelpers._deriveKey(PASSWORD, SALT_BYTES.slice().buffer),
    error => error === deriveError
  );

  const encryptError = new Error('Synthetic encryption failure');
  const encryptHelpers = loadHelpers({
    cryptoImpl: {
      getRandomValues(array) { return array; },
      subtle: { encrypt: async () => { throw encryptError; } }
    }
  });
  await assert.rejects(
    () => encryptHelpers._encryptJsonWithKey(JSON_FIXTURE, {}),
    error => error === encryptError
  );
});
