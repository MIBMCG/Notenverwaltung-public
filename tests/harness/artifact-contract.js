'use strict';

function parseAttributes(source) {
  const attributes = [];
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length || source[index] === '/' || source[index] === '>') break;
    const nameStart = index;
    while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1;
    const name = source.slice(nameStart, index).toLowerCase();
    while (index < source.length && /\s/.test(source[index])) index += 1;
    let value = '';
    if (source[index] === '=') {
      index += 1;
      while (index < source.length && /\s/.test(source[index])) index += 1;
      const quote = source[index] === '"' || source[index] === "'" ? source[index] : '';
      if (quote) {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) index += 1;
        value = source.slice(valueStart, index);
        if (index < source.length) index += 1;
      } else {
        const valueStart = index;
        while (index < source.length && !/[\s>]/.test(source[index])) index += 1;
        value = source.slice(valueStart, index);
      }
    }
    if (name) attributes.push({ name, value });
  }
  return attributes;
}

function attributeValues(attributes, name) {
  return attributes.filter(attribute => attribute.name === name).map(attribute => attribute.value);
}

function hasAttribute(attributes, name) {
  return attributes.some(attribute => attribute.name === name);
}

function isEmbeddedValue(value) {
  return /^(?:data|blob):/i.test(value) || value.startsWith('#');
}

function parseSrcset(value) {
  const candidates = [];
  const expression = /((?:data|blob):[^\s]+|[^,\s]+)(?:\s+(?:\d+(?:\.\d+)?x|\d+w))?(?=\s*(?:,|$))/gi;
  for (const match of value.matchAll(expression)) candidates.push(match[1]);
  return candidates;
}

