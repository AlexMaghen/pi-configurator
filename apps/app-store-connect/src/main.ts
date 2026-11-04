/**
 * app-store-connect: what an app's App Store Connect record has, and what a submission still
 * needs, compared with the listing in the repository.
 *
 *   bun src/main.ts status [--bundle-id com.alexmaghen.pifig] [--store-dir ../../store] [--json]
 *
 * Read-only: it changes nothing in App Store Connect. The API key comes from ASC_KEY_ID,
 * ASC_ISSUER_ID and ASC_KEY_PATH (see client.ts).
 */
import { resolve } from "node:path";
import { checklist, formatReport } from "./checklist";
import { AppStoreConnect, keyFromEnv } from "./client";
import { readListing } from "./local";
import { readSnapshot } from "./snapshot";

const DEFAULT_BUNDLE_ID = "com.alexmaghen.pifig";
const DEFAULT_STORE_DIR = resolve(import.meta.dir, "../../../store");

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

async function main(args: string[]): Promise<number> {
  const [command] = args;
  if (command !== "status") {
    console.error("usage: app-store-connect status [--bundle-id ID] [--store-dir DIR] [--json]");
    return 2;
  }
  const bundleId = option(args, "--bundle-id") ?? DEFAULT_BUNDLE_ID;
  const storeDir = resolve(option(args, "--store-dir") ?? DEFAULT_STORE_DIR);

  const asc = new AppStoreConnect(keyFromEnv());
  const snapshot = await readSnapshot(asc, bundleId);
  const items = checklist(snapshot, readListing(storeDir));
  if (args.includes("--json")) console.log(JSON.stringify({ snapshot, items }, null, 2));
  else console.log(formatReport(items));
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`app-store-connect: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
