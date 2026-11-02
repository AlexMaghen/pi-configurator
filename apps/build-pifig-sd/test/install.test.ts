import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { installOnDrive, type BundleFile } from "../src/install";
import { FIRST_BOOT_COMMAND } from "../src/userData";
import { fakeDrive, IMAGER_USER_DATA } from "./support";

const text = (s: string) => async () => new TextEncoder().encode(s);
const files: BundleFile[] = [
  { path: "firstboot.sh", read: text("#!/bin/bash\n") },
  { path: "deploy/install.sh", read: text("#!/bin/bash\necho install\n") },
  { path: "venv.tar.gz", read: async () => new Uint8Array(4096).fill(7) },
];

describe("installing onto a boot drive", () => {
  it("copies the bundle and config, then adds the first-boot step", async () => {
    const drive = fakeDrive("bootfs", { "user-data": IMAGER_USER_DATA });
    await installOnDrive(drive, files, '{"x":1}\n');
    expect(readFileSync(join(drive, "pi-configurator/deploy/install.sh"), "utf8")).toContain("echo install");
    expect(readFileSync(join(drive, "pi-configurator/venv.tar.gz")).byteLength).toBe(4096);
    expect(readFileSync(join(drive, "pi-configurator/config.json"), "utf8")).toBe('{"x":1}\n');
    expect((parse(readFileSync(join(drive, "user-data"), "utf8")) as { runcmd: string[] }).runcmd).toContain(FIRST_BOOT_COMMAND);
  });

  it("replaces an earlier setup completely", async () => {
    const drive = fakeDrive();
    await installOnDrive(drive, [...files, { path: "old.txt", read: text("old") }], "{}");
    await installOnDrive(drive, files, "{}");
    expect(existsSync(join(drive, "pi-configurator/old.txt"))).toBe(false);
  });
});
