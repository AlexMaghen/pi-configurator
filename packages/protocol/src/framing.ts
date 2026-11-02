/**
 * Splitting messages into BLE-sized frames and joining them back.
 *
 * A message is a sequence of frames written to `rpc-in` (phone to Pi) or notified on `rpc-out`
 * (Pi to phone). Messages in one direction never interleave.
 *
 *   byte 0      flags: 0x01 FIRST, 0x02 LAST, 0x04 ENCRYPTED (the message is a sealed session message)
 *   byte 1      frame index within the message, 0, 1, 2 ... wrapping at 256
 *   bytes 2-5   FIRST frame only: total message length, uint32 big-endian
 *   rest        payload bytes
 *
 * A one-frame message has FIRST and LAST both set. ENCRYPTED is the same on every frame of a
 * message. The frame size is the negotiated ATT MTU minus 3; 20 bytes is the smallest allowed.
 */

export const FLAG_FIRST = 0x01;
export const FLAG_LAST = 0x02;
export const FLAG_ENCRYPTED = 0x04;
export const MIN_FRAME_SIZE = 20;
export const MAX_MESSAGE_BYTES = 256 * 1024;

const FIRST_HEADER = 6;
const NEXT_HEADER = 2;

export class FramingError extends Error {}

export interface Message {
  payload: Uint8Array;
  encrypted: boolean;
}

export function splitMessage(payload: Uint8Array, encrypted: boolean, frameSize: number): Uint8Array[] {
  if (frameSize < MIN_FRAME_SIZE) throw new FramingError(`frame size must be at least ${MIN_FRAME_SIZE}`);
  if (payload.length > MAX_MESSAGE_BYTES) throw new FramingError("message too large");
  const frames: Uint8Array[] = [];
  let offset = 0;
  let index = 0;
  do {
    const first = index === 0;
    const header = first ? FIRST_HEADER : NEXT_HEADER;
    const take = Math.min(frameSize - header, payload.length - offset);
    const last = offset + take >= payload.length;
    const frame = new Uint8Array(header + take);
    frame[0] = (first ? FLAG_FIRST : 0) | (last ? FLAG_LAST : 0) | (encrypted ? FLAG_ENCRYPTED : 0);
    frame[1] = index & 0xff;
    if (first) new DataView(frame.buffer).setUint32(2, payload.length, false);
    frame.set(payload.subarray(offset, offset + take), header);
    frames.push(frame);
    offset += take;
    index++;
  } while (offset < payload.length);
  return frames;
}

/**
 * Collects frames from one direction and returns each message when its last frame arrives.
 * Any out-of-order frame throws and resets, so a broken message can't leak into the next one.
 */
export class FrameAssembler {
  private buffer?: Uint8Array;
  private filled = 0;
  private nextIndex = 0;
  private encrypted = false;

  push(frame: Uint8Array): Message | undefined {
    try {
      return this.accept(frame);
    } catch (err) {
      this.reset();
      throw err;
    }
  }

  reset(): void {
    this.buffer = undefined;
    this.filled = 0;
    this.nextIndex = 0;
    this.encrypted = false;
  }

  private accept(frame: Uint8Array): Message | undefined {
    if (frame.length < NEXT_HEADER) throw new FramingError("frame too short");
    const flags = frame[0]!;
    const index = frame[1]!;
    const first = (flags & FLAG_FIRST) !== 0;
    const last = (flags & FLAG_LAST) !== 0;
    const encrypted = (flags & FLAG_ENCRYPTED) !== 0;
    let body: Uint8Array;

    if (first) {
      if (this.buffer) throw new FramingError("new message started before the last one ended");
      if (index !== 0 || frame.length < FIRST_HEADER) throw new FramingError("bad first frame");
      const total = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(2, false);
      if (total > MAX_MESSAGE_BYTES) throw new FramingError("message too large");
      this.buffer = new Uint8Array(total);
      this.encrypted = encrypted;
      body = frame.subarray(FIRST_HEADER);
    } else {
      if (!this.buffer) throw new FramingError("continuation frame without a first frame");
      if (index !== (this.nextIndex & 0xff)) throw new FramingError("frame out of order");
      if (encrypted !== this.encrypted) throw new FramingError("encrypted flag changed mid-message");
      body = frame.subarray(NEXT_HEADER);
    }

    const buffer = this.buffer!;
    if (this.filled + body.length > buffer.length) throw new FramingError("more bytes than announced");
    buffer.set(body, this.filled);
    this.filled += body.length;
    this.nextIndex++;

    if (!last) return undefined;
    if (this.filled !== buffer.length) throw new FramingError("fewer bytes than announced");
    const message = { payload: buffer, encrypted: this.encrypted };
    this.reset();
    return message;
  }
}
