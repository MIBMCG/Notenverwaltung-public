'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const stylesheet = fs.readFileSync('src/styles/legacy.css', 'utf8');

function ruleBodiesForSelector(targetSelector) {
  const bodies = [];
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectors = match[1].split(',').map(selector => selector.trim());
    if (selectors.includes(targetSelector)) bodies.push(match[2]);
  }

  return bodies;
}

function declarationsForSelector(targetSelector) {
  const declarations = {};
  for (const body of ruleBodiesForSelector(targetSelector)) {
    for (const declaration of body.split(';')) {
      const separator = declaration.indexOf(':');
      if (separator < 0) continue;
      const property = declaration.slice(0, separator).trim();
      const value = declaration.slice(separator + 1).trim();
      if (property) declarations[property] = value;
    }
  }
  return declarations;
}

function lastRuleIndexForSelector(targetSelector) {
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let lastIndex = -1;
  let match;

  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectors = match[1].split(',').map(selector => selector.trim());
    if (selectors.includes(targetSelector)) lastIndex = match.index;
  }

  return lastIndex;
}

function splitSelectors(selectorList) {
  const selectors = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < selectorList.length; index += 1) {
    if (selectorList[index] === '(') depth += 1;
    if (selectorList[index] === ')') depth -= 1;
    if (selectorList[index] === ',' && depth === 0) {
      selectors.push(selectorList.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selectorList.slice(start).trim());
  return selectors;
}

function bodyForegroundOverrides() {
  const overrides = [];
  const withoutComments = stylesheet.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(withoutComments)) !== null) {
    for (const selector of splitSelectors(match[1])) {
      if (!selector.includes('[data-background=') || !selector.includes('[data-design-family=')) continue;
      if (/--(?:text-main|text-muted|nav-text|nav-text-muted)\s*:/.test(match[2])) overrides.push(selector);
    }
  }
  return overrides;
}

function colorChannels(color) {
  if (Array.isArray(color)) return color;
  const digits = color.slice(1);
  const expanded = digits.length === 3 ? [...digits].map(digit => digit + digit).join('') : digits;
  return expanded.match(/.{2}/g).map(pair => parseInt(pair, 16) / 255);
}

function mixSrgb(first, second, firstWeight) {
  const firstChannels = colorChannels(first);
  const secondChannels = colorChannels(second);
  return firstChannels.map((channel, index) =>
    channel * firstWeight + secondChannels[index] * (1 - firstWeight)
  );
}

