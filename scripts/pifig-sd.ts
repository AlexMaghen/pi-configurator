/**
 * pifig-sd: one command to set up pi-configurator on a freshly written SD card, from this repo,
 * on this Mac. Run it through pifig-sd.sh next to this file, from any folder:
 *
 *   pifig-sd.sh [--config-file PATH]
 *
 * 1. Rebuilds what goes onto the card, but only what changed since the last build:
 *    - the bundle (the Pi's Python environment, installer, first-boot script, config template;
 *      needs Docker, which it starts; a few minutes) when the Pi-side code changed;
 *    - the compiled build-pifig-sd programs (under a minute) when the bundle or the SD tool's own
 *      code changed.
 *    "Changed" means the files' contents, committed or not: each build leaves a fingerprint of
 *    its inputs (`.inputs-sha256`) in bundle/ and dist/, and a build made by hand has none, so
 *    the next run here rebuilds it once.
 * 2. Runs build-pifig-sd for this Mac (Apple silicon or Intel) with --config-file, if given, as a
 *    full path. It finds the card, asks before changing it and asks for the name and password.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const APP = join(ROOT, "apps/build-pifig-sd");
const BUNDLE = join(APP, "bundle");
const DIST = join(APP, "dist");
const STAMP = ".inputs-sha256";

/** What build-bundle.sh puts into the bundle (repo-relative files or folders). */
const BUNDLE_INPUTS = [
  "python/service",
  "python/client",
  "deploy/install.sh",
  "deploy/pi-configurator.service",
  "deploy/org.piconfigurator.conf",
  "apps/build-pifig-sd/pi/firstboot.sh",
  "config-template/config.json",
  "apps/build-pifig-sd/scripts/build-bundle.sh",
];

/** What compile.sh builds the programs from, besides the bundle. */
const PROGRAM_INPUTS = [
  "apps/build-pifig-sd/src",
  "apps/build-pifig-sd/package.json",
  "apps/build-pifig-sd/scripts/compile.sh",
  "packages/protocol/src",
  "packages/protocol/package.json",
];

const USAGE = `pifig-sd.sh [--config-file PATH]

Sets up pi-configurator on the freshly written Raspberry Pi OS SD card in this Mac, rebuilding
the setup program first if the code it carries has changed. Without --config-file the card gets
the built-in template (config-template/config.json).`;

function fail(message: string): never {
  console.error(`pifig-sd: ${message}`);
  process.exit(1);
}

function parseArgs(args: string[]): { configFile?: string } {
  let configFile: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else if (arg === "--config-file" || arg.startsWith("--config-file=")) {
      const value = arg === "--config-file" ? args[++i] : arg.slice("--config-file=".length);
      if (!value) fail("--config-file needs a path");
      if (configFile !== undefined) fail("--config-file given twice");
      configFile = value;
    } else {
      fail(`unknown option ${arg}; the only option is --config-file PATH\n\n${USAGE}`);
    }
  }
  if (configFile === undefined) return {};
  // Relative to the folder the command was run in; "~/..." in quotes isn't expanded by the shell.
  const path = resolve(configFile.replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
  if (!existsSync(path)) fail(`config file not found: ${path}`);
  return { configFile: path };
}

/** sha256 over the paths and contents of the files under `inputs`, tracked or new, not ignored. */
function fingerprint(inputs: string[], extra = ""): string {
  const listed = spawnSync("git", ["-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...inputs], {
    encoding: "utf8",
  });
  if (listed.status !== 0) fail(`couldn't list the source files: ${listed.stderr.trim()}`);
  const files = [...new Set(listed.stdout.split("\0").filter(Boolean))].sort();
  const hash = createHash("sha256").update(extra);
  for (const file of files) {
    const full = join(ROOT, file);
    if (!existsSync(full)) continue; // deleted but not yet committed
    hash.update(`\0${file}\0`).update(readFileSync(full));
  }
  return hash.digest("hex");
}

function stampOf(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, STAMP), "utf8").trim();
  } catch {
    return undefined;
  }
}

function run(script: string): void {
  const result = spawnSync("bash", [script], { stdio: "inherit" });
  if (result.status !== 0) fail(`${script} failed`);
}

const { configFile } = parseArgs(process.argv.slice(2));

const bundlePrint = fingerprint(BUNDLE_INPUTS);
if (stampOf(BUNDLE) !== bundlePrint || !existsSync(join(BUNDLE, "venv.tar.gz"))) {
  console.log("The Pi-side code changed since the last bundle: rebuilding it (Docker, a few minutes)...");
  run(join(APP, "scripts/build-bundle.sh"));
  writeFileSync(join(BUNDLE, STAMP), `${bundlePrint}\n`);
}

const program = join(DIST, process.arch === "arm64" ? "build-pifig-sd-macos-arm64" : "build-pifig-sd-macos-x64");
const programPrint = fingerprint(PROGRAM_INPUTS, bundlePrint);
if (stampOf(DIST) !== programPrint || !existsSync(program)) {
  console.log("Rebuilding the build-pifig-sd programs...");
  run(join(APP, "scripts/compile.sh"));
  writeFileSync(join(DIST, STAMP), `${programPrint}\n`);
}

console.log("");
const result = spawnSync(program, configFile ? ["--config-file", configFile] : [], { stdio: "inherit" });
process.exit(result.status ?? 1);
