import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { categoryId, checklist, formatReport } from "../src/checklist";
import { keyFromEnv, makeToken } from "../src/client";
import { pngSize, type LocalListing } from "../src/local";
import type { Snapshot } from "../src/snapshot";

describe("makeToken", () => {
  it("signs an ES256 JWT App Store Connect accepts", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = makeToken({ keyId: "ABC123DEF4", issuerId: "issuer-uuid", keyPath: "" }, pem, 1_000);
    const [header, payload, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEF4", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({
      iss: "issuer-uuid",
      iat: 1_000,
      exp: 1_900,
      aud: "appstoreconnect-v1",
    });
    const sig = Buffer.from(signature, "base64url");
    expect(sig.length).toBe(64); // raw r||s, not DER
    const verifier = createVerify("SHA256");
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, sig)).toBe(true);
  });

  it("finds the key file in the standard folder unless told otherwise", () => {
    expect(keyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I" }).keyPath).toMatch(/\.appstoreconnect\/private_keys\/AuthKey_K\.p8$/);
    expect(keyFromEnv({ ASC_KEY_ID: "K", ASC_ISSUER_ID: "I", ASC_KEY_PATH: "/x/k.p8" }).keyPath).toBe("/x/k.p8");
    expect(() => keyFromEnv({})).toThrow(/ASC_KEY_ID/);
  });
});

describe("pngSize", () => {
  it("reads the IHDR size", () => {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, 1320);
    new DataView(bytes.buffer).setUint32(20, 2868);
    expect(pngSize(bytes)).toEqual({ width: 1320, height: 2868 });
    expect(pngSize(new Uint8Array(24))).toBeUndefined();
  });
});

describe("checklist", () => {
  const local: LocalListing = {
    metadata: {
      name: "pi-fig",
      subtitle: "Set up your Pi over Bluetooth",
      description: "Long text",
      keywords: "pi,bluetooth",
      promotional_text: "Promo",
      support_url: "https://example.com/",
      privacy_url: "https://example.com/",
      copyright: "2026 Alex Maghen",
      primary_category: "Utilities",
      secondary_category: "Developer Tools",
      review_notes: "Use the demo device.",
      testflight_what_to_test: "Try the demo.",
    },
    screenshots: { "iphone-6.9": [{ file: "01.png", width: 1320, height: 2868 }], "ipad-13": [] },
  };

  const snapshot: Snapshot = {
    app: { id: "1", name: "pi-fig", bundleId: "com.alexmaghen.pifig", primaryLocale: "en-US" },
    builds: [{ version: "7", processingState: "VALID", expired: false, whatToTest: "Try the demo.\n" }],
    betaGroups: [{ name: "Team", internal: true }],
    appInfo: {
      name: "pi-fig",
      subtitle: undefined,
      privacyPolicyUrl: "https://example.com/",
      primaryCategory: "UTILITIES",
      secondaryCategory: "DEVELOPER_TOOLS",
      ageRatingDeclared: false,
    },
    version: {
      versionString: "1.0",
      state: "PREPARE_FOR_SUBMISSION",
      copyright: "2026 Alex Maghen",
      localization: { description: "Older text", keywords: "pi,bluetooth" },
      screenshotSets: { APP_IPHONE_67: 1 },
      review: { notes: "Use the demo device.", demoAccountRequired: false },
    },
    priceSet: true,
    territories: 175,
    unreadable: [],
  };

  const byLabel = (label: string) => checklist(snapshot, local).find((i) => i.label === label);

  it("compares each field with the repository", () => {
    expect(byLabel("Name")?.status).toBe("ok");
    expect(byLabel("Subtitle")?.status).toBe("missing");
    expect(byLabel("Description")?.status).toBe("differs");
    expect(byLabel("Keywords")?.status).toBe("ok");
    expect(byLabel("What to Test for build 7")?.status).toBe("ok"); // trailing newline ignored
    expect(byLabel("Primary category")?.status).toBe("ok");
  });

  it("flags what a submission still needs", () => {
    expect(byLabel("Age rating")?.status).toBe("missing");
    expect(byLabel("Build")?.detail).toBe("choose a build (newest is 7)");
    expect(byLabel("Contact (name, email, phone)")?.status).toBe("missing");
    expect(byLabel('iPhone 6.9" screenshots')?.status).toBe("ok");
    expect(byLabel('iPad 13" screenshots')?.status).toBe("missing");
    expect(byLabel("App Privacy")?.status).toBe("manual");
    expect(byLabel("Availability")?.detail).toBe("175 countries or regions");
  });

  it("reports a count of what's left", () => {
    expect(formatReport(checklist(snapshot, local))).toMatch(/\d+ to fix, 1 to check on the website\.$/);
  });

  it("turns category names into App Store Connect IDs", () => {
    expect(categoryId("Developer Tools")).toBe("DEVELOPER_TOOLS");
  });
});
