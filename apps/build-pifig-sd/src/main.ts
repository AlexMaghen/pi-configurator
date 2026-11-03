/**
 * build-pifig-sd: sets up pi-configurator on a freshly written Raspberry Pi OS SD card, from a
 * Mac or a Windows PC, so the Pi installs it by itself on first boot with no network.
 *
 *   build-pifig-sd [--drive PATH] [--config-file PATH]
 *
 * Finds the card's boot drive (or uses --drive), shows it and asks before changing anything,
 * asks for the Device Name and pifig Access Password, then copies the prebuilt bundle, the
 * device's config and a first-boot step (cloud-init runcmd) onto it. The config starts from the
 * built-in template, or from --config-file; with a file, Enter keeps its name and password.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { bundleFiles, readTemplate } from "./bundle";
import { checkConfigText, nameProblem, passwordProblem, personalize, type ConfigSummary } from "./config";
import { findBootDrives, formatBytes, inspectDrive, type BootDrive } from "./drives";
import { installOnDrive } from "./install";
import { ask, askHidden, confirm } from "./prompts";

const VERSION = "0.1.0";

const HELP = `build-pifig-sd ${VERSION}

Sets up pi-configurator on a Raspberry Pi OS SD card so the Pi installs it on first boot,
without internet. Write 64-bit Raspberry Pi OS (from 24 November 2025 or later) with Raspberry
Pi Imager first, keep the card in this computer, then run:

  build-pifig-sd                       find the card's boot drive and ask before using it
  build-pifig-sd --drive PATH          use this boot drive (e.g. /Volumes/bootfs or E:\\)
  build-pifig-sd --config-file PATH    use this config file instead of the built-in template;
                                       Enter keeps the name and password it sets
`;

function describe(drive: BootDrive): string {
  const parts = [
    drive.release ? `Raspberry Pi OS from ${drive.release}` : "Raspberry Pi OS (release date unknown)",
    drive.arch === "arm64" ? "64-bit" : drive.arch === "armhf" ? "32-bit" : "unknown type",
    drive.cloudInit ? "first-boot setup (cloud-init) available" : "no cloud-init",
  ];
  if (drive.freeBytes !== undefined) parts.push(`${formatBytes(drive.freeBytes)} free`);
  return `  ${drive.label}  (${drive.path})\n  ${parts.join(" · ")}`;
}

async function chooseDrive(drivePath: string | undefined): Promise<BootDrive> {
  if (drivePath) {
    const drive = inspectDrive(drivePath);
    if (!drive) throw new Error(`${drivePath} doesn't look like a Raspberry Pi boot drive (no config.txt, cmdline.txt and device trees).`);
    return drive;
  }
  console.log("Looking for a Raspberry Pi boot drive...");
  const drives = findBootDrives();
  if (drives.length === 0) {
    throw new Error(
      "No Raspberry Pi boot drive found. Write Raspberry Pi OS to the card with Raspberry Pi Imager, leave it in this computer (the drive is usually called \"bootfs\"), and run this again.",
    );
  }
  if (drives.length === 1) return drives[0]!;
  console.log("\nFound these Raspberry Pi boot drives:");
  drives.forEach((d, i) => console.log(`\n${i + 1}.${describe(d).slice(1)}`));
  for (;;) {
    const pick = Number((await ask(`\nWhich one? (1-${drives.length}) `)).trim());
    const drive = drives[pick - 1];
    if (Number.isInteger(pick) && drive) return drive;
  }
}

/** Asks for the name; with a default (from --config-file), Enter keeps it. */
async function askName(current?: string): Promise<string> {
  for (;;) {
    const typed = (await ask(current ? `Device Name [${current}]: ` : "Device Name: ")).trim();
    const name = typed || current || "";
    const problem = nameProblem(name);
    if (!problem) return name;
    console.log(`  ${problem}`);
  }
}

