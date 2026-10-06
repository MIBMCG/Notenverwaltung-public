'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE_EXPORTS = new Map([
  ['src/formatting/date-time.js', [
    'parseCalendarDate', 'calendarDateToLocalDate', 'formatCalendarDate',
    'parseInstant', 'formatInstant', 'formatUtcDateStamp', 'formatUtcFileTimestamp'
  ]],
  ['src/formatting/numbers.js', [
    'formatNumber', 'formatLegacyFixed', 'formatLegacyPercent',
    'formatDecimalComma', 'parseDecimalInput'
  ]],
  ['src/formatting/text.js', [
    'compareText'
  ]]
]);

function defineImmutableBinding(sandbox, name, value) {
  Object.defineProperty(sandbox, name, {
    value,
    enumerable: true,
    writable: false,
    configurable: false
  });
}

function installFormattingGlobals(sandbox, moduleExports = MODULE_EXPORTS) {
  for (const [relativePath, exportNames] of moduleExports) {
    const absolutePath = path.join(__dirname, '..', '..', relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8').replace(/^export\s+/gm, '');
    const expression = `(() => {\n${source}\nreturn { ${exportNames.join(', ')} };\n})()`;
    const exportsObject = vm.runInContext(expression, sandbox, { filename: relativePath });
    for (const name of exportNames) defineImmutableBinding(sandbox, name, exportsObject[name]);
  }
  defineImmutableBinding(sandbox, 'DISPLAY_LOCALE', 'de-DE');
  defineImmutableBinding(
    sandbox,
    'DISPLAY_TIME_ZONE',
    vm.runInContext('Intl.DateTimeFormat().resolvedOptions().timeZone', sandbox)
  );
  return sandbox;
}

module.exports = { installFormattingGlobals, MODULE_EXPORTS };
