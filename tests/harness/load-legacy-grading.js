'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { extractModule } = require('./extract.js');
const { installFormattingGlobals } = require('./install-formatting.js');
const { seededRandom } = require('./load.js');

const DOMAIN_MODEL_HASH = '2af9577cfac981bd4a29121ac31934613c9c6d93cc8b9bc7e7efa2babd0f99fa';
const GRADING_LOGIC_HASH = '0474a8a27c33c9de42d3f615f98ee2e4976fa582ad2766f65cef62e7b834b987';

function readFrozenModule(fileName, moduleName, expectedHash, errorMessage) {
  const fixture = fs.readFileSync(path.join(__dirname, '..', 'fixtures', fileName), 'utf8');
  const source = extractModule(fixture.split(/\r?\n/), moduleName) + '\n';
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== expectedHash) throw new Error(errorMessage);
  return source;
}

function loadLegacyGrading({ seed = 1, dateImpl = Date } = {}) {
  const logs = [];
  const capture = level => (...args) => { logs.push({ level, args }); };
  const windowStub = new EventTarget();
  const sandbox = {
    Date: dateImpl,
    window: windowStub,
    console: {
      log: capture('log'),
      info: capture('info'),
      warn: capture('warn'),
      error: capture('error'),
      debug: capture('debug')
    },
    Math: Object.assign(Object.create(Math), { random: seededRandom(seed) })
  };
  vm.createContext(sandbox);
  installFormattingGlobals(sandbox);
  const domainSource = readFrozenModule(
    'domain-model-4cc0ae1.js', 'DomainModel', DOMAIN_MODEL_HASH,
    'Frozen DomainModel oracle has changed.'
  );
  const gradingSource = readFrozenModule(
    'grading-logic-8992831.js', 'GradingLogic', GRADING_LOGIC_HASH,
    'Frozen GradingLogic oracle has changed.'
  );
  vm.runInContext(domainSource + gradingSource +
    '\nglobalThis.__legacy_exports = { DomainModel, GradingLogic };', sandbox,
  { filename: 'historical-domain-4cc0ae1-and-grading-8992831.modules.js' });
  return { ...sandbox.__legacy_exports, sandbox, logs };
}

module.exports = { loadLegacyGrading };
