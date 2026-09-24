// Just enough of RFC 6455 to push text at a browser and notice when it hangs
// up. A WebSocket library would be one more dependency in a repository whose
// whole supply-chain policy exists to avoid them, for about a hundred lines of
// framing that never has to change.
//
// Server to client only, so frames are written unmasked; client frames arrive
// masked and are unmasked here.

import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

/** The constant RFC 6455 §4.2.2 appends to the client's key. */
const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const Opcode = { Text: 0x1, Close: 0x8, Ping: 0x9, Pong: 0xa } as const;

const FIN = 0x80;
const MASKED = 0x80;
const OPCODE_MASK = 0x0f;
const LENGTH_MASK = 0x7f;

/** Payload lengths above these switch to the wider length field. */
const SHORT_MAX = 125;
const MEDIUM_FLAG = 126;
const MEDIUM_MAX = 0xffff;
const LONG_FLAG = 127;

/** Every frame starts with an opcode byte and a length byte. */
const HEADER_BYTES = 2;

const MASK_BYTES = 4;
const MEDIUM_BYTES = 2;
const LONG_BYTES = 8;

/** The header a client sends to open a socket, and what we must echo back. */
export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + ACCEPT_GUID)
    .digest('base64');
}

/** The 101 response that completes the handshake. */
export function handshake(key: string): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '\r\n',
  ].join('\r\n');
}

/** The length prefix for `size` bytes of payload, unmasked. */
function lengthPrefix(size: number): Buffer {
  if (size <= SHORT_MAX) return Buffer.from([size]);

  if (size <= MEDIUM_MAX) {
    const header = Buffer.alloc(1 + MEDIUM_BYTES);

    header.writeUInt8(MEDIUM_FLAG, 0);
    header.writeUInt16BE(size, 1);

    return header;
  }

  const header = Buffer.alloc(1 + LONG_BYTES);

  header.writeUInt8(LONG_FLAG, 0);
  header.writeBigUInt64BE(BigInt(size), 1);

  return header;
}

/** `text` as one unfragmented text frame. */
export function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');

  return Buffer.concat([Buffer.from([FIN | Opcode.Text]), lengthPrefix(payload.length), payload]);
}

/** An empty close frame, which is how this server says goodbye. */
export function closeFrame(): Buffer {
  return Buffer.from([FIN | Opcode.Close, 0]);
}

/** What a client frame turned out to be. Only `close` changes anything here. */
export interface ClientFrame {
  readonly opcode: number;
  readonly text: string;
}

/** Where the payload starts, given the length byte the client sent. */
function payloadStart(flagged: number): number {
  if (flagged === MEDIUM_FLAG) return HEADER_BYTES + MEDIUM_BYTES + MASK_BYTES;

  if (flagged === LONG_FLAG) return HEADER_BYTES + LONG_BYTES + MASK_BYTES;

  return HEADER_BYTES + MASK_BYTES;
}

/**
 * The first frame in `data`, or `undefined` when it is not yet complete.
 * Fragmentation and continuation frames are not handled: a browser sends
 * neither for the short control messages this server reads.
 */
export function readFrame(data: Buffer): ClientFrame | undefined {
  if (data.length < HEADER_BYTES) return undefined;

  const opcode = (data[0] ?? 0) & OPCODE_MASK;
  const flagged = (data[1] ?? 0) & LENGTH_MASK;
  const masked = ((data[1] ?? 0) & MASKED) !== 0;
  const start = payloadStart(flagged);

  if (!masked || data.length < start) return { opcode, text: '' };

  const mask = data.subarray(start - MASK_BYTES, start);
  const payload = data.subarray(start);
  const decoded = Buffer.from(payload);

  for (const [index, byte] of payload.entries()) {
    decoded[index] = byte ^ (mask[index % MASK_BYTES] ?? 0);
  }

  return { opcode, text: decoded.toString('utf8') };
}

/** Whether a frame says the client is closing. */
export function isClose(frame: ClientFrame): boolean {
  return frame.opcode === Opcode.Close;
}

/** Sends the handshake and hands back a writer for text frames. */
export function upgrade(socket: Duplex, key: string): (text: string) => void {
  socket.write(handshake(key));

  return (text) => {
    if (!socket.destroyed) socket.write(textFrame(text));
  };
}

export { Opcode };
