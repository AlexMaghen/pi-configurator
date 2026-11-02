import { randomBytes } from "node:crypto";
export { bytesToBigInt, hexToBytes, bytesToHex } from "../src/bytes";

export const randomSecret = (n: number): Uint8Array => new Uint8Array(randomBytes(n));
