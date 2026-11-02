import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { addFirstBootCommand, FIRST_BOOT_COMMAND } from "../src/userData";
import { FRESH_USER_DATA, IMAGER_USER_DATA } from "./support";

describe("user-data", () => {
  it("adds runcmd to a fresh image's comment-only user-data, keeping the header and comments", () => {
    const out = addFirstBootCommand(FRESH_USER_DATA);
    expect(out.startsWith("#cloud-config\n")).toBe(true);
    expect(out).toContain("#hostname: raspberrypi");
    expect(parse(out)).toEqual({ runcmd: [FIRST_BOOT_COMMAND] });
  });

  it("appends to the runcmd Raspberry Pi Imager wrote and keeps its settings", () => {
    const out = addFirstBootCommand(IMAGER_USER_DATA);
    const data = parse(out) as Record<string, unknown>;
    expect(data.hostname).toBe("kitchen");
    expect(data.users).toEqual(parse(IMAGER_USER_DATA).users);
    expect(data.runcmd).toEqual(['localectl set-x11-keymap "us" pc105', "setupcon -k --force || true", FIRST_BOOT_COMMAND]);
  });

  it("adds it only once", () => {
    const twice = addFirstBootCommand(addFirstBootCommand(IMAGER_USER_DATA));
    expect((parse(twice) as { runcmd: string[] }).runcmd.filter((c) => c === FIRST_BOOT_COMMAND)).toHaveLength(1);
  });

  it("puts the header back when it's missing", () => {
    expect(addFirstBootCommand("hostname: x\n").startsWith("#cloud-config\n")).toBe(true);
  });

  it("refuses user-data it can't safely change", () => {
    expect(() => addFirstBootCommand("#cloud-config\nruncmd: [unclosed\n")).toThrow(/valid YAML/);
    expect(() => addFirstBootCommand("#cloud-config\nruncmd: echo hi\n")).toThrow(/isn't a list/);
  });
});
