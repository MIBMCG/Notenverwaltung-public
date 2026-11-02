'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function luminance(rgb) {
  return rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function rgb(hex) { return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255); }
function hsl(hue, saturation, lightness) {
  const l = lightness / 100;
  const a = saturation / 100 * Math.min(l, 1 - l);
  return [0, 8, 4].map(n => {
    const k = (n + hue / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  });
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

test('all slider hues keep course text above 4.5:1 in light, dark and system palettes including Aurora glows', () => {
  const css = fs.readFileSync('src/ui/course-cards.css', 'utf8');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes('.nv-course-cards__card[data-course-hue]'));
  assert.equal(rules.length, 3, 'light, dark and system palettes are verified');
  for (const [ , selector, body] of rules) {
    const declarations = Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
    const text = ['--nv-course-text', '--nv-course-muted'].map(key => {
      assert.match(declarations[key] || '', /^#[a-f\d]{6}$/i, `${selector}: own readable ${key}`);
      return rgb(declarations[key]);
    });
    const palette = {};
    for (const key of ['--nv-course-panel', '--nv-course-soft', '--nv-course-glow', '--nv-fx-glow']) {
      const match = /hsl\(var\(--nv-course-hue\) (\d+)% (\d+)%(?: \/ ([.\d]+))?\)/.exec(declarations[key]);
      assert.ok(match, `supported numeric HSL palette: ${key}`);
      palette[key] = { s: Number(match[1]), l: Number(match[2]), alpha: Number(match[3] || 1) };
    }
    for (let hue = 0; hue < 360; hue++) {
      for (const surface of ['--nv-course-panel', '--nv-course-soft']) {
        const base = hsl(hue, palette[surface].s, palette[surface].l);
        const backgrounds = [base];
        for (const [key, alpha] of [['--nv-course-glow', 0.65], ['--nv-fx-glow', palette['--nv-fx-glow'].alpha]]) {
          const glow = hsl(hue, palette[key].s, palette[key].l);
          backgrounds.push(base.map((value, index) => value * (1 - alpha) + glow[index] * alpha));
        }
        for (const foreground of text) for (const background of backgrounds) {
          assert.ok(contrast(foreground, background) >= 4.5, `low contrast at hue ${hue} in ${selector}`);
        }
      }
    }
  }
});
