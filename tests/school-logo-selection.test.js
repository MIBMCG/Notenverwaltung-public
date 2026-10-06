'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inflateSync } = require('node:zlib');
const { loadModules } = require('./harness/load');
const { loadDashboardUi, findByText, findByAttribute } = require('./harness/dashboard-app');

// Valid 1x1 RGBA PNG. Boundary fixtures add a CRC-valid ancillary chunk;
// the decoder stub checks complete chunks and inflated pixel data.
const smallPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMwTpv5HwAENAIyWy0K4AAAAABJRU5ErkJggg==', 'base64');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

const legacyLargePng = buildPngAtSize(262145);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPngAtSize(targetBytes) {
  const dataLength = targetBytes - smallPng.length - 12;
  assert.ok(dataLength >= 8, 'padding chunk must have enough room for ancillary data');
  const chunkType = Buffer.from('raNd');
  const data = Buffer.alloc(dataLength, 0x5a);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([chunkType, data])));
  const ancillaryChunk = Buffer.concat([length, chunkType, data, checksum]);
  const png = Buffer.concat([smallPng.subarray(0, smallPng.length - 12), ancillaryChunk, smallPng.subarray(-12)]);
  assert.equal(png.length, targetBytes);
  assert.ok(inspectPng(png), 'the padded PNG must retain valid chunks, CRCs and image data');
  return png;
}

function inspectPng(value) {
  const bytes = Buffer.from(value);
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let header = null;
  const imageData = [];
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) return null;
    const chunkType = bytes.subarray(offset + 4, offset + 8);
    const data = bytes.subarray(dataStart, dataEnd);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) return null;
    if (type === 'IHDR') {
      if (header || length !== 13) return null;
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colorType: data[9], interlace: data[12]
      };
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) return null;
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!header || !header.width || !header.height || !imageData.length || !sawEnd || offset !== bytes.length) return null;
  if (header.bitDepth !== 8 || header.interlace !== 0) return null;
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 })[header.colorType];
  if (!channels) return null;
  try {
    const decoded = inflateSync(Buffer.concat(imageData));
    if (decoded.length !== (header.width * channels + 1) * header.height) return null;
  } catch (_) { return null; }
  return { width: header.width, height: header.height };
}

function dataUrl(bytes, mime = 'image/png') {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

function corruptIdatCrc(value) {
  const bytes = Buffer.from(value);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') {
      bytes[offset + 8 + length] ^= 0x01;
      return bytes;
    }
    offset += 12 + length;
  }
  throw new Error('Testfixture enthält keinen IDAT-Chunk.');
}

async function openSchoolSettings({ logoBytes = smallPng, imageDimensions = null } = {}) {
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const previousLogo = dataUrl(logoBytes);
  state.settings.schoolProfile = {
    name: 'Synthetische Ausgangsschule', logoMode: 'custom', logoDataUrl: previousLogo
  };
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  await findByText(app.root, 'Einstellungen').dispatch('click');
  await findByAttribute(app.root, 'data-settings-area', 'school').dispatch('click');
  const io = { reads: 0, imageLoads: 0, imageErrors: 0 };
  app.sandbox.FileReader = class {
    readAsDataURL(file) {
      io.reads++;
      const mime = file.readerMime === undefined ? file.type : file.readerMime;
      this.result = `data:${mime};base64,${Buffer.from(file.bytes).toString('base64')}`;
      this.onload();
    }
  };
  app.sandbox.Image = class {
    set src(value) {
      const match = /^data:image\/png;base64,([\s\S]*)$/.exec(String(value));
      const dimensions = match && inspectPng(Buffer.from(match[1], 'base64'));
      if (!dimensions) {
        io.imageErrors++;
        this.onerror();
        return;
      }
      io.imageLoads++;
      this.naturalWidth = imageDimensions ? imageDimensions.width : dimensions.width;
      this.naturalHeight = imageDimensions ? imageDimensions.height : dimensions.height;
      this.onload();
    }
  };
  return { app, previousLogo, io, before: JSON.parse(JSON.stringify(await app.Storage.loadState())) };
}

async function chooseLogo(context, bytes, { type = 'image/png', readerMime, name = 'synthetic.png' } = {}) {
  const input = context.app.document.getElementById('settings-school-logo');
  assert.ok(input, 'real school-profile UI exposes its PNG input');
  input.files = [{ name, type, readerMime, size: bytes.length, bytes }];
  await input.dispatch('change');
}

function selectedPreviewIs(app, expectedUrl) {
  const image = app.document.getElementById('settings-school-preview').querySelector('img');
  return !!image && image.getAttribute('src') === expectedUrl;
}

test('new PNG of 262143 raw bytes is accepted with the original content available until Save', async () => {
  const context = await openSchoolSettings();
  const png = buildPngAtSize(262143);
  await chooseLogo(context, png);
  assert.equal(context.io.reads, 1);
  assert.equal(context.io.imageLoads, 1);
  assert.equal(selectedPreviewIs(context.app, dataUrl(png)), true);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.app.Storage.loadState())), context.before,
    'file selection changes only the draft, not persisted profile state');
});

