import { describe, expect, it } from "vitest";
import { FrameAssembler, FramingError, MAX_FRAME_SIZE, frameSizeForMtu, splitMessage } from "../src/framing";
import { bytesToHex, hexToBytes } from "../src/bytes";
import { vector } from "./helpers";

describe("framing", () => {
  const { cases, frameSizeForMtu: mtus } = vector<{ cases: any[]; frameSizeForMtu: any[] }>("framing.json");

  it("sizes frames from the MTU, at most the 512-byte attribute limit", () => {
    for (const { mtu, frameSize } of mtus) expect(frameSizeForMtu(mtu ?? undefined)).toBe(frameSize);
    expect(frameSizeForMtu(517)).toBe(MAX_FRAME_SIZE);
    expect(() => splitMessage(new Uint8Array(10), false, 513)).toThrow(FramingError);
  });

  it.each(cases.map((c: any) => [c.name, c] as [string, any]))("%s splits and joins", (_name, c: any) => {
    const frames = splitMessage(hexToBytes(c.payload), c.encrypted, c.frameSize);
    expect(frames.map(bytesToHex)).toEqual(c.frames);
    for (const f of frames) expect(f.length).toBeLessThanOrEqual(c.frameSize);
    const assembler = new FrameAssembler();
    let out;
    for (const f of frames) out = assembler.push(f);
    expect(out && bytesToHex(out.payload)).toBe(c.payload);
    expect(out?.encrypted).toBe(c.encrypted);
  });

  it("rejects an out-of-order frame and recovers on the next message", () => {
    const frames = splitMessage(new Uint8Array(100), false, 20);
    const assembler = new FrameAssembler();
    assembler.push(frames[0]!);
    expect(() => assembler.push(frames[2]!)).toThrow(FramingError);
    let out;
    for (const f of frames) out = assembler.push(f);
    expect(out?.payload.length).toBe(100);
  });

  it("rejects continuation frames with no start", () => {
    const frames = splitMessage(new Uint8Array(50), false, 20);
    expect(() => new FrameAssembler().push(frames[1]!)).toThrow(FramingError);
  });

  it("rejects too-small frame sizes", () => {
    expect(() => splitMessage(new Uint8Array(1), false, 10)).toThrow(FramingError);
  });
});
