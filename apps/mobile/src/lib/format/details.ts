/** The device report (`system.details`) as plain text, for the clipboard. */
import type { DetailSection } from "@pi-configurator/protocol";

/** "HARDWARE\nModel: Raspberry Pi 4 ...\n\nOPERATING SYSTEM\n..." with a heading line on top. */
export function detailsText(deviceName: string, sections: DetailSection[]): string {
  const blocks = sections.map(
    (s) => [s.title.toUpperCase(), ...s.items.map((i) => `${i.label}: ${i.value}`)].join("\n"),
  );
  return [`Device data: ${deviceName}`, ...blocks].join("\n\n") + "\n";
}