test('new PNG of exactly 262144 raw bytes is accepted', async () => {
  const context = await openSchoolSettings();
  const png = buildPngAtSize(262144);
  await chooseLogo(context, png);
  assert.equal(context.io.reads, 1);
  assert.equal(context.io.imageLoads, 1);
  assert.equal(selectedPreviewIs(context.app, dataUrl(png)), true);
});

test('new PNG of 262145 raw bytes is rejected and preserves the previous draft/logo', async () => {
  const context = await openSchoolSettings();
  const unsavedLogo = buildPngAtSize(128);
  await chooseLogo(context, unsavedLogo);
  assert.equal(selectedPreviewIs(context.app, dataUrl(unsavedLogo)), true);
  assert.notEqual(dataUrl(unsavedLogo), context.previousLogo);
  await chooseLogo(context, legacyLargePng);
  assert.equal(selectedPreviewIs(context.app, dataUrl(unsavedLogo)), true,
    'files larger than the new upload limit must not replace an already selected unsaved draft');
  assert.match(context.app.document.getElementById('settings-school-status').textContent, /höchstens|KiB|262144/i);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.app.Storage.loadState())), context.before);
});

test('a valid stored 262145-byte legacy logo survives normalization, encrypted load and backup restore', async () => {
  assert.equal(legacyLargePng.length, 262145);
  assert.ok(inspectPng(legacyLargePng));
  const modules = loadModules();
  const state = modules.DomainModel.createEmptyState();
  const logo = dataUrl(legacyLargePng);
  state.settings.schoolProfile = { name: 'Synthetische Altlogo-Schule', logoMode: 'custom', logoDataUrl: logo };
  assert.equal(modules.DomainModel.ensureStateShape(JSON.parse(JSON.stringify(state))).settings.schoolProfile.logoDataUrl, logo);
  const app = await loadDashboardUi({ state });
  await app.UiShell.init('app');
  const loaded = await app.Storage.loadState();
  assert.equal(loaded.settings.schoolProfile.logoDataUrl, logo);
  const backup = await app.Storage.exportStateEncrypted(app.password, loaded);
  const restored = await app.Storage.importStateEncryptedFromText(backup, app.password);
  assert.equal(restored.settings.schoolProfile.logoDataUrl, logo);
});

test('empty File and data-URL MIME accept only a valid decoded PNG with allowed dimensions', async () => {
  const context = await openSchoolSettings();
  await chooseLogo(context, smallPng, { type: '', readerMime: '', name: 'mime-empty.bin' });
  assert.equal(context.io.reads, 1);
  assert.equal(context.io.imageLoads, 1);
  assert.equal(selectedPreviewIs(context.app, dataUrl(smallPng)), true);
});

test('image/x-png alias is accepted when the bytes decode as a bounded PNG', async () => {
  const context = await openSchoolSettings();
  await chooseLogo(context, smallPng, { type: 'image/x-png', readerMime: 'image/x-png' });
  assert.equal(context.io.reads, 1, 'MIME is advisory; content validation must run');
  assert.equal(context.io.imageLoads, 1);
  assert.equal(selectedPreviewIs(context.app, dataUrl(smallPng)), true);
});

test('claimed image/png with non-PNG bytes is rejected without changing the prior logo', async () => {
  const context = await openSchoolSettings();
  const notPng = Buffer.from('synthetic bytes, not PNG');
  await chooseLogo(context, notPng, { type: 'image/png', readerMime: 'image/png' });
  assert.equal(selectedPreviewIs(context.app, context.previousLogo), true);
  assert.match(context.app.document.getElementById('settings-school-status').textContent, /gültiges PNG/i);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.app.Storage.loadState())), context.before);
});

test('valid signature with invalid IDAT CRC fails image decoding and preserves the previous logo', async () => {
  const context = await openSchoolSettings();
  const badPng = corruptIdatCrc(smallPng);
  await chooseLogo(context, badPng, { type: '', readerMime: '' });
  assert.equal(context.io.reads, 1);
  assert.equal(context.io.imageErrors, 1);
  assert.equal(selectedPreviewIs(context.app, context.previousLogo), true);
  assert.match(context.app.document.getElementById('settings-school-status').textContent, /nicht geladen/i);
});

test('decoded dimensions above 4096 are rejected and preserve the previous logo', async () => {
  const context = await openSchoolSettings({ imageDimensions: { width: 4097, height: 1 } });
  await chooseLogo(context, smallPng, { type: '', readerMime: '' });
  assert.equal(context.io.imageLoads, 1);
  assert.equal(selectedPreviewIs(context.app, context.previousLogo), true);
  assert.match(context.app.document.getElementById('settings-school-status').textContent, /4096/);
});
