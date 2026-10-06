'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const domainDirectory = path.join(__dirname, '..', 'src', 'domain');
const allowed = {
  'state.js': [],
  'initial-state.js': ['state.js'],
  'initial-assessments.js': [],
  'course-settings.js': [],
  'course-symbols.js': [],
  'assessments.js': ['state.js'],
  'courses.js': ['state.js', 'assessments.js', 'course-symbols.js'],
  'terms.js': ['state.js', 'course-settings.js', 'assessments.js', 'courses.js'],
  'grading.js': ['state.js', 'courses.js', 'terms.js', '../formatting/numbers.js'],
  'grading-logic.js': ['course-settings.js', 'terms.js', 'grading.js'],
  'students.js': ['state.js', 'courses.js'],
  'migrations.js': ['state.js', 'assessments.js', 'courses.js', 'course-symbols.js', 'terms.js'],
  'domain-model.js': ['state.js', 'assessments.js', 'courses.js', 'students.js', 'migrations.js']
};

function localImports(source, fileName = 'state.js') {
  const imports = [];
  const patterns = [
    /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?/gm,
    /^\s*export\s+(?:\*\s*(?:as\s+[\w$]+)?|\{[^}]*\})\s+from\s*['"]([^'"]+)['"];?/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('.')) {
        imports.push(path.posix.normalize(path.posix.join(path.posix.dirname(fileName), match[1])));
      }
    }
  }
  return imports;
}

function assertAllowedGraph(sources) {
  const graph = new Map();
  for (const [fileName, source] of Object.entries(sources)) {
    assert.ok(Object.hasOwn(allowed, fileName), `kein erlaubter Graphknoten für ${fileName}`);
    assert.doesNotMatch(source, /\b(?:window|document|localStorage|sessionStorage|indexedDB)\b/);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|Worker)\b/);
    assert.doesNotMatch(source, /\bcrypto\s*\./);
    assert.doesNotMatch(source, /Date\.now\s*\(|new Date\s*\(\s*\)/);
    const observed = localImports(source, fileName);
    assert.ok(observed.every(item => allowed[fileName].includes(item)), `${fileName}: unerlaubter lokaler Import`);
    graph.set(fileName, observed);
  }

  assertAcyclic(graph);
}

function assertAcyclic(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(fileName) {
    if (visiting.has(fileName)) throw new Error(`Importzyklus bei ${fileName}`);
    if (visited.has(fileName)) return;
    visiting.add(fileName);
    for (const dependency of graph.get(fileName) || []) visit(dependency);
    visiting.delete(fileName);
    visited.add(fileName);
  }
  for (const fileName of graph.keys()) visit(fileName);
}

test('domain modules retain the pure, acyclic allowed dependency boundary', () => {
  const domainSources = Object.fromEntries(fs.readdirSync(domainDirectory)
    .filter(fileName => fileName.endsWith('.js'))
    .map(fileName => [fileName, fs.readFileSync(path.join(domainDirectory, fileName), 'utf8')]));
  assertAllowedGraph(domainSources);
});

test('architecture guard rejects test-only forbidden APIs, static and dynamic dependencies, and cycles', () => {
  assert.throws(() => assertAllowedGraph({ 'state.js': 'const current = Date.now();' }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'assessments.js': "import './students.js';" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'assessments.js': "export { createStudent } from './students.js';" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'assessments.js': "export * from './students.js';" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'assessments.js': "const module = import('./students.js');" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'grading.js': "import '../../foreign/numbers.js';" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'grading.js': "export * from '../../foreign/numbers.js';" }), assert.AssertionError);
  assert.throws(() => assertAllowedGraph({ 'grading.js': "const numbers = import('../../foreign/numbers.js');" }), assert.AssertionError);
  assert.throws(() => assertAcyclic(new Map([
    ['state.js', ['assessments.js']],
    ['assessments.js', ['state.js']]
  ])), /Importzyklus/);
});

test('architecture parser recognizes permitted relative re-export and dynamic dependencies', () => {
  assert.deepEqual(localImports("export * from './state.js';"), ['state.js']);
  assert.deepEqual(localImports("const stateModule = import( './state.js' );"), ['state.js']);
  assert.deepEqual(localImports("import { parseDecimalInput } from '../formatting/numbers.js';", 'grading.js'), ['../formatting/numbers.js']);
  assert.doesNotThrow(() => assertAllowedGraph({ 'grading.js': "import '../formatting/numbers.js';" }));
  assert.doesNotThrow(() => assertAllowedGraph({ 'grading.js': "export * from '../formatting/numbers.js';" }));
  assert.doesNotThrow(() => assertAllowedGraph({ 'grading.js': "const numbers = import('../formatting/numbers.js');" }));
});