/** Asks for the password, twice; with `keepable` (from --config-file), Enter keeps the file's. */
async function askPassword(keepable: boolean): Promise<string | undefined> {
  const question = keepable ? "pifig Access Password [enter to keep the file's]: " : "pifig Access Password: ";
  for (;;) {
    const password = await askHidden(question);
    if (keepable && password === "") return undefined;
    const problem = passwordProblem(password);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    if ((await askHidden("Type it again: ")) === password) return password;
    console.log("  The two didn't match. Try again.");
  }
}

/** The value after a flag, as `--flag value` or `--flag=value`; undefined when the flag is absent. */
function option(argv: string[], flag: string): string | undefined {
  const joined = argv.find((a) => a.startsWith(`${flag}=`));
  if (joined) return joined.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  if (at < 0) return undefined;
  const value = argv[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} needs a path`);
  return value;
}

/**
 * The config to start from: the user's file or the built-in template. Either is checked against
 * the Pi's rules now, before the card is touched, so a broken config never reaches a Pi.
 */
async function loadConfig(configPath: string | undefined): Promise<{ text: string; summary: ConfigSummary }> {
  if (!configPath) {
    const text = await readTemplate();
    return { text, summary: checkConfigText(text, "The built-in config template") };
  }
  let text: string;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const why = code === "ENOENT" ? "there's no such file" : code === "EISDIR" ? "it's a folder" : String(err);
    throw new Error(`Couldn't read the config file ${configPath}: ${why}.`);
  }
  return { text, summary: checkConfigText(text, configPath) };
}

function eject(drive: BootDrive): void {
  if (process.platform === "darwin") {
    const result = spawnSync("diskutil", ["eject", drive.path], { stdio: "inherit" });
    if (result.status === 0) return;
  }
  console.log(`Eject "${drive.label}" before removing the card${process.platform === "win32" ? " (Safely Remove Hardware)" : ""}.`);
}

async function main(argv: string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(HELP);
    return 0;
  }
  if (argv.includes("--version")) {
    console.log(VERSION);
    return 0;
  }
  const drivePath = option(argv, "--drive");
  const configPath = option(argv, "--config-file");

  console.log(`build-pifig-sd ${VERSION}: set up pi-configurator on a Raspberry Pi SD card\n`);
  const start = await loadConfig(configPath);
  const custom = configPath ? start : undefined;
  const { summary } = start;
  console.log(
    `Config: ${configPath ?? "built-in template"} (checked: ${summary.settingsCount.toLocaleString("en-US")} settings, Bluetooth name "${summary.name}")\n`,
  );
  const drive = await chooseDrive(drivePath);
  console.log(`\nThis Raspberry Pi boot drive will be set up:\n${describe(drive)}\n`);
  if (drive.problems.length > 0) {
    console.log("It can't be used:");
    for (const p of drive.problems) console.log(`  - ${p}`);
    return 1;
  }
  console.log("It must be a card that hasn't been started in a Pi yet: the setup runs on the very first boot.");
  if (drive.alreadySetUp) console.log("It was set up before; that setup will be replaced.");
  if (!(await confirm("\nSet up pi-configurator on this drive?"))) {
    console.log("Nothing was changed.");
    return 1;
  }

  console.log("\nThe phone app (pifig) shows the Pi by this name and unlocks it with this password.");
  const name = await askName(custom?.summary.name);
  const password = (await askPassword(custom !== undefined)) ?? custom?.summary.password ?? "";
  const config = personalize(start.text, name, password);

  console.log("\nCopying pi-configurator onto the card...");
  await installOnDrive(drive.path, bundleFiles, config);
  console.log("Added the install to the Pi's first boot (user-data).");

  console.log(`
Done. Put the card in the Pi and switch it on. On its first boot it installs pi-configurator
(no internet needed) and starts advertising as "${name}"; the first boot takes a few minutes.
Then open pifig on your phone and unlock it with the password${custom ? "" : " you chose"}.

If it doesn't appear, put the card back in this computer: pi-configurator/result.txt on the
boot drive says what happened.
`);
  if (await confirm(`Eject "${drive.label}" now?`)) eject(drive);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
