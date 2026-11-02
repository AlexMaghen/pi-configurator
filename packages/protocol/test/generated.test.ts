import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildGenerated } from "../src/generated";
import { packageRoot } from "./helpers";

describe("generated files", () => {
  it.each(Object.entries(buildGenerated()))("%s is up to date (run pnpm generate)", (path, content) => {
    expect(readFileSync(join(packageRoot, path), "utf8")).toBe(content);
  });
});
