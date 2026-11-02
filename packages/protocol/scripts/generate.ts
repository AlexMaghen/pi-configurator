/**
 * Writes everything derived from the TypeScript source of truth:
 *   json-schema/config.schema.json   for editors and the Python model generator
 *   json-schema/rpc.schema.json      every RPC method's params and result, plus envelopes
 *   test-vectors/srp.json            deterministic SRP-6a run in the 3072-bit SHA-512 group
 *   test-vectors/session.json        HKDF keys and AES-GCM messages from that session key
 *   test-vectors/framing.json        frames for a few messages and frame sizes
 *
 * Run with `pnpm generate`. `test/generated.test.ts` fails when the committed files are stale.
 * Hand-written vectors (config cases, value cases) also live in test-vectors/ and are not touched.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGenerated } from "../src/generated";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const [path, content] of Object.entries(buildGenerated())) {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  console.log(`wrote ${path}`);
}