function readCssUrl(css, start) {
  let index = start + 4;
  while (/\s/.test(css[index] || '')) index += 1;
  const quote = css[index] === '"' || css[index] === "'" ? css[index] : '';
  if (quote) {
    index += 1;
    const valueStart = index;
    while (index < css.length && css[index] !== quote) index += 1;
    const value = css.slice(valueStart, index);
    if (index < css.length) index += 1;
    while (/\s/.test(css[index] || '')) index += 1;
    if (css[index] === ')') index += 1;
    return { value, end: index };
  }
  const valueStart = index;
  let depth = 0;
  while (index < css.length) {
    if (css[index] === '(') depth += 1;
    if (css[index] === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    index += 1;
  }
  return { value: css.slice(valueStart, index).trim(), end: index + (css[index] === ')' ? 1 : 0) };
}

function skipCssTrivia(css, index) {
  while (index < css.length) {
    while (/\s/.test(css[index] || '')) index += 1;
    if (!css.startsWith('/*', index)) break;
    const end = css.indexOf('*/', index + 2);
    index = end < 0 ? css.length : end + 2;
  }
  return index;
}

function readCssImageSet(css, start) {
  const references = [];
  let index = start + 10;
  let depth = 1;
  while (index < css.length && depth > 0) {
    index = skipCssTrivia(css, index);
    if (index >= css.length) break;
    if (css[index] === '(') { depth += 1; index += 1; continue; }
    if (css[index] === ')') { depth -= 1; index += 1; continue; }
    if (css[index] === '"' || css[index] === "'") {
      const quote = css[index++];
      const valueStart = index;
      while (index < css.length && css[index] !== quote) index += css[index] === '\\' ? 2 : 1;
      const value = css.slice(valueStart, index);
      if (value && !isEmbeddedValue(value)) references.push(value);
      if (index < css.length) index += 1;
      continue;
    }
    if (css.slice(index, index + 4).toLowerCase() === 'url(') {
      const result = readCssUrl(css, index);
      if (result.value && !isEmbeddedValue(result.value)) references.push(result.value);
      index = result.end;
      continue;
    }
    index += 1;
  }
  return { references, end: index };
}

function cssReferences(css) {
  const references = [];
  let index = 0;
  let quote = '';
  while (index < css.length) {
    if (css.startsWith('/*', index)) {
      const end = css.indexOf('*/', index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (quote) {
      if (css[index] === '\\') index += 2;
      else if (css[index] === quote) quote = '';
      index += 1;
      continue;
    }
    if (css[index] === '"' || css[index] === "'") {
      quote = css[index];
      index += 1;
      continue;
    }
    if (css.slice(index, index + 7).toLowerCase() === '@import' && /\s|\//.test(css[index + 7] || '')) {
      index += 7;
      index = skipCssTrivia(css, index);
      if (css.slice(index, index + 4).toLowerCase() === 'url(') {
        const result = readCssUrl(css, index);
        if (result.value) references.push({ value: result.value, index });
        index = result.end;
      } else if (css[index] === '"' || css[index] === "'") {
        const importQuote = css[index++];
        const valueStart = index;
        while (index < css.length && css[index] !== importQuote) index += 1;
        references.push({ value: css.slice(valueStart, index), index: valueStart });
        if (index < css.length) index += 1;
      } else {
        const valueStart = index;
        while (index < css.length && !/[\s;]/.test(css[index])) index += 1;
        references.push({ value: css.slice(valueStart, index), index: valueStart });
      }
      continue;
    }
    if (css.slice(index, index + 10).toLowerCase() === 'image-set(') {
      const result = readCssImageSet(css, index);
      references.push(...result.references.map(value => ({ value, index })));
      index = result.end;
      continue;
    }
    if (css.slice(index, index + 4).toLowerCase() === 'url(') {
      const result = readCssUrl(css, index);
      if (result.value && !isEmbeddedValue(result.value)) references.push({ value: result.value, index });
      index = result.end;
      continue;
    }
    index += 1;
  }
  return references.sort((left, right) => left.index - right.index).map(reference => reference.value);
}

function readJsLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return null;
  let index = start + 1;
  let value = '';
  while (index < source.length) {
    if (source[index] === '\\') {
      value += source[index + 1] || '';
      index += 2;
    } else if (quote === '`' && source.startsWith('${', index)) {
      return null;
    } else if (source[index] === quote) {
      return { value, end: index + 1 };
    } else {
      value += source[index++];
    }
  }
  return { value, end: index };
}

function skipJsTrivia(source, index) {
  while (index < source.length) {
    while (/\s/.test(source[index] || '')) index += 1;
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return index;
}

function readJsLiteralArgument(source, openParenthesis, argumentIndex) {
  let index = skipJsTrivia(source, openParenthesis + 1);
  for (let current = 0; current < argumentIndex; current += 1) {
    const literal = readJsLiteral(source, index);
    if (!literal) return null;
    index = skipJsTrivia(source, literal.end);
    if (source[index] !== ',') return null;
    index = skipJsTrivia(source, index + 1);
  }
  return readJsLiteral(source, index);
}

function jsReferences(source) {
  const references = [];
  const resourceProperties = new Set(['src', 'href', 'srcset', 'poster', 'data', 'srcdoc', 'action']);
  const resourceConstructors = new Set(['WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'Image']);
  const resourceCalls = new Set(['fetch']);
  const add = (value, index, property = '') => {
    if (['Logo.png', 'placeholder-logo.svg'].includes(value) && property === 'src') return;
    references.push({ value, index });
  };
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) { index = source.indexOf('\n', index + 2); if (index < 0) break; continue; }
    if (source.startsWith('/*', index)) { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
    if (source[index] === '"' || source[index] === "'" || source[index] === '`') {
      const quote = source[index++];
      while (index < source.length) {
        if (source[index] === '\\') index += 2;
        else if (source[index++] === quote) break;
      }
      continue;
    }
    if (!/[A-Za-z_$]/.test(source[index])) { index += 1; continue; }
    const wordStart = index;
    index += 1;
    while (/[\w$]/.test(source[index] || '')) index += 1;
    const word = source.slice(wordStart, index);
    let next = skipJsTrivia(source, index);
    if (word === 'import' && source[next] === '(') {
      next = skipJsTrivia(source, next + 1);
      const literal = readJsLiteral(source, next);
      if (literal) { add(literal.value, wordStart); index = literal.end; continue; }
    }
    if (word === 'setAttribute' && source[next] === '(') {
      const nameLiteral = readJsLiteral(source, skipJsTrivia(source, next + 1));
      if (nameLiteral && resourceProperties.has(nameLiteral.value.toLowerCase())) {
        next = skipJsTrivia(source, nameLiteral.end);
        if (source[next] === ',') {
          const valueLiteral = readJsLiteral(source, skipJsTrivia(source, next + 1));
          if (valueLiteral) add(valueLiteral.value, wordStart, nameLiteral.value.toLowerCase());
        }
      }
    }
    if (word === 'new') {
      next = skipJsTrivia(source, next);
      const constructorStart = next;
      while (/[\w$]/.test(source[next] || '')) next += 1;
      const constructor = source.slice(constructorStart, next);
      if (resourceConstructors.has(constructor) && source[skipJsTrivia(source, next)] === '(') {
        const literal = readJsLiteral(source, skipJsTrivia(source, next) + 1);
        if (literal) add(literal.value, wordStart);
      }
    } else if (resourceCalls.has(word) && source[next] === '(') {
      const literal = readJsLiteral(source, skipJsTrivia(source, next + 1));
      if (literal) add(literal.value, wordStart);
    }
    if (source[next] === '.') {
      const propertyStart = next + 1;
      next = skipJsTrivia(source, propertyStart);
      const actualStart = next;
      while (/[\w$]/.test(source[next] || '')) next += 1;
      const property = source.slice(actualStart, next).toLowerCase();
      next = skipJsTrivia(source, next);
      if (resourceProperties.has(property) && source[next] === '=') {
        const literal = readJsLiteral(source, skipJsTrivia(source, next + 1));
        if (literal) add(literal.value, wordStart, property);
      } else if (property === 'setattribute' && source[next] === '(') {
        const nameLiteral = readJsLiteralArgument(source, next, 0);
        const resourceProperty = nameLiteral && nameLiteral.value.toLowerCase();
        if (resourceProperties.has(resourceProperty)) {
          const valueLiteral = readJsLiteralArgument(source, next, 1);
          if (valueLiteral) add(valueLiteral.value, wordStart, resourceProperty);
        }
      } else if (property === 'fetch' && source[next] === '(') {
        const literal = readJsLiteralArgument(source, next, 0);
        if (literal) add(literal.value, wordStart);
      } else if (property === 'open' && source[next] === '(') {
        const methodLiteral = readJsLiteralArgument(source, next, 0);
        if (methodLiteral && /^(?:CONNECT|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PUT|TRACE)$/i.test(methodLiteral.value)) {
          const urlLiteral = readJsLiteralArgument(source, next, 1);
          if (urlLiteral) add(urlLiteral.value, wordStart);
        }
      }
    }
    index = Math.max(index, next);
  }
  return references.sort((left, right) => left.index - right.index).map(reference => reference.value);
}

function readTag(html, start) {
  let index = start + 1;
  let quote = '';
  while (index < html.length) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return { text: html.slice(start, index + 1), end: index + 1 };
    }
    index += 1;
  }
  return { text: html.slice(start), end: html.length };
}

function tokenizeHtml(html) {
  const tokens = [];
  let index = 0;
  while (index < html.length) {
    if (!html.startsWith('<', index)) {
      index += 1;
      continue;
    }
    if (html.startsWith('<!--', index)) {
      const end = html.indexOf('-->', index + 4);
      index = end < 0 ? html.length : end + 3;
      continue;
    }
    const tag = readTag(html, index);
    const match = /^<\s*(\/?)\s*([a-z][\w:-]*)/i.exec(tag.text);
    if (!match) {
      index = tag.end;
      continue;
    }
    const closing = Boolean(match[1]);
    const name = match[2].toLowerCase();
    const bodyStart = match[0].length;
    const bodyEnd = tag.text.length - 1;
    tokens.push({ name, attributes: closing ? [] : parseAttributes(tag.text.slice(bodyStart, bodyEnd)), index });
    index = tag.end;
    if (!closing && (name === 'script' || name === 'style')) {
      const closeExpression = new RegExp(`</\\s*${name}\\b`, 'ig');
      closeExpression.lastIndex = index;
      const close = closeExpression.exec(html);
      const bodyEndIndex = close ? close.index : html.length;
      tokens[tokens.length - 1].rawText = html.slice(index, bodyEndIndex);
      index = close ? close.index : html.length;
    }
  }
  return tokens;
}

function inspectMarkup(html) {
  const references = [];
  for (const token of tokenizeHtml(html)) {
    const { name: tag, attributes } = token;
    const add = value => {
      if (value !== undefined) references.push({ value, index: token.index });
    };
    if (tag === 'style' && token.rawText !== undefined) {
      for (const value of cssReferences(token.rawText)) add(value);
    }
    if (tag === 'script' && token.rawText !== undefined) {
      for (const value of jsReferences(token.rawText)) add(value);
    }
    for (const value of attributeValues(attributes, 'style')) {
      for (const reference of cssReferences(value)) add(reference);
    }
    if (tag === 'script') for (const value of attributeValues(attributes, 'src')) add(value);
    if (tag === 'link') for (const value of attributeValues(attributes, 'href')) add(value);
    if (tag === 'iframe' && hasAttribute(attributes, 'srcdoc')) {
      for (const value of attributeValues(attributes, 'srcdoc')) add(value);
    }
    if (tag === 'img') {
      for (const value of attributeValues(attributes, 'src')) {
        if (!['Logo.png', 'placeholder-logo.svg'].includes(value) && !isEmbeddedValue(value)) add(value);
      }
    }
    if (tag === 'img' || tag === 'source') for (const srcset of attributeValues(attributes, 'srcset')) {
      for (const value of parseSrcset(srcset)) {
        if (!['Logo.png', 'placeholder-logo.svg'].includes(value) && !isEmbeddedValue(value)) add(value);
      }
    }
    if (tag === 'video' || tag === 'audio') {
      for (const value of attributeValues(attributes, 'src')) add(value);
      for (const value of attributeValues(attributes, 'poster')) add(value);
    }
    if (tag === 'object') for (const value of attributeValues(attributes, 'data')) {
      if (!isEmbeddedValue(value)) add(value);
    }
    if (tag === 'iframe' || tag === 'frame' || tag === 'embed') for (const value of attributeValues(attributes, 'src')) add(value);
    if (tag === 'source' || tag === 'track') for (const value of attributeValues(attributes, 'src')) add(value);
  }
  return references.sort((left, right) => left.index - right.index).map(reference => reference.value);
}

function listImageReferences(html) {
  const references = [];
  for (const token of tokenizeHtml(html)) {
    if (token.name !== 'img' && token.name !== 'source') continue;
    references.push(...attributeValues(token.attributes, 'src'));
    for (const value of attributeValues(token.attributes, 'srcset')) references.push(...parseSrcset(value));
  }
  // The generated application keeps its print-logo consumer in a JS template
  // string. Capture that known static consumer without treating script text as
  // executable markup for the runtime-resource inspector.
  const printLogoExpression = /<img\b[^>]*\bclass\s*=\s*["']print-logo["'][^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(printLogoExpression)) references.push(match[1]);
  const sharedLogoPath = html.match(/function\s+getSchoolLogoPath\s*\(\s*\)\s*\{\s*return\s+["']([^"']+)["']\s*;?\s*\}/);
  const sharedPrintLogoExpression = /<img\b[^>]*\bclass\s*=\s*["']print-logo["'][^>]*\bsrc\s*=\s*["']\$\{getSchoolLogoPath\(\)\}["']/i;
  if (sharedLogoPath && sharedPrintLogoExpression.test(html)) references.push(sharedLogoPath[1]);
  const schoolLogoHelper = html.match(/function\s+getSchoolLogoSources\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/);
  if (schoolLogoHelper) {
    for (const match of schoolLogoHelper[1].matchAll(/["']([^"']+\.(?:png|svg))["']/g)) references.push(match[1]);
  }
  return references.filter(value =>
    /\.(?:png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.test(value)
  );
}

function listForbiddenRuntimeReferences(html) {
  return inspectMarkup(html);
}

module.exports = { listForbiddenRuntimeReferences, listImageReferences };
