/**
 * The listing as the repository has it: `<store>/ios/metadata/*.txt` (one value per file, the
 * layout fastlane uses) and `<store>/ios/screenshots/<set>/*.png`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const METADATA_FILES = [
  "name",
  "subtitle",
  "description",
  "keywords",
  "promotional_text",
  "whats_new",
  "support_url",
  "marketing_url",
  "privacy_url",
  "copyright",
  "primary_category",
  "secondary_category",
  "review_notes",
  "testflight_what_to_test",
] as const;
export type MetadataName = (typeof METADATA_FILES)[number];

export interface Screenshot {
  file: string;
  width: number;
  height: number;
}

export interface LocalListing {
  metadata: Partial<Record<MetadataName, string>>;
  /** Folder name (e.g. iphone-6.9) to its PNGs, in file-name order. */
  screenshots: Record<string, Screenshot[]>;
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export function readListing(storeDir: string): LocalListing {
  const metadataDir = join(storeDir, "ios", "metadata");
  const metadata: LocalListing["metadata"] = {};
  for (const name of METADATA_FILES) {
    const path = join(metadataDir, `${name}.txt`);
    if (existsSync(path)) metadata[name] = readFileSync(path, "utf8").trim();
  }

  const screenshots: LocalListing["screenshots"] = {};
  const shotsDir = join(storeDir, "ios", "screenshots");
  if (existsSync(shotsDir)) {
    for (const set of readdirSync(shotsDir).sort()) {
      const dir = join(shotsDir, set);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
      screenshots[set] = files.flatMap((file) => {
        const size = pngSize(readFileSync(join(dir, file)));
        return size ? [{ file, ...size }] : [];
      });
    }
  }
  return { metadata, screenshots };
}
