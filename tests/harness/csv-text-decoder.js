'use strict';

const probe = Uint8Array.of(0x80);
const oneShot = new TextDecoder('windows-1252').decode(probe);
const streamedDecoder = new TextDecoder('windows-1252');
const streamed = streamedDecoder.decode(probe, { stream: true }) + streamedDecoder.decode();
const needsNativeStreaming = oneShot !== '\u20ac' && streamed === '\u20ac';

// Node 20's one-shot Latin1 fast path misses the Windows-1252 extension.
// Its native streaming path follows the browser encoding standard.
class NativeCsvTextDecoder extends TextDecoder {
  decode(input, options) {
    if (this.encoding === 'windows-1252' && input !== undefined && options?.stream !== true) {
      return super.decode(input, { stream: true }) + super.decode();
    }
    return super.decode(input, options);
  }
}

module.exports = { CsvTextDecoder: needsNativeStreaming ? NativeCsvTextDecoder : TextDecoder };
