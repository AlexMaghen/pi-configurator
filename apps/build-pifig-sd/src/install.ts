/**
 * Writing pi-configurator onto a boot drive: the bundle into pi-configurator/, the device's
 * config next to it, and finally the first-boot step in user-data. user-data goes last, so a
 * copy that stops halfway never leaves a card that tries to install from half the files.
 */
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { addFirstBootCommand } from "./userData";

/** One file of the bundle: where it goes under pi-configurator/, and its contents. */
export interface BundleFile {
  path: string;
  read: () => Promise<Uint8Array>;
}

export const FOLDER = "pi-configurator";

export async function installOnDrive(drive: string, files: BundleFile[], configText: string): Promise<void> {
  const folder = join(drive, FOLDER);
  rmSync(folder, { recursive: true, force: true });

  for (const file of files) {
    const target = join(folder, file.path);
    mkdirSync(dirname(target), { recursive: true });
    const data = await file.read();
    writeFileSync(target, data);
    if (statSync(target).size !== data.byteLength) throw new Error(`${file.path} wasn't written completely`);
  }
  writeFileSync(join(folder, "config.json"), configText);

  const userData = join(drive, "user-data");
  writeFileSync(userData, addFirstBootCommand(readFileSync(userData, "utf8")));
}
