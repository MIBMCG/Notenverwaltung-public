export function csvCell(value) {
  // Semikolon-CSV für deutsche Tabellenkalkulationen: Sonderzeichen werden sauber gequotet.
  let text = String(value ?? "");
  if (/^[\t ]*[=+\-@]/.test(text)) text = "'" + text;
  if (/[;"\r\n]/.test(text)) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

const CSV_TRANSFER_FIELDS = [
  "KursID", "Kurs", "Fach", "Klasse", "SchuelerID", "Nachname", "Vorname", "Geburtstag",
  "Schema", "Kursart", "Qualifikationsabschnitt", "3. Pruefungsfach schriftlich", "Stammklasse"
];
const CSV_PROTECTION_FIELD = 'CSV-Schutz';
const CSV_PROTECTION_MAX_MASK = 0x1fffn;
const FORMULA_PREFIX = /^[\t ]*[=+\-@]/;

export function encodeCsvTransferRow(fields) {
  if (!Array.isArray(fields) || fields.length !== 13) {
    throw new TypeError('Eine CSV-Transferzeile benötigt genau 13 Rohfelder.');
  }
  let mask = 0;
  const cells = fields.map((value, index) => {
    if (FORMULA_PREFIX.test(String(value ?? ''))) mask |= 1 << index;
    return csvCell(value);
  });
  cells.push('nv1:' + mask.toString(16));
  return cells.join(';');
}

export function decodeCsvTransferFields(fields, columnCount) {
  if (!Array.isArray(fields)) throw new TypeError('CSV-Felder müssen als Array vorliegen.');
  if (!Number.isInteger(columnCount) || columnCount < 8 || columnCount > 14) {
    throw new TypeError('Die CSV-Spaltenanzahl muss zwischen 8 und 14 liegen.');
  }
  if (fields.length !== columnCount) {
    throw new Error('Die Spaltenanzahl passt nicht zur CSV-Schutzangabe.');
  }
  if (columnCount !== 14) return fields.slice();

  const protection = String(fields[13] ?? '');
  const match = /^nv1:([0-9a-fA-F]+)$/.exec(protection);
  if (!match) throw new Error('Ungültige CSV-Schutzmaske: erwartet wird nv1 mit Hexziffern.');
  const mask = BigInt('0x' + match[1]);
  if (mask > CSV_PROTECTION_MAX_MASK) {
    throw new Error('Ungültige CSV-Schutzmaske: Bits außerhalb der ersten 13 Felder sind gesetzt.');
  }

  return fields.slice(0, 13).map((value, index) => {
    const text = String(value ?? '');
    if ((mask & (1n << BigInt(index))) === 0n) return text;
    if (!text.startsWith("'")) {
      throw new Error('Ungültige CSV-Schutzmaske: Das markierte Feld besitzt kein Schutzapostroph.');
    }
    const unprotected = text.slice(1);
    if (!FORMULA_PREFIX.test(unprotected)) {
      throw new Error('Ungültige CSV-Schutzmaske: Das markierte Feld ist nicht schutzbedürftig.');
    }
    return unprotected;
  });
}

export function parseSemicolonCsv(text) {
  const rows = [];
  let fields = [], field = '', inQuotes = false, line = 1, rowStartLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
        if (ch === '\n') line++;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') { inQuotes = true; continue; }
    if (ch === ';') { fields.push(field); field = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      fields.push(field); field = '';
      if (fields.some(value => String(value).trim() !== '')) rows.push({ fields, line: rowStartLine });
      fields = []; line++; rowStartLine = line; continue;
    }
    field += ch;
  }
  if (inQuotes) throw new Error('Nicht geschlossenes Anführungszeichen ab Zeile ' + rowStartLine + '.');
  fields.push(field);
  if (fields.some(value => String(value).trim() !== '')) rows.push({ fields, line: rowStartLine });
  return rows;
}

export function validateCsvTransferHeader(actualHeader) {
  const expectedHeader = [...CSV_TRANSFER_FIELDS, CSV_PROTECTION_FIELD];
  const header = Array.isArray(actualHeader) ? actualHeader.map(value => String(value || '').trim()) : [];
  if (header.length < 8 || header.length > 14 || header.some((value, index) => value !== expectedHeader[index])) {
    throw new Error('Die Kopfzeile muss aus den ersten 8 bis 13 Spalten oder zusätzlich aus CSV-Schutz bestehen.');
  }
  return { columnCount: header.length, expectedHeader };
}

export function formatCsvImportIssuesText(issueList) {
  return (issueList || []).map(e =>
    'Zeile ' + (e && e.line ? e.line : '?') + '\t' + ((e && e.issues) || []).join('; ')
  ).join('\n');
}

export function formatCsvImportIssuesCsv(issueList) {
  const lines = ['Zeile;Fehler'];
  for (const e of issueList || []) {
    const issues = ((e && e.issues) || []).join('; ').replace(/"/g, '""');
    lines.push((e && e.line ? e.line : '') + ';"' + issues + '"');
  }
  return '\ufeff' + lines.join('\n');
}

export function normalizeCsvDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let year, month, day;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  const local = !iso ? text.match(/^(\d{1,2})[\.\/-](\d{1,2})[\.\/-](\d{2,4})$/) : null;
  if (local) {
    day = Number(local[1]); month = Number(local[2]); year = local[3];
    if (String(year).length === 2) { const shortYear = Number(year); year = shortYear >= 50 ? 1900 + shortYear : 2000 + shortYear; }
  }
  if (!Number.isInteger(Number(year)) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  year = Number(year);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}
