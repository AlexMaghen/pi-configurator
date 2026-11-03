/**
 * The device's config file: the template with the Device Name and pifig Access Password the
 * user typed, checked against the same rules the Pi uses (@pi-configurator/protocol).
 *
 * The password has no complexity or length rules beyond what the protocol can carry (1 to 128
 * characters). The name is what the phone sees in its Bluetooth scan, so it must fit the
 * Bluetooth advertisement: 29 bytes.
 *
 * The starting point is the built-in template, or the user's own file with --config-file.
 */
import { BluetoothName, Config } from "@pi-configurator/protocol";

export function nameProblem(name: string): string | undefined {
  if (name.trim() === "") return "Enter a name.";
  const result = BluetoothName.safeParse(name);
  return result.success ? undefined : "That name is too long for Bluetooth: use at most 29 bytes (29 letters, fewer with accents or emoji).";
}

export function passwordProblem(password: string): string | undefined {
  if (password === "") return "Enter a password.";
  if (password.length > 128) return "Use at most 128 characters.";
  return undefined;
}

/** The template with the name and password set, as the JSON text to write. Throws if invalid. */
export function personalize(templateText: string, name: string, password: string): string {
  const config = JSON.parse(templateText) as { bluetooth?: { name?: string }; access?: { password?: string } };
  config.bluetooth = { ...config.bluetooth, name };
  config.access = { ...config.access, password };
  const result = Config.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`the config isn't valid: ${issues}`);
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** What a config file sets for the prompts' defaults. */
export interface ConfigSummary {
  name: string;
  password: string;
  settingsCount: number;
}

/** Checks a whole config file (JSON and the Pi's rules); throws with every problem listed. */
export function checkConfigText(text: string, source: string): ConfigSummary {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`${source} isn't valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = Config.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".") || "(top level)"}: ${i.message}`);
    throw new Error(`${source} isn't a valid pi-configurator config:\n${issues.join("\n")}`);
  }
  return {
    name: result.data.bluetooth.name,
    password: result.data.access.password,
    settingsCount: result.data.settings.length,
  };
}
