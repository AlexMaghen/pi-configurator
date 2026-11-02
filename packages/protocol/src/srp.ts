/**
 * SRP-6a password check (RFC 5054 math), used to unlock a session without sending the password.
 *
 * pi-configurator uses the RFC 5054 3072-bit group with SHA-512. RFC 5054 defines the verifier
 * and premaster secret; it leaves the session key and proofs to TLS, so this file fixes them:
 *
 *   x  = H(s | H(I | ":" | P))          v = g^x mod N
 *   k  = H(N | PAD(g))                  u = H(PAD(A) | PAD(B))
 *   A  = g^a mod N                      B = (k*v + g^b) mod N
 *   S  = (B - k*g^x)^(a + u*x) mod N    (phone)
 *   S  = (A * v^u)^b mod N              (Pi)
 *   K  = H(PAD(S))
 *   M1 = H(H(N) XOR H(PAD(g)) | H(I) | s | PAD(A) | PAD(B) | K)
 *   M2 = H(PAD(A) | M1 | K)
 *
 * `|` is byte concatenation, numbers are big-endian, PAD() left-pads to the length of N, and
 * I is the fixed identity "pi-configurator". The Python service implements the same steps and is
 * tested against `test-vectors/srp.json`.
 */
import { sha1, sha512 } from "./hash";
import { bytesToBigInt, bigIntToBytes, concatBytes, utf8 } from "./bytes";

export interface SrpGroup {
  N: bigint;
  g: bigint;
  hash: (data: Uint8Array) => Uint8Array;
}

const hexToBigInt = (hex: string): bigint => BigInt("0x" + hex.replace(/\s+/g, ""));

/** RFC 5054 Appendix A.1, with SHA-1. Only used to check against the RFC's own test vectors. */
export const GROUP_1024_SHA1: SrpGroup = {
  N: hexToBigInt(`
    EEAF0AB9 ADB38DD6 9C33F80A FA8FC5E8 60726187 75FF3C0B 9EA2314C
    9C256576 D674DF74 96EA81D3 383B4813 D692C6E0 E0D5D8E2 50B98BE4
    8E495C1D 6089DAD1 5DC7D7B4 6154D6B6 CE8EF4AD 69B15D49 82559B29
    7BCF1885 C529F566 660E57EC 68EDBC3C 05726CC0 2FD4CBF4 976EAA9A
    FD5138FE 8376435B 9FC61D2F C0EB06E3`),
  g: 2n,
  hash: sha1,
};

/** RFC 5054 Appendix A.4 with SHA-512: the group pi-configurator uses. */
export const GROUP_3072_SHA512: SrpGroup = {
  N: hexToBigInt(`
    FFFFFFFF FFFFFFFF C90FDAA2 2168C234 C4C6628B 80DC1CD1 29024E08
    8A67CC74 020BBEA6 3B139B22 514A0879 8E3404DD EF9519B3 CD3A431B
    302B0A6D F25F1437 4FE1356D 6D51C245 E485B576 625E7EC6 F44C42E9
    A637ED6B 0BFF5CB6 F406B7ED EE386BFB 5A899FA5 AE9F2411 7C4B1FE6
    49286651 ECE45B3D C2007CB8 A163BF05 98DA4836 1C55D39A 69163FA8
    FD24CF5F 83655D23 DCA3AD96 1C62F356 208552BB 9ED52907 7096966D
    670C354E 4ABC9804 F1746C08 CA18217C 32905E46 2E36CE3B E39E772C
    180E8603 9B2783A2 EC07A28F B5C55DF0 6F4C52C9 DE2BCBF6 95581718
    3995497C EA956AE5 15D22618 98FA0510 15728E5A 8AAAC42D AD33170D
    04507A33 A85521AB DF1CBA64 ECFB8504 58DBEF0A 8AEA7157 5D060C7D
    B3970F85 A6E1E4C7 ABF5AE8C DB0933D7 1E8C94E0 4A25619D CEE3D226
    1AD2EE6B F12FFA06 D98A0864 D8760273 3EC86A64 521F2B18 177B200C
    BBE11757 7A615D6C 770988C0 BAD946E2 08E24FA0 74E5AB31 43DB5BFC
    E0FD108E 4B82D120 A93AD2CA FFFFFFFF FFFFFFFF`),
  g: 5n,
  hash: sha512,
};

/** The SRP identity. There is one password per device, so the user name is fixed. */
export const SRP_IDENTITY = "pi-configurator";

export class SrpError extends Error {}

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

const nLength = (group: SrpGroup) => Math.ceil(group.N.toString(16).length / 2);
const pad = (group: SrpGroup, n: bigint) => bigIntToBytes(n, nLength(group));
const H = (group: SrpGroup, ...parts: Uint8Array[]) => group.hash(concatBytes(...parts));
const Hn = (group: SrpGroup, ...parts: Uint8Array[]) => bytesToBigInt(H(group, ...parts));

export function computeK(group: SrpGroup): bigint {
  return Hn(group, bigIntToBytes(group.N), pad(group, group.g));
}

export function computeX(group: SrpGroup, identity: string, password: string, salt: Uint8Array): bigint {
  return Hn(group, salt, H(group, utf8(`${identity}:${password}`)));
}

export function computeVerifier(group: SrpGroup, identity: string, password: string, salt: Uint8Array): bigint {
  return modPow(group.g, computeX(group, identity, password, salt), group.N);
}

