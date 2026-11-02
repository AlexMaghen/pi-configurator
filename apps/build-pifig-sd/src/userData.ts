/**
 * Adding the first-boot step to cloud-init's user-data on the boot drive.
 *
 * user-data is YAML that must start with "#cloud-config". A fresh image's is all comments;
 * Raspberry Pi Imager replaces it with the user, Wi-Fi and SSH settings chosen there. Either
 * way this adds one `runcmd` entry and keeps everything else, comments included. Running it
 * twice adds nothing more.
 */
import { isMap, isSeq, parseDocument, YAMLSeq, type Document } from "yaml";

/** What cloud-init runs once, late in the first boot. The boot drive is /boot/firmware on the Pi. */
export const FIRST_BOOT_COMMAND = "bash /boot/firmware/pi-configurator/firstboot.sh";

const HEADER = "#cloud-config";

export function addFirstBootCommand(text: string): string {
  const doc: Document = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new Error(`user-data isn't valid YAML: ${doc.errors[0]?.message ?? "unknown error"}`);
  }
  if (doc.contents === null) doc.contents = doc.createNode({});
  if (!isMap(doc.contents)) throw new Error("user-data doesn't hold cloud-init settings (a YAML mapping)");

  let runcmd = doc.get("runcmd");
  if (runcmd === undefined || runcmd === null) {
    runcmd = new YAMLSeq();
    doc.set("runcmd", runcmd);
  }
  if (!isSeq(runcmd)) throw new Error("user-data's runcmd isn't a list");
  const present = runcmd.items.some((item) => String(isScalarLike(item) ? item.value : item) === FIRST_BOOT_COMMAND);
  if (!present) runcmd.add(FIRST_BOOT_COMMAND);

  let out = doc.toString({ lineWidth: 0 });
  // cloud-init ignores user-data without the header on its first line.
  if (!out.startsWith(HEADER)) out = `${HEADER}\n${out}`;
  return out;
}

function isScalarLike(item: unknown): item is { value: unknown } {
  return typeof item === "object" && item !== null && "value" in item;
}
