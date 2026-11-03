import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfigText, nameProblem, passwordProblem, personalize } from "../src/config";

const template = readFileSync(join(__dirname, "../../../config-template/config.json"), "utf8");

describe("device config", () => {
  it("writes the name and password into the template", () => {
    const config = JSON.parse(personalize(template, "Garage Pi", "x"));
    expect(config.bluetooth.name).toBe("Garage Pi");
    expect(config.access.password).toBe("x");
    expect(config.settings).toEqual(JSON.parse(template).settings);
  });

  it("accepts any password from 1 to 128 characters", () => {
    expect(passwordProblem("1")).toBeUndefined();
    expect(passwordProblem("a b c ü ✓")).toBeUndefined();
    expect(passwordProblem("p".repeat(128))).toBeUndefined();
    expect(passwordProblem("")).toMatch(/Enter/);
    expect(passwordProblem("p".repeat(129))).toMatch(/128/);
  });

  it("holds the name to the Bluetooth limit of 29 bytes", () => {
    expect(nameProblem("Kitchen Pi")).toBeUndefined();
    expect(nameProblem("n".repeat(29))).toBeUndefined();
    expect(nameProblem("n".repeat(30))).toMatch(/29 bytes/);
    expect(nameProblem("é".repeat(15))).toMatch(/29 bytes/); // 30 bytes in UTF-8
    expect(nameProblem("  ")).toMatch(/Enter/);
  });
});

describe("--config-file", () => {
  it("reads the name, password and settings count from a valid file", () => {
    expect(checkConfigText(template, "my.json")).toEqual({
      name: JSON.parse(template).bluetooth.name,
      password: JSON.parse(template).access.password,
      settingsCount: JSON.parse(template).settings.length,
    });
  });

  it("lists every problem, with the file's name", () => {
    expect(() => checkConfigText("{ not json", "bad.json")).toThrow(/bad\.json isn't valid JSON/);
    const broken = JSON.parse(template);
    broken.bluetooth.name = "n".repeat(40);
    delete broken.access;
    let message = "";
    try {
      checkConfigText(JSON.stringify(broken), "broken.json");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^broken\.json isn't a valid pi-configurator config:/);
    expect(message).toMatch(/bluetooth\.name: Bluetooth name is longer than 29 bytes/);
    expect(message).toMatch(/access:/);
  });
});
