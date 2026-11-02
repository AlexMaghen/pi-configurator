import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBootDrives, inspectDrive, isBootDrive } from "../src/drives";
import { fakeDrive } from "./support";

describe("boot drives", () => {
  it("recognises a fresh 64-bit Raspberry Pi OS card with cloud-init", () => {
    const drive = inspectDrive(fakeDrive())!;
    expect(drive.label).toBe("bootfs");
    expect(drive.release).toBe("2025-11-24");
    expect(drive.arch).toBe("arm64");
    expect(drive.cloudInit).toBe(true);
    expect(drive.alreadySetUp).toBe(false);
    expect(drive.problems).toEqual([]);
  });

  it("ignores drives that aren't Pi boot drives", () => {
    const drive = fakeDrive("USB STICK");
    rmSync(join(drive, "cmdline.txt"));
    expect(isBootDrive(drive)).toBe(false);
    expect(inspectDrive(drive)).toBeUndefined();
    const noTrees = fakeDrive();
    for (const f of ["bcm2711-rpi-4-b.dtb", "bcm2712-rpi-5-b.dtb"]) rmSync(join(noTrees, f));
    expect(isBootDrive(noTrees)).toBe(false);
  });

  it("refuses 32-bit images", () => {
    const drive = inspectDrive(fakeDrive("bootfs", { "kernel7l.img": "" }))!;
    expect(drive.arch).toBe("armhf");
    expect(drive.problems.join(" ")).toMatch(/64-bit/);
  });

  it("refuses images without cloud-init", () => {
    const path = fakeDrive();
    rmSync(join(path, "user-data"));
    rmSync(join(path, "meta-data"));
    const drive = inspectDrive(path)!;
    expect(drive.cloudInit).toBe(false);
    expect(drive.problems.join(" ")).toMatch(/24 November 2025/);
  });

  it("notices an earlier setup", () => {
    const path = fakeDrive();
    writeFileSync(join(path, "pi-configurator"), "");
    expect(inspectDrive(path)!.alreadySetUp).toBe(true);
  });

  it("lists only the boot drives among the candidates", () => {
    const pi = fakeDrive();
    const other = fakeDrive("Backup");
    rmSync(join(other, "config.txt"));
    expect(findBootDrives([pi, other, "/does/not/exist"]).map((d) => d.path)).toEqual([pi]);
  });
});
