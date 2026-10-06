'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const childProcess = require('node:child_process');
const { syncBuiltinESMExports } = require('node:module');

const toolUrl = pathToFileURL(path.resolve(__dirname, '../scripts/prepare-public-snapshot.mjs')).href;

function put(root, name, bytes) {
  const file = path.join(root, ...name.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return file;
}

function fixture(t, names = ['b.txt', 'a.txt'], tempRoot = os.tmpdir()) {
  const createdBase = fs.mkdtempSync(path.join(tempRoot, 'nv-public-snapshot-'));
  const tmpRoot = fs.realpathSync.native(tempRoot);
  const base = fs.realpathSync.native(createdBase);
  assert.equal(path.dirname(base), tmpRoot, 'fixture must be a direct child of the temporary root');
  const baseStat = fs.lstatSync(base);
  t.after(() => {
    assert.equal(fs.realpathSync.native(tempRoot), tmpRoot);
    assert.equal(fs.realpathSync.native(base), base);
    assert.equal(path.dirname(base), tmpRoot);
    const currentStat = fs.lstatSync(base);
    assert.equal(currentStat.dev, baseStat.dev);
    assert.equal(currentStat.ino, baseStat.ino);
    fs.rmSync(base, { recursive: true, force: true });
  });
  const sourceRoot = path.join(base, "source-'$()`-ä");
  const outputDir = path.join(base, 'output');
  fs.mkdirSync(sourceRoot);
  for (const name of names) put(sourceRoot, name, 'abc');
  const manifestPath = put(sourceRoot, 'scripts/list.json', JSON.stringify({ files: names }));
  return { base, sourceRoot, outputDir, manifestPath };
}

function select(fx, names) {
  fs.writeFileSync(fx.manifestPath, JSON.stringify({ files: names }));
}

async function refusesWithoutCopy(fx, pattern) {
  await assert.rejects(snapshot(fx), pattern);
  assert.equal(fs.existsSync(path.join(fx.outputDir, 'a.txt')), false);
}

async function snapshot(options) {
  const { preparePublicSnapshot } = await import(toolUrl);
  return preparePublicSnapshot(options);
}

test('fixture expands an actual Windows short-name temp ancestor before snapshot preparation', { skip: process.platform !== 'win32' }, async t => {
  const tempRoot = fs.realpathSync.native(os.tmpdir());
  const aliasParent = fs.mkdtempSync(path.join(tempRoot, 'nv-public-snapshot-alias-parent-'));
  assert.equal(path.dirname(aliasParent), tempRoot);
  t.after(() => {
    assert.equal(fs.realpathSync.native(aliasParent), aliasParent);
    fs.rmdirSync(aliasParent);
  });

  const command = `for %I in ("${aliasParent}") do @echo %~sI`;
  const result = childProcess.spawnSync('cmd.exe', ['/d', '/c', command], {
    encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const shortParent = result.stdout.trim();
  assert.equal(fs.realpathSync.native(shortParent), aliasParent);
  if (path.basename(shortParent).toLowerCase() === path.basename(aliasParent).toLowerCase()) {
    t.diagnostic('This volume did not create an 8.3 alias for the synthetic temp directory.');
    t.skip('No actual synthetic 8.3 alias is available on this volume');
    return;
  }
  assert.match(path.basename(shortParent), /~/);
  await t.test('canonical fixture paths pass the real snapshot helper', async nested => {
    const fx = fixture(nested, ['a.txt'], shortParent);
    const prepared = await snapshot(fx);
    assert.equal(path.dirname(fx.base), aliasParent);
    assert.equal(prepared.files.length, 1);
    assert.equal(fs.readFileSync(path.join(fx.outputDir, 'a.txt'), 'utf8'), 'abc');
    const aliasRelative = path.relative(aliasParent, fx.base);
    const aliasBase = path.join(shortParent, aliasRelative);
    const aliasSource = path.join(aliasBase, path.basename(fx.sourceRoot));
    const aliasManifest = path.join(aliasBase, path.relative(fx.base, fx.manifestPath));
    await assert.rejects(snapshot({ ...fx, sourceRoot: aliasSource, manifestPath: aliasManifest }), /exact component missing/i);
    await assert.rejects(snapshot({ ...fx, manifestPath: aliasManifest }), /manifest must stay inside source/i);
    const aliasOutput = path.join(shortParent, 'alias-output');
    await assert.rejects(snapshot({ ...fx, outputDir: aliasOutput }), /EEXIST|exact component missing|canonical|alias/i);
    assert.equal(fs.existsSync(path.join(aliasParent, 'alias-output')), false);
  });
});

test('copies only named unnamed-stream bytes in sorted order without changing source or needing Git', async t => {
  const fx = fixture(t, ['b.txt', 'nested/a.txt']);
  put(fx.sourceRoot, 'private.txt', 'not selected');
  put(fx.sourceRoot, '.git/config', 'private repository metadata');
  const original = fs.readFileSync(path.join(fx.sourceRoot, 'nested/a.txt'));
  const result = await snapshot(fx);
  const abcHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(result.outputDir, fx.outputDir);
  assert.deepEqual(result.files, [
    { path: 'b.txt', sha256: abcHash },
    { path: 'nested/a.txt', sha256: abcHash }
  ]);
  assert.deepEqual(fs.readFileSync(path.join(fx.outputDir, 'nested/a.txt')), original);
  assert.deepEqual(fs.readFileSync(path.join(fx.sourceRoot, 'nested/a.txt')), original);
  assert.equal(fs.existsSync(path.join(fx.outputDir, 'private.txt')), false);
  assert.equal(fs.existsSync(path.join(fx.outputDir, '.git')), false);
});

test('rejects unsafe manifest paths and aliases before copying the first valid file', async t => {
  const badNames = [
    '../escape.txt', 'a//b.txt', './a.txt', 'a/../b.txt', '/absolute.txt',
    'C:/drive.txt', '//server/share.txt', '\\\\server\\share.txt', 'a\\b.txt',
    'a.txt:secret', 'a?.txt', 'a\u0000.txt', 'trailing. ', 'NUL.txt', 'CLOCK$.txt',
    '.GiT/config', 'e\u0301.txt'
  ];
  for (const badName of badNames) {
    const fx = fixture(t, ['a.txt']);
    select(fx, ['a.txt', badName]);
    await refusesWithoutCopy(fx, /manifest|unsafe|path|name/i);
  }
  const conflicting = [
    ['a.txt', 'a.txt'], ['a.txt', 'A.txt'], ['a.txt', 'a.txt/child'],
    ['é.txt', 'e\u0301.txt']
  ];
  for (const names of conflicting) {
    const fx = fixture(t, ['a.txt']);
    select(fx, names);
    await refusesWithoutCopy(fx, /manifest|collision|duplicate|path/i);
  }
});

test('rejects incomplete or invalid manifests and all missing/nonregular sources before copying', async t => {
  const fx = fixture(t, ['a.txt']);
  for (const badManifest of ['{}', '{"files":[]}', '{"files":["a.txt",4]}', '{"files":["a.txt"],"globs":["**/*"]}', 'not json']) {
    fs.writeFileSync(fx.manifestPath, badManifest);
    await refusesWithoutCopy(fx, /manifest|JSON/i);
  }
  select(fx, ['a.txt', 'missing.txt']);
  await refusesWithoutCopy(fx, /source|file|missing/i);
  fs.mkdirSync(path.join(fx.sourceRoot, 'directory'));
  select(fx, ['a.txt', 'directory']);
  await refusesWithoutCopy(fx, /source|regular|file/i);
});

test('rejects dot aliases in absolute roots and manifest paths before copying', async t => {
  const fx = fixture(t, ['a.txt']);
  await assert.rejects(snapshot({ ...fx, sourceRoot: `${fx.sourceRoot}${path.sep}.` }), /sourceRoot.*canonical|alias/i);
  await assert.rejects(snapshot({ ...fx, outputDir: `${fx.base}${path.sep}.${path.sep}output` }), /outputDir.*canonical|alias/i);
  await assert.rejects(snapshot({
    ...fx, manifestPath: `${fx.sourceRoot}${path.sep}scripts${path.sep}..${path.sep}scripts${path.sep}list.json`
  }), /manifestPath.*canonical|alias/i);
  assert.equal(fs.existsSync(path.join(fx.outputDir, 'a.txt')), false);
});

test('rejects source spelling aliases, hardlinks, and source paths through links', async t => {
  const alias = fixture(t, ['a.txt']);
  select(alias, ['A.txt']);
  await refusesWithoutCopy(alias, /exact|source|name|missing/i);

  const hardlink = fixture(t, ['a.txt']);
  fs.linkSync(path.join(hardlink.sourceRoot, 'a.txt'), path.join(hardlink.sourceRoot, 'linked.txt'));
  await refusesWithoutCopy(hardlink, /hardlink|link|source/i);

  const dirLink = fixture(t, ['a.txt']);
  const outside = path.join(dirLink.base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(dirLink.sourceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  select(dirLink, ['a.txt', 'linked/secret.txt']);
  await refusesWithoutCopy(dirLink, /link|reparse|source/i);

  const manifestLink = fixture(t, ['a.txt']);
  const alternate = path.join(manifestLink.sourceRoot, 'alternate');
  fs.mkdirSync(alternate);
  fs.writeFileSync(path.join(alternate, 'list.json'), '{"files":["a.txt"]}');
  const manifestJunction = path.join(manifestLink.sourceRoot, 'manifest-junction');
  fs.symlinkSync(alternate, manifestJunction, process.platform === 'win32' ? 'junction' : 'dir');
  manifestLink.manifestPath = path.join(manifestJunction, 'list.json');
  await refusesWithoutCopy(manifestLink, /link|reparse|manifest/i);

  const fileLink = fixture(t, ['a.txt']);
  const target = put(fileLink.sourceRoot, 'original.txt', 'abc');
  const linkedFile = path.join(fileLink.sourceRoot, 'linked.txt');
  let fileSymlinkCreated = false;
  try {
    fs.symlinkSync(target, linkedFile, 'file');
    fileSymlinkCreated = true;
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    t.diagnostic('Windows file symlink creation is unavailable (EPERM); junction cases remain exercised.');
  }
  if (fileSymlinkCreated) {
    select(fileLink, ['linked.txt']);
    await refusesWithoutCopy(fileLink, /link|reparse|source/i);
  }
});

test('rejects source-root symlink and manifest outside the source', async t => {
  const fx = fixture(t, ['a.txt']);
  const link = path.join(fx.base, 'source-link');
  fs.symlinkSync(fx.sourceRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(snapshot({ ...fx, sourceRoot: link }), /link|reparse|source/i);
  const outsideManifest = path.join(fx.base, 'outside.json');
  fs.writeFileSync(outsideManifest, '{"files":["a.txt"]}');
  await assert.rejects(snapshot({ ...fx, manifestPath: outsideManifest }), /manifest|source|outside/i);
  assert.equal(fs.existsSync(path.join(fx.outputDir, 'a.txt')), false);
});

test('rejects a bare Git ancestor with a real linked objects marker before copying', async t => {
  const fx = fixture(t, ['a.txt']);
  const bare = path.join(fx.base, 'bare');
  const objectStore = path.join(fx.base, 'object-store');
  fs.mkdirSync(bare);
  fs.mkdirSync(objectStore);
  fs.writeFileSync(path.join(bare, 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(bare, 'refs'));
  const objects = path.join(bare, 'objects');
  fs.symlinkSync(objectStore, objects, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(fs.lstatSync(objects).isSymbolicLink(), true, 'the fixture must contain a real link');
  const outputDir = path.join(bare, 'candidate');
  await refusesWithoutCopy({ ...fx, outputDir }, /git|repository|output/i);
  assert.equal(fs.existsSync(outputDir), false);
});

test('rejects a bare Git marker layout with unexpected marker types before copying', async t => {
  const fx = fixture(t, ['a.txt']);
  const bare = path.join(fx.base, 'bare');
  fs.mkdirSync(bare);
  fs.mkdirSync(path.join(bare, 'HEAD'));
  fs.writeFileSync(path.join(bare, 'objects'), 'unexpected marker type');
  fs.mkdirSync(path.join(bare, 'refs'));
  const outputDir = path.join(bare, 'candidate');
  await refusesWithoutCopy({ ...fx, outputDir }, /git|repository|output/i);
  assert.equal(fs.existsSync(outputDir), false);
});

test('rejects output inside source, nonempty output, Git ancestry, and target-parent junction', async t => {
  const inside = fixture(t, ['a.txt']);
  await assert.rejects(snapshot({ ...inside, outputDir: path.join(inside.sourceRoot, 'out') }), /output|source|inside/i);

  const nonempty = fixture(t, ['a.txt']);
  fs.mkdirSync(nonempty.outputDir);
  fs.writeFileSync(path.join(nonempty.outputDir, '.hidden'), 'keep');
  await refusesWithoutCopy(nonempty, /output|empty/i);
  assert.equal(fs.readFileSync(path.join(nonempty.outputDir, '.hidden'), 'utf8'), 'keep');

  const git = fixture(t, ['a.txt']);
  fs.writeFileSync(path.join(git.base, '.git'), 'gitdir: somewhere');
  await refusesWithoutCopy(git, /git|repository|output/i);

  const bare = fixture(t, ['a.txt']);
  fs.writeFileSync(path.join(bare.base, 'HEAD'), 'ref: refs/heads/main\n');
  fs.mkdirSync(path.join(bare.base, 'objects'));
  fs.mkdirSync(path.join(bare.base, 'refs'));
  await refusesWithoutCopy(bare, /git|repository|output/i);

  const link = fixture(t, ['a.txt']);
  const other = path.join(link.base, 'other');
  fs.mkdirSync(other);
  const linkedParent = path.join(link.base, 'linked-parent');
  fs.symlinkSync(other, linkedParent, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(snapshot({ ...link, outputDir: path.join(linkedParent, 'out') }), /link|reparse|output/i);
  assert.equal(fs.existsSync(path.join(other, 'out', 'a.txt')), false);

  const rootLink = fixture(t, ['a.txt']);
  const empty = path.join(rootLink.base, 'empty');
  fs.mkdirSync(empty);
  const linkedOutput = path.join(rootLink.base, 'linked-output');
  fs.symlinkSync(empty, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(snapshot({ ...rootLink, outputDir: linkedOutput }), /link|reparse|output/i);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('copies only the unnamed stream and leaves a Windows ADS canary behind', { skip: process.platform !== 'win32' }, async t => {
  const fx = fixture(t, ['a.txt']);
  const sourceStream = `${path.join(fx.sourceRoot, 'a.txt')}:canary`;
  fs.writeFileSync(sourceStream, 'PRIVATE-CANARY');
  assert.equal(fs.readFileSync(sourceStream, 'utf8'), 'PRIVATE-CANARY');
  await snapshot(fx);
  assert.equal(fs.readFileSync(path.join(fx.outputDir, 'a.txt'), 'utf8'), 'abc');
  assert.throws(() => fs.readFileSync(`${path.join(fx.outputDir, 'a.txt')}:canary`), /ENOENT/);
});

test('passes Unicode and literal shell punctuation as path data and copies binary bytes exactly', async t => {
  const name = "nested/na'\`$()-ä.bin";
  const fx = fixture(t, [name]);
  const bytes = Buffer.from([0, 1, 255, 10, 39, 96, 36]);
  fs.writeFileSync(path.join(fx.sourceRoot, ...name.split('/')), bytes);
  const result = await snapshot(fx);
  assert.deepEqual(fs.readFileSync(path.join(fx.outputDir, ...name.split('/'))), bytes);
  assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/);
});

test('fails closed when the Windows attribute process is unavailable', { skip: process.platform !== 'win32' }, async t => {
  const fx = fixture(t, ['a.txt']);
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = '';
    await refusesWithoutCopy(fx, /Windows attribute probe failed/);
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
  }
});

test('fails closed on incomplete, nonnumeric, or reparse-bit Windows metadata', { skip: process.platform !== 'win32' }, async t => {
  const fx = fixture(t, ['a.txt']);
  const originalSpawn = childProcess.spawnSync;
  const replies = [
    { reply: () => ({ attributes: [] }), expected: /incomplete/ },
    { reply: paths => ({ attributes: paths.map((_, index) => ({ index, value: index === 0 ? '1024' : 0 })) }), expected: /invalid or mismatched numbers/ },
    { reply: paths => ({ attributes: paths.map((_, index) => ({ index, value: index === 0 ? 1024 : 0 })) }), expected: /reparse point rejected/ }
  ];
  try {
    for (const { reply, expected } of replies) {
      childProcess.spawnSync = (file, args, options) => {
        assert.equal(file, 'powershell.exe');
        assert.deepEqual(args.slice(0, 2), ['-NoProfile', '-NonInteractive']);
        return { status: 0, stderr: '', stdout: JSON.stringify(reply(JSON.parse(options.input).paths)) };
      };
      syncBuiltinESMExports();
      await refusesWithoutCopy(fx, expected);
    }
  } finally {
    childProcess.spawnSync = originalSpawn;
    syncBuiltinESMExports();
  }
  t.diagnostic('These three probe responses are modeled; real junction rejection is covered separately.');
});

test('exclusive destination creation preserves a later foreign collision and never returns success', async t => {
  const fx = fixture(t, ['a.txt', 'b.txt']);
  const second = path.join(fx.outputDir, 'b.txt');
  const originalOpen = fs.openSync;
  let injected = false;
  fs.openSync = function (file, flags, ...rest) {
    if (file === second && flags === 'wx' && !injected) {
      injected = true;
      const foreign = originalOpen(second, 'wx');
      try { fs.writeSync(foreign, Buffer.from('FOREIGN-BYTES')); } finally { fs.closeSync(foreign); }
    }
    return originalOpen(file, flags, ...rest);
  };
  try {
    await assert.rejects(snapshot(fx), /Snapshot incomplete.*EEXIST/);
  } finally {
    fs.openSync = originalOpen;
  }
  assert.equal(injected, true);
  assert.equal(fs.readFileSync(second, 'utf8'), 'FOREIGN-BYTES');
  assert.equal(fs.readFileSync(path.join(fx.outputDir, 'a.txt'), 'utf8'), 'abc');
});
