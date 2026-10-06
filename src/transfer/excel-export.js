/*!
 * write-excel-file 4.1.1
 * MIT License
 * Copyright (c) 2018 gitlab.com/catamphetamine
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/*!
 * fflate 0.8.3
 * MIT License
 * Copyright (c) 2026 Arjun Barrett
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import writeExcelFile from 'write-excel-file/universal';

export const EXCEL_XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function createExcelTextCell(value, style = {}) {
  return {
    ...style,
    value: String(value ?? ''),
    type: String,
    format: '@'
  };
}

export function createExcelNumberCell(value, style = {}) {
  if (!Number.isFinite(value)) return createExcelTextCell('', style);
  const scaled = value * 100;
  const rounded = Number.isFinite(scaled) ? Math.round(scaled) / 100 : value;
  return {
    ...style,
    value: rounded,
    type: Number,
    format: Number.isInteger(rounded) ? '0' : '0.0#'
  };
}

export function createUniqueWorksheetNames(titles) {
  const usedNames = new Set();
  return (titles || []).map(title => {
    let sanitized = String(title ?? '')
      .replace(/[\\/?*\[\]:]/g, '_')
      .replace(/[\u0000-\u001f]/g, ' ')
      .trim()
      .replace(/^'+|'+$/g, '')
      .trim() || 'Kurs';
    if (sanitized.toLocaleLowerCase('en-US') === 'history') sanitized += '_';
    let sequence = 1;
    let candidate;
    do {
      sequence += 1;
      const suffix = sequence === 2 ? '' : ` (${sequence - 1})`;
      const prefix = sanitized.slice(0, 31 - suffix.length).trimEnd().replace(/'+$/g, '').trimEnd() || 'Kurs';
      candidate = prefix + suffix;
    } while (usedNames.has(candidate.toLocaleLowerCase('de-DE')));
    usedNames.add(candidate.toLocaleLowerCase('de-DE'));
    return candidate;
  });
}

export function createExcelWorkbookBlob(sheets) {
  const workbookSheets = (sheets || []).map(sheet => ({ ...sheet }));
  return writeExcelFile(workbookSheets, { fontFamily: 'Arial', fontSize: 11 }).toBlob();
}
