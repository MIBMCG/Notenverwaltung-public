const SUPPORTED_ENCODINGS = new Set(['utf-8', 'windows-1252']);
const toString = Object.prototype.toString;

export class CsvDecodeError extends Error {
  constructor(encoding, message = 'CSV byte decoding failed', cause) {
    super(message);
    this.name = 'CsvDecodeError';
    this.encoding = encoding;
    if (cause !== undefined) this.cause = cause;
  }
}

function asByteView(bytes, encoding) {
  try {
    if (toString.call(bytes) === '[object ArrayBuffer]') return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes) && toString.call(bytes) === '[object Uint8Array]') return bytes;
  } catch (error) {
    throw new CsvDecodeError(encoding, 'CSV input must be an ArrayBuffer or Uint8Array', error);
  }

  throw new CsvDecodeError(encoding, 'CSV input must be an ArrayBuffer or Uint8Array');
}

export function decodeCsvBytes(bytes, encoding = 'utf-8') {
  if (!SUPPORTED_ENCODINGS.has(encoding)) {
    throw new CsvDecodeError(encoding, `Unsupported CSV encoding: ${String(encoding)}`);
  }

  const byteView = asByteView(bytes, encoding);
  try {
    const decoder = encoding === 'utf-8'
      ? new TextDecoder('utf-8', { fatal: true })
      : new TextDecoder('windows-1252');
    return decoder.decode(byteView);
  } catch (error) {
    if (error instanceof CsvDecodeError) throw error;
    throw new CsvDecodeError(encoding, `Could not decode CSV bytes as ${encoding}`, error);
  }
}
