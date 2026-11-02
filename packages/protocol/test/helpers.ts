import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const repoRoot = join(packageRoot, "..", "..");

export const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
export const vector = <T = any>(name: string): T => readJson<T>(join(packageRoot, "test-vectors", name));
