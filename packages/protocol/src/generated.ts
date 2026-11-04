/**
 * Builds the generated JSON files (schemas and deterministic test vectors) as strings, keyed by
 * their path inside this package. Used by `scripts/generate.ts` and by the staleness test.
 * Not exported from the package index: the app doesn't need it.
 */
import { z } from "zod";
import { ConfigShape } from "./config";
import { Methods, DeviceInfo, Request, Response, StatusEvent, PROTOCOL_VERSION } from "./rpc";
import { bigIntToBytes, bytesToHex, concatBytes, hexToBytes, toBase64, utf8 } from "./bytes";
import {
  GROUP_3072_SHA512,
  SRP_IDENTITY,
  SrpClient,
  SrpServer,
  computeA,
  computeB,
  computeK,
  computeU,
  computeVerifier,
  computeX,
} from "./srp";
import { INFO_PHONE_TO_PI, INFO_PI_TO_PHONE, deriveKey, phoneSession, piSession } from "./session";
import { frameSizeForMtu, splitMessage } from "./framing";
import { bytesToBigInt } from "./bytes";

const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

function configSchema() {
  return {
    $id: "https://github.com/AlexMaghen/pi-configurator/json-schema/config.schema.json",
    title: "pi-configurator config file",
    description:
      "Shape of /etc/pi-configurator/config.json. Cross-field rules (unique keys, defaults within limits, " +
      "reserved keys) are not expressible here; see packages/protocol/src/config.ts checkConfig().",
    ...z.toJSONSchema(ConfigShape, { io: "input", target: "draft-2020-12" }),
  };
}

function rpcSchema() {
  const methods: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(Methods)) {
    methods[name] = {
      auth: m.auth,
      params: z.toJSONSchema(m.params, { io: "input", target: "draft-2020-12" }),
      result: z.toJSONSchema(m.result, { io: "output", target: "draft-2020-12" }),
    };
  }
  return {
    title: "pi-configurator RPC",
    protocol: PROTOCOL_VERSION,
    deviceInfo: z.toJSONSchema(DeviceInfo, { target: "draft-2020-12" }),
    request: z.toJSONSchema(Request, { io: "input", target: "draft-2020-12" }),
    response: z.toJSONSchema(Response, { target: "draft-2020-12" }),
    statusEvent: z.toJSONSchema(StatusEvent, { target: "draft-2020-12" }),
    methods,
  };
}

/** Fixed inputs so both implementations can reproduce every intermediate value. */
const SRP_INPUT = {
  password: "correct horse battery staple",
  salt: hexToBytes("a1b2c3d4e5f60718293a4b5c6d7e8f90"),
  a: hexToBytes("60975527035cf2ad1989806f0407210bc81edc04e2762a56afd529ddda2d4393"),
  b: hexToBytes("e487cb59d31ac550471e81f00f6928e01dda08e974a004f49e61f5d105284d20"),
};

function srpVectors() {
  const g = GROUP_3072_SHA512;
  const { password, salt, a, b } = SRP_INPUT;
  const v = computeVerifier(g, SRP_IDENTITY, password, salt);
  const client = new SrpClient(password, a);
  const server = new SrpServer(salt, v, b);
  const M1 = client.respond(salt, server.B);
  const { sessionKey, M2 } = server.verify(client.A, M1);
  client.verifyServer(M2);
  const A = computeA(g, bytesToBigInt(a));
  const B = computeB(g, bytesToBigInt(b), v);
  const hex = (n: bigint) => bytesToHex(bigIntToBytes(n));

  const wrong = new SrpClient("wrong password", a);
  const wrongM1 = wrong.respond(salt, server.B);

  return {
    sessionKey,
    vectors: {
      description:
        "SRP-6a, RFC 5054 3072-bit group (g = 5), SHA-512, identity 'pi-configurator'. " +
        "Numbers are big-endian hex without padding; A, B, M1, M2, K are bytes.",
      identity: SRP_IDENTITY,
      password,
      salt: bytesToHex(salt),
      a: bytesToHex(a),
      b: bytesToHex(b),
      k: hex(computeK(g)),
      x: hex(computeX(g, SRP_IDENTITY, password, salt)),
      v: hex(v),
      A: hex(A),
      B: hex(B),
      u: hex(computeU(g, A, B)),
      K: bytesToHex(sessionKey),
      M1: bytesToHex(M1),
      M2: bytesToHex(M2),
      wrongPassword: "wrong password",
      wrongM1: bytesToHex(wrongM1),
      base64: { A: toBase64(client.A), B: toBase64(server.B), salt: toBase64(salt), M1: toBase64(M1), M2: toBase64(M2) },
    },
  };
}