function contrastRatio(foreground, background) {
  const luminance = color => {
    const channels = colorChannels(color)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('neutrale Alt-Tokens folgen zentral den aktiven Design-Tokens', () => {
  const aliases = declarationsForSelector('body[data-design-family]');
  const expectedCoreTokens = new Map([
    ['--btn-border', ['--border-soft']],
    ['--btn-bg', ['--bg-card']],
    ['--btn-text', ['--text-main']],
    ['--border-strong', ['--border-soft', '--text-main']],
    ['--table-header-bg', ['--bg-subtle']],
    ['--table-row-hover', ['--accent', '--bg-card']],
    ['--student-row-odd', ['--bg-subtle', '--bg-card']],
    ['--student-row-even', ['--bg-card']],
    ['--table-row-active', ['--accent', '--bg-card']],
    ['--debug-bg', ['--bg-subtle']],
    ['--debug-border', ['--border-soft']],
    ['--info-bg', ['--bg-subtle']]
  ]);

  for (const [alias, coreTokens] of expectedCoreTokens) {
    assert.ok(aliases[alias], `${alias} fehlt in der zentralen Design-Aliasregel`);
    assert.doesNotMatch(aliases[alias], /#[0-9a-f]{3,8}\b/i, `${alias} ist fest eingefaerbt`);
    for (const coreToken of coreTokens) {
      assert.match(aliases[alias], new RegExp(`var\\(${coreToken}\\)`), `${alias} muss ${coreToken} folgen`);
    }
  }

  assert.ok(
    lastRuleIndexForSelector('body[data-design-family]') > lastRuleIndexForSelector('body.theme-dark'),
    'die Design-Aliase muessen die alten Dark-Fallbacks in der Kaskade ersetzen'
  );
});

test('generische Flaechen, Tabellen und Aurora-Navigation enthalten keine feste Neutralpalette', () => {
  const selectors = [
    'select',
    'body.theme-dark select',
    'button:hover',
    'body.theme-dark button:hover',
    'body[data-design-family="aurora"] .nav-main button.active',
    '.data-table tbody tr:nth-child(odd)',
    '.data-table tbody tr:nth-child(even)',
    'body.theme-dark .data-table tbody tr:nth-child(odd)',
    'body.theme-dark .data-table tbody tr:nth-child(even)',
    'body.theme-dark .data-table tbody tr:nth-child(odd) td',
    'body.theme-dark .data-table tbody tr:nth-child(even) td'
  ];

  for (const selector of selectors) {
    const bodies = ruleBodiesForSelector(selector);
    for (const body of bodies) {
      assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b/i, `${selector} enthaelt eine feste Farbe`);
    }
  }

  const select = declarationsForSelector('select');
  assert.match(select.background, /^var\(--(?:btn-bg|bg-card|bg-subtle)\)$/);
  assert.match(select.color, /^var\(--(?:btn-text|text-main)\)$/);

  const nav = declarationsForSelector('body[data-design-family="aurora"] .nav-main button.active');
  assert.equal(nav.background, 'var(--nav-bg-active)');
  assert.equal(nav.color, 'var(--nav-text-active)');
  assert.match(nav['box-shadow'], /var\(--accent\)/);
});

test('explizite Hintergrundpaletten bestimmen lesbare Haupt-, Hinweis- und inaktive Navigationstexte', () => {
  const backgrounds = ['blue', 'green', 'petrol', 'violet', 'amber'];
  const foregroundTokens = ['--text-main', '--text-muted', '--nav-text', '--nav-text-muted'];

  for (const dark of [false, true]) {
    for (const background of backgrounds) {
      const selector = dark
        ? `body.theme-dark[data-background="${background}"]`
        : `body:not(.theme-dark)[data-background="${background}"]`;
      const palette = declarationsForSelector(selector);
      for (const token of foregroundTokens) {
        assert.ok(palette[token], `${background} ${dark ? 'dunkel' : 'hell'}: ${token} fehlt`);
      }

      assert.ok(
        contrastRatio(palette['--text-main'], palette['--bg-card']) >= 4.5,
        `${background} ${dark ? 'dunkel' : 'hell'}: Haupttext auf Karten ist nicht ausreichend lesbar`
      );
      assert.ok(
        contrastRatio(palette['--text-muted'], palette['--bg-card']) >= 4.5,
        `${background} ${dark ? 'dunkel' : 'hell'}: Hinweistext auf Karten ist nicht ausreichend lesbar`
      );
      for (const surface of ['--bg-subtle', '--app-background']) {
        assert.ok(
          contrastRatio(palette['--text-muted'], palette[surface]) >= 4.5,
          `${background} ${dark ? 'dunkel' : 'hell'}: Hinweistext auf ${surface} ist nicht ausreichend lesbar`
        );
      }
      assert.ok(
        contrastRatio(palette['--nav-text'], palette['--nav-bg']) >= 4.5,
        `${background} ${dark ? 'dunkel' : 'hell'}: inaktive Navigation ist nicht ausreichend lesbar`
      );
      assert.ok(
        contrastRatio(palette['--nav-text-muted'], palette['--nav-bg']) >= 4.5,
        `${background} ${dark ? 'dunkel' : 'hell'}: sekundäre Navigation ist nicht ausreichend lesbar`
      );
      const auroraGradientEnd = mixSrgb(palette['--background-glow'], palette['--nav-bg'], 0.24);
      for (const sidebarBackground of [palette['--nav-bg'], auroraGradientEnd]) {
        const releaseText = mixSrgb(palette['--nav-text-muted'], sidebarBackground, 0.78);
        assert.ok(
          contrastRatio(releaseText, sidebarBackground) >= 4.5,
          `${background} ${dark ? 'dunkel' : 'hell'}: sekundäre Aurora-Navigation mit Footer-Deckkraft ist nicht ausreichend lesbar`
        );
      }
    }
  }

  assert.deepEqual(
    bodyForegroundOverrides(),
    [],
    'eine Designfamilie darf die Schrift einer expliziten Hintergrundpalette nicht mit höherer Spezifität ersetzen'
  );
  assert.ok(
    lastRuleIndexForSelector('body.theme-dark[data-background="blue"]') >
      lastRuleIndexForSelector('body.theme-dark[data-design-family="aurora"]'),
    'Dark-Hintergrundpaletten müssen gleich spezifische Designfamilien-Regeln in der Kaskade ersetzen'
  );
});

test('Aurora-Lichtpass bleibt eine endliche pointer-neutrale Ebene hinter den Bedienelementen', () => {
  const target = declarationsForSelector('body[data-design-family="aurora"] .aurora-effect-run');
  const sweep = declarationsForSelector('body[data-design-family="aurora"] .aurora-effect-run::before');
  const calm = declarationsForSelector('body[data-design-family="aurora"][data-effective-motion="calm"] .aurora-effect-run::before');
  const vivid = declarationsForSelector('body[data-design-family="aurora"][data-effective-motion="vivid"] .aurora-effect-run::before');

  assert.equal(target.position, 'relative');
  assert.equal(target.isolation, 'isolate');
  assert.equal(target.overflow, 'hidden');
  assert.equal(sweep['pointer-events'], 'none');
  assert.match(sweep.opacity, /^0(?: !important)?$/);
  assert.match(calm.animation, /aurora-light-pass/);
  assert.match(vivid.animation, /aurora-light-pass/);
  assert.equal(calm['animation-iteration-count'], '1');
  assert.equal(vivid['animation-iteration-count'], '1');
  assert.match(stylesheet, /@keyframes\s+aurora-light-pass\s*\{[\s\S]*?translateX\(410%\)[\s\S]*?\}/);
  assert.match(stylesheet, /@keyframes\s+aurora-light-pass\s*\{[^}]*\}[^}]*12%\s*\{\s*opacity:\s*1\s*;?\s*\}[^}]*80%\s*\{\s*opacity:\s*1\s*;?\s*\}/,
    'die Bewegungsdeckkraft darf den bereits transparenten Streifen nicht ein zweites Mal abschwaechen');
});

test('Aurora-Lichtpass ist bei reduzierter Bewegung auch gegen eine alte Laufklasse abgeschirmt', () => {
  assert.match(
    stylesheet,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.aurora-effect-run::before\s*\{[^}]*animation:\s*none\s*!important[^}]*opacity:\s*0\s*!important/s
  );
});
