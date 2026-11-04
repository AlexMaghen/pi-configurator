/**
 * The files that go onto the boot drive, built by scripts/build-bundle.sh into bundle/ and
 * embedded into the compiled build-pifig-sd program (Bun's `with { type: "file" }` imports), so
 * the program needs nothing else, including no internet. Under `bun src/main.ts` they're read
 * from bundle/ directly.
 */
import venv from "../bundle/venv.tar.gz" with { type: "file" };
import pythonVersion from "../bundle/python-version" with { type: "file" };
import firstboot from "../bundle/firstboot.sh" with { type: "file" };
import install from "../bundle/deploy/install.sh" with { type: "file" };
import unit from "../bundle/deploy/pi-configurator.service" with { type: "file" };
import dbusPolicy from "../bundle/deploy/org.piconfigurator.conf" with { type: "file" };
import template from "../bundle/config-template" with { type: "file" };
import type { BundleFile } from "./install";

const read = (path: string) => async () => new Uint8Array(await Bun.file(path).arrayBuffer());

/** Everything except config.json, which is written per device. */
export const bundleFiles: BundleFile[] = [
  { path: "venv.tar.gz", read: read(venv) },
  { path: "python-version", read: read(pythonVersion) },
  { path: "firstboot.sh", read: read(firstboot) },
  { path: "deploy/install.sh", read: read(install) },
  { path: "deploy/pi-configurator.service", read: read(unit) },
  { path: "deploy/org.piconfigurator.conf", read: read(dbusPolicy) },
];

export const readTemplate = (): Promise<string> => Bun.file(template).text();