function sessionVectors(sessionKey: Uint8Array) {
  const phone = phoneSession(sessionKey);
  const pi = piSession(sessionKey);
  const phoneMessages = [
    '{"id":3,"method":"settings.describe","params":{}}',
    '{"id":4,"method":"settings.get","params":{}}',
  ];
  const piMessages = ['{"id":3,"result":{"fields":[]}}', '{"event":"status","kind":"store.saved","message":"Saved"}'];
  return {
    description:
      "Keys are HKDF-SHA256(K, empty salt, info, 32). Messages are AES-256-GCM with nonce = 4 zero bytes | " +
      "uint64 BE counter, AAD 'pi-configurator/1', output ciphertext | tag. Counters start at 0 per direction.",
    K: bytesToHex(sessionKey),
    keys: {
      phoneToPi: { info: INFO_PHONE_TO_PI, key: bytesToHex(deriveKey(sessionKey, INFO_PHONE_TO_PI)) },
      piToPhone: { info: INFO_PI_TO_PHONE, key: bytesToHex(deriveKey(sessionKey, INFO_PI_TO_PHONE)) },
    },
    phoneToPi: phoneMessages.map((plaintext, counter) => ({
      counter,
      plaintext,
      sealed: bytesToHex(phone.send.seal(utf8(plaintext))),
    })),
    piToPhone: piMessages.map((plaintext, counter) => ({
      counter,
      plaintext,
      sealed: bytesToHex(pi.send.seal(utf8(plaintext))),
    })),
  };
}

function framingVectors() {
  const cases = [
    { name: "empty message", payload: new Uint8Array(0), encrypted: false, frameSize: 20 },
    { name: "fits one frame", payload: utf8('{"id":1,"method":"wifi.scan"}'), encrypted: false, frameSize: 182 },
    {
      name: "three frames at minimum size",
      payload: utf8('{"id":2,"method":"settings.get","params":{"keys":["a"]}}'),
      encrypted: false,
      frameSize: 20,
    },
    {
      name: "encrypted, 300 bytes, frame size 64",
      payload: concatBytes(...Array.from({ length: 300 }, (_, i) => new Uint8Array([i & 0xff]))),
      encrypted: true,
      frameSize: 64,
    },
    {
      name: "1,200 bytes at the largest frame size",
      payload: concatBytes(...Array.from({ length: 1200 }, (_, i) => new Uint8Array([(i * 7) & 0xff]))),
      encrypted: true,
      frameSize: 512,
    },
  ];
  // MTUs seen in practice: none (unknown), the BLE minimum, below it, iOS's usual 185, the
  // largest frame exactly, and an iPhone's 517 (capped at the 512-byte attribute limit).
  const mtus = [null, 23, 10, 185, 515, 517];
  return {
    description: "Frame layout in packages/protocol/src/framing.ts. Hex strings.",
    frameSizeForMtu: mtus.map((mtu) => ({ mtu, frameSize: frameSizeForMtu(mtu ?? undefined) })),
    cases: cases.map((c) => ({
      name: c.name,
      encrypted: c.encrypted,
      frameSize: c.frameSize,
      payload: bytesToHex(c.payload),
      frames: splitMessage(c.payload, c.encrypted, c.frameSize).map(bytesToHex),
    })),
  };
}

export function buildGenerated(): Record<string, string> {
  const srp = srpVectors();
  return {
    "json-schema/config.schema.json": json(configSchema()),
    "json-schema/rpc.schema.json": json(rpcSchema()),
    "test-vectors/srp.json": json(srp.vectors),
    "test-vectors/session.json": json(sessionVectors(srp.sessionKey)),
    "test-vectors/framing.json": json(framingVectors()),
  };
}