export function computeU(group: SrpGroup, A: bigint, B: bigint): bigint {
  return Hn(group, pad(group, A), pad(group, B));
}

export function computeA(group: SrpGroup, a: bigint): bigint {
  return modPow(group.g, a, group.N);
}

export function computeB(group: SrpGroup, b: bigint, v: bigint): bigint {
  return (computeK(group) * v + modPow(group.g, b, group.N)) % group.N;
}

/** Premaster secret on the phone (client) side. */
export function clientS(group: SrpGroup, B: bigint, a: bigint, x: bigint, u: bigint): bigint {
  const { N, g } = group;
  const k = computeK(group);
  const base = (((B - k * modPow(g, x, N)) % N) + N) % N;
  return modPow(base, a + u * x, N);
}

/** Premaster secret on the Pi (server) side. */
export function serverS(group: SrpGroup, A: bigint, v: bigint, u: bigint, b: bigint): bigint {
  const { N } = group;
  return modPow((A * modPow(v, u, N)) % N, b, N);
}

export function computeSessionKey(group: SrpGroup, S: bigint): Uint8Array {
  return H(group, pad(group, S));
}

export function computeM1(
  group: SrpGroup,
  identity: string,
  salt: Uint8Array,
  A: bigint,
  B: bigint,
  K: Uint8Array,
): Uint8Array {
  const hN = H(group, bigIntToBytes(group.N));
  const hg = H(group, pad(group, group.g));
  const xor = hN.map((byte, i) => byte ^ (hg[i] ?? 0));
  return H(group, xor, H(group, utf8(identity)), salt, pad(group, A), pad(group, B), K);
}

export function computeM2(group: SrpGroup, A: bigint, M1: Uint8Array, K: Uint8Array): Uint8Array {
  return H(group, pad(group, A), M1, K);
}

/** Constant-time comparison of two proofs. */
export function proofsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * The phone's side of the handshake.
 *
 *   const client = new SrpClient(password, randomBytes(32));
 *   send auth.start { A: client.A }
 *   const M1 = client.respond(salt, B)    -> send auth.finish { M1 }
 *   client.verifyServer(M2)               -> throws if the Pi didn't prove the password
 *   client.sessionKey                     -> feed into session.ts
 */
export class SrpClient {
  readonly A: Uint8Array;
  private readonly a: bigint;
  private readonly Abig: bigint;
  private K?: Uint8Array;
  private M1?: Uint8Array;

  constructor(
    private readonly password: string,
    secret: Uint8Array,
    private readonly group: SrpGroup = GROUP_3072_SHA512,
    private readonly identity: string = SRP_IDENTITY,
  ) {
    if (secret.length < 32) throw new SrpError("client secret must be at least 32 bytes");
    this.a = bytesToBigInt(secret);
    this.Abig = computeA(group, this.a);
    this.A = pad(group, this.Abig);
  }

  respond(salt: Uint8Array, Bbytes: Uint8Array): Uint8Array {
    const { group } = this;
    const B = bytesToBigInt(Bbytes);
    if (B % group.N === 0n) throw new SrpError("server sent an invalid B");
    const u = computeU(group, this.Abig, B);
    if (u === 0n) throw new SrpError("u is zero");
    const x = computeX(group, this.identity, this.password, salt);
    this.K = computeSessionKey(group, clientS(group, B, this.a, x, u));
    this.M1 = computeM1(group, this.identity, salt, this.Abig, B, this.K);
    return this.M1;
  }

  verifyServer(M2: Uint8Array): void {
    if (!this.K || !this.M1) throw new SrpError("respond() must be called first");
    if (!proofsEqual(M2, computeM2(this.group, this.Abig, this.M1, this.K))) {
      throw new SrpError("the device did not prove it knows the password");
    }
  }

  get sessionKey(): Uint8Array {
    if (!this.K) throw new SrpError("respond() must be called first");
    return this.K;
  }
}

/**
 * The Pi's side. Lives in TypeScript for tests and the vector generator; the real service has
 * its own Python copy.
 */
export class SrpServer {
  readonly B: Uint8Array;
  private readonly Bbig: bigint;
  private readonly b: bigint;

  constructor(
    private readonly salt: Uint8Array,
    private readonly verifier: bigint,
    secret: Uint8Array,
    private readonly group: SrpGroup = GROUP_3072_SHA512,
    private readonly identity: string = SRP_IDENTITY,
  ) {
    if (secret.length < 32) throw new SrpError("server secret must be at least 32 bytes");
    this.b = bytesToBigInt(secret);
    this.Bbig = computeB(group, this.b, verifier);
    this.B = pad(group, this.Bbig);
  }

  /** Checks the phone's proof. Returns the session key and M2, or throws on a wrong password. */
  verify(Abytes: Uint8Array, M1: Uint8Array): { sessionKey: Uint8Array; M2: Uint8Array } {
    const { group } = this;
    const A = bytesToBigInt(Abytes);
    if (A % group.N === 0n) throw new SrpError("client sent an invalid A");
    const u = computeU(group, A, this.Bbig);
    const K = computeSessionKey(group, serverS(group, A, this.verifier, u, this.b));
    const expected = computeM1(group, this.identity, this.salt, A, this.Bbig, K);
    if (!proofsEqual(M1, expected)) throw new SrpError("wrong password");
    return { sessionKey: K, M2: computeM2(group, A, M1, K) };
  }
}
