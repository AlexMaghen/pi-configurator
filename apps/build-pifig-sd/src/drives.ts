/**
 * Finding Raspberry Pi boot drives (the FAT "bootfs" partition of a Raspberry Pi OS SD card) on
 * a Mac, a Windows PC or Linux, and reading what kind of Raspberry Pi OS is on them.
 *
 * A drive counts as a Pi boot drive when it has config.txt, cmdline.txt and at least one
 * Broadcom device tree (bcm27*.dtb), which every Raspberry Pi OS image puts there. Everything
 * else (64-bit or not, cloud-init or not, the release date) only decides whether it's usable.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { join } from "node:path";

export interface BootDrive {
  /** Where the drive is mounted: /Volumes/bootfs, E:\, /media/me/bootfs. */
  path: string;
  /** The volume's name as the computer shows it (usually "bootfs"). */
  label: string;
  /** The image's release date from issue.txt ("2025-11-24"), when there is one. */
  release?: string;
  /** "arm64" for 64-bit Raspberry Pi OS, "armhf" for 32-bit. */
  arch: "arm64" | "armhf" | "unknown";
  /** cloud-init's files are there (Raspberry Pi OS from 24 November 2025 on). */
  cloudInit: boolean;
  /** pi-configurator files from an earlier run are already on it. */
  alreadySetUp: boolean;
  freeBytes?: number;
  /** Why it can't be used; empty when it can. */
  problems: string[];
}

/** Room the bundle and its config need on the boot partition, with some to spare. */
export const NEEDED_BYTES = 30 * 1024 * 1024;

/** Folders that may hold mounted drives, by platform. */
export function candidatePaths(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    return "DEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`).filter((p) => existsSync(p));
  }
  const parents = platform === "darwin" ? ["/Volumes"] : ["/media", "/run/media", "/mnt"];
  const found: string[] = [];
  for (const parent of parents) {
    for (const entry of safeList(parent)) {
      const path = join(parent, entry);
      // Linux mounts under /media/<user>/<label>; the Mac's /Volumes also has a link to "/".
      if (isLink(path)) continue;
      found.push(path);
      if (platform !== "darwin") found.push(...safeList(path).map((e) => join(path, e)));
    }
  }
  return found;
}

export function isBootDrive(path: string): boolean {
  const files = safeList(path);
  return (
    files.includes("config.txt") &&
    files.includes("cmdline.txt") &&
    files.some((f) => /^bcm27\d+.*\.dtb$/.test(f))
  );
}

/** What's on a Pi boot drive, or undefined when it isn't one. */
export function inspectDrive(path: string): BootDrive | undefined {
  if (!isBootDrive(path)) return undefined;
  const files = safeList(path);
  const label = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

  // 32-bit images carry the 32-bit kernels; 64-bit images only kernel8.img / kernel_2712.img.
  const arch = ["kernel.img", "kernel7.img", "kernel7l.img"].some((k) => files.includes(k))
    ? "armhf"
    : files.includes("kernel8.img") || files.includes("kernel_2712.img")
      ? "arm64"
      : "unknown";
  const cloudInit = files.includes("user-data") && files.includes("meta-data");
  const release = readIssueDate(join(path, "issue.txt"));
  let freeBytes: number | undefined;
  try {
    const fs = statfsSync(path);
    freeBytes = fs.bavail * fs.bsize;
  } catch {
    freeBytes = undefined;
  }

  const problems: string[] = [];
  if (arch !== "arm64") {
    problems.push("It isn't 64-bit Raspberry Pi OS. Write the 64-bit version with Raspberry Pi Imager.");
  }
  if (!cloudInit) {
    problems.push(
      "It's an older Raspberry Pi OS without cloud-init (user-data on the boot drive). Use an image from 24 November 2025 or later.",
    );
  }
  if (freeBytes !== undefined && freeBytes < NEEDED_BYTES) {
    problems.push(`It has only ${formatBytes(freeBytes)} free; ${formatBytes(NEEDED_BYTES)} is needed.`);
  }
  return {
    path,
    label,
    ...(release ? { release } : {}),
    arch,
    cloudInit,
    alreadySetUp: files.includes("pi-configurator"),
    ...(freeBytes !== undefined ? { freeBytes } : {}),
    problems,
  };
}

export function findBootDrives(paths: string[] = candidatePaths()): BootDrive[] {
  return paths.map(inspectDrive).filter((d): d is BootDrive => d !== undefined);
}

/** "Raspberry Pi reference 2025-11-24" -> "2025-11-24". */
function readIssueDate(file: string): string | undefined {
  try {
    return /(\d{4}-\d{2}-\d{2})/.exec(readFileSync(file, "utf8"))?.[1];
  } catch {
    return undefined;
  }
}

export function formatBytes(n: number): string {
  const mb = n / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb).toLocaleString("en-US")} MB`;
}

function safeList(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return true;
  }
}
