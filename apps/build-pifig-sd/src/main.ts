/**
 * build-pifig-sd: sets up pi-configurator on a freshly written Raspberry Pi OS SD card, from a
 * Mac or a Windows PC, so the Pi installs it by itself on first boot with no network.
 *
 *   build-pifig-sd [--drive PATH]
 *
 * Finds the card's boot drive (or uses --drive), shows it and asks before changing anything,
 * asks for the Device Name and pifig Access Password, then copies the prebuilt bundle, the
 * device's config and a first-boot step (cloud-init runcmd) onto it.
 */
import { spawnSync } from "node:child_process";
import { bundleFiles, readTemplate } from "./bundle";
import { nameProblem, passwordProblem, personalize } from "./config";
import { findBootDrives, formatBytes, inspectDrive, type BootDrive } from "./drives";
import { installOnDrive } from "./install";
import { ask, askHidden, confirm } from "./prompts";

const VERSION = "0.1.0";

const HELP = `build-pifig-sd ${VERSION}

Sets up pi-configurator on a Raspberry Pi OS SD card so the Pi installs it on first boot,
without internet. Write 64-bit Raspberry Pi OS (from 24 November 2025 or later) with Raspberry
Pi Imager first, keep the card in this computer, then run:

  build-pifig-sd                find the card's boot drive and ask before using it
  build-pifig-sd --drive PATH   use this boot drive (e.g. /Volumes/bootfs or E:\\)
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

async function askName(): Promise<string> {
  for (;;) {
    const name = (await ask("Device Name: ")).trim();
    const problem = nameProblem(name);
    if (!problem) return name;
    console.log(`  ${problem}`);
  }
}

async function askPassword(): Promise<string> {
  for (;;) {
    const password = await askHidden("pifig Access Password: ");
    const problem = passwordProblem(password);
    if (problem) {
      console.log(`  ${problem}`);
      continue;
    }
    if ((await askHidden("Type it again: ")) === password) return password;
    console.log("  The two didn't match. Try again.");
  }
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
  const driveAt = argv.indexOf("--drive");
  const drivePath = driveAt >= 0 ? argv[driveAt + 1] : undefined;
  if (driveAt >= 0 && !drivePath) throw new Error("--drive needs a path");

  console.log(`build-pifig-sd ${VERSION}: set up pi-configurator on a Raspberry Pi SD card\n`);
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
  const name = await askName();
  const password = await askPassword();
  const config = personalize(await readTemplate(), name, password);

  console.log("\nCopying pi-configurator onto the card...");
  await installOnDrive(drive.path, bundleFiles, config);
  console.log("Added the install to the Pi's first boot (user-data).");

  console.log(`
Done. Put the card in the Pi and switch it on. On its first boot it installs pi-configurator
(no internet needed) and starts advertising as "${name}"; the first boot takes a few minutes.
Then open pifig on your phone and unlock it with the password you chose.

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
