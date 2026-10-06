import { fromMarkdown } from 'mdast-util-from-markdown';

// A deliberately small inert HTML subset. Unrecognized raw HTML is rejected,
// so a newly added active HTML element cannot bypass link verification.
function inertComment(value) {
  const raw = value.trim();
  if (raw.length < 7 || !raw.startsWith('<!--') || !raw.endsWith('-->')) return false;
  const body = raw.slice(4, -3);
  // HTML can end a comment before the final delimiter (including --!>), or
  // treat abrupt/nested starts differently. Reject those ambiguous forms.
  return !body.startsWith('>') && !body.startsWith('->') &&
    !body.includes('<!--') && !body.includes('-->') && !body.includes('--!>') &&
    !body.endsWith('<!-');
}

function htmlAnchor(value) {
  if (inertComment(value) || /^<\/?div(?: align="center")?>$/i.test(value)) return null;
  if (/^<\/a>$/i.test(value)) return null;
  const anchor = /^<a\s+(id|name)=(?:"([^"<>]+)"|'([^'<>]+)')>$/.exec(value);
  if (anchor && !/[&\\]/.test(anchor[2] || anchor[3])) return anchor[2] || anchor[3];
  throw new Error('Nicht unterstütztes HTML/HTML-Link in Dokumentation; bitte Markdown-Inline-Links oder reine Anker verwenden.');
}

function visit(node, callback) {
  callback(node);
  for (const child of node.children || []) visit(child, callback);
}

function headingText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt || '';
  if (node.type === 'break') return ' ';
  return (node.children || []).map(headingText).join('');
}

function slug(value) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').trim().replace(/\s+/g, '-');
}

function linkSpan(markdown, node) {
  const offset = node.position?.start?.offset;
  const endOffset = node.position?.end?.offset;
  const source = markdown.slice(offset, endOffset);
  // All AST links/images must reach this assertion. We only rewrite a simple
  // inline destination with a provable source span; other active forms fail.
  const match = /^!?\[[^\]\n]*\]\((<([^>\n]*)>|([^\s()\n]*))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)$/.exec(source);
  if (!match) throw new Error('Nicht unterstützte Markdown-Linkform; bitte einfachen Inline-Link verwenden.');
  const raw = match[2] ?? match[3];
  // CommonMark has already decoded backslash escapes and entities in node.url.
  // Keep the raw span for replacement but validate the semantic destination.
  const relativeStart = match[0].indexOf('](') + 2 + (match[2] !== undefined ? 1 : 0);
  return { destination: node.url, start: offset + relativeStart, end: offset + relativeStart + raw.length };
}

export function parseMarkdown(markdown) {
  const tree = fromMarkdown(markdown);
  const links = [];
  const anchors = new Set();
  const counts = new Map();
  visit(tree, node => {
    if (node.type === 'definition' || node.type === 'linkReference' || node.type === 'imageReference') {
      throw new Error('Referenzlink oder Referenzdefinition ist nicht unterstützt; bitte Inline-Links verwenden.');
    }
    if (node.type === 'html') {
      const anchor = htmlAnchor(node.value);
      if (anchor) anchors.add(anchor);
    }
    if (node.type === 'heading') {
      const base = slug(headingText(node));
      const count = counts.get(base) || 0;
      anchors.add(count ? `${base}-${count}` : base);
      counts.set(base, count + 1);
    }
    if (node.type === 'link' || node.type === 'image') links.push(linkSpan(markdown, node));
  });
  return { links, anchors };
}
