import { createDecipheriv, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Channel, SessionError, deriveKey, phoneSession, piSession } from "../src/session";
import { fromUtf8, hexToBytes, utf8 } from "../src/bytes";
import { vector } from "./helpers";

const vectors = vector("session.json");

describe("session keys and sealing", () => {
  const K = hexToBytes(vectors.K);

  it("derives the same keys as Node's HKDF", () => {
    for (const dir of [vectors.keys.phoneToPi, vectors.keys.piToPhone]) {
      const node = new Uint8Array(hkdfSync("sha256", K, new Uint8Array(0), dir.info, 32));
      expect(deriveKey(K, dir.info)).toEqual(node);
      expect(Buffer.from(node).toString("hex")).toBe(dir.key);
    }
  });

  it("produces messages Node's AES-GCM can open", () => {
    const key = hexToBytes(vectors.keys.phoneToPi.key);
    for (const m of vectors.phoneToPi) {
      const sealed = hexToBytes(m.sealed);
      const nonce = new Uint8Array(12);
      new DataView(nonce.buffer).setBigUint64(4, BigInt(m.counter));
      const d = createDecipheriv("aes-256-gcm", key, nonce);
      d.setAAD(utf8("pi-configurator/1"));
      d.setAuthTag(sealed.subarray(sealed.length - 16));
      const plain = Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
      expect(plain.toString("utf8")).toBe(m.plaintext);
    }
  });

  it("round-trips both directions in order", () => {
    const phone = phoneSession(K);
    const pi = piSession(K);
    for (const text of ["one", "two", "three"]) {
      expect(fromUtf8(pi.receive.open(phone.send.seal(utf8(text))))).toBe(text);
      expect(fromUtf8(phone.receive.open(pi.send.seal(utf8(text))))).toBe(text);
    }
  });

  it("refuses a replayed or skipped message", () => {
    const phone = phoneSession(K);
    const pi = piSession(K);
    const first = phone.send.seal(utf8("a"));
    const second = phone.send.seal(utf8("b"));
    expect(() => pi.receive.open(second)).toThrow(SessionError);
    const fresh = new Channel(deriveKey(K, vectors.keys.phoneToPi.info));
    fresh.open(first);
    expect(() => fresh.open(first)).toThrow(SessionError);
  });
});
