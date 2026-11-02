/**
 * The encrypted session that follows a successful SRP handshake.
 *
 *   phone->pi key = HKDF-SHA256(ikm = K, salt = empty, info = "pi-configurator/1 phone->pi", 32)
 *   pi->phone key = HKDF-SHA256(ikm = K, salt = empty, info = "pi-configurator/1 pi->phone", 32)
 *
 * Each message is sealed with AES-256-GCM. The 12-byte nonce is 4 zero bytes followed by a
 * 64-bit big-endian counter that starts at 0 and goes up by one per message in that direction.
 * The counter is not sent: BLE writes-with-response and notifications arrive in order, so both
 * sides track it, and a dropped, repeated or reordered message fails to decrypt. That failure
 * ends the session. The additional data is the ASCII string "pi-configurator/1".
 *
 * Sealed message = ciphertext | 16-byte tag.
 */
import { gcm } from "@noble/ciphers/aes.js";
import { hkdf, sha256 } from "./hash";
import { utf8 } from "./bytes";

export const SESSION_AAD = utf8("pi-configurator/1");
export const INFO_PHONE_TO_PI = "pi-configurator/1 phone->pi";
export const INFO_PI_TO_PHONE = "pi-configurator/1 pi->phone";

export class SessionError extends Error {}

export function deriveKey(sessionKey: Uint8Array, info: string): Uint8Array {
  return hkdf(sha256, sessionKey, new Uint8Array(0), utf8(info), 32);
}

export function nonceFor(counter: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setBigUint64(4, counter, false);
  return nonce;
}

/** One direction of a session: either sealing (sender) or opening (receiver). */
export class Channel {
  private counter = 0n;
  constructor(private readonly key: Uint8Array) {}

  seal(plaintext: Uint8Array): Uint8Array {
    const sealed = gcm(this.key, nonceFor(this.counter), SESSION_AAD).encrypt(plaintext);
    this.counter++;
    return sealed;
  }

  open(sealed: Uint8Array): Uint8Array {
    try {
      const plain = gcm(this.key, nonceFor(this.counter), SESSION_AAD).decrypt(sealed);
      this.counter++;
      return plain;
    } catch {
      throw new SessionError("message failed to decrypt; the session must be restarted");
    }
  }
}

/** Both directions from the phone's point of view. */
export function phoneSession(sessionKey: Uint8Array): { send: Channel; receive: Channel } {
  return {
    send: new Channel(deriveKey(sessionKey, INFO_PHONE_TO_PI)),
    receive: new Channel(deriveKey(sessionKey, INFO_PI_TO_PHONE)),
  };
}

/** Both directions from the Pi's point of view (used by tests and vectors). */
export function piSession(sessionKey: Uint8Array): { send: Channel; receive: Channel } {
  return {
    send: new Channel(deriveKey(sessionKey, INFO_PI_TO_PHONE)),
    receive: new Channel(deriveKey(sessionKey, INFO_PHONE_TO_PI)),
  };
}
