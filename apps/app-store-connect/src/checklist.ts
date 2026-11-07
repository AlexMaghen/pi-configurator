/**
 * Compares App Store Connect (a Snapshot) with the repository's listing (LocalListing) and lists
 * what an App Review submission still needs. Pure, so it's tested without the network.
 *
 * Statuses: ok, missing (not set in App Store Connect), differs (set, but not to the
 * repository's text), todo (something to do in App Store Connect that isn't a field), manual
 * (can't be read through the API: check on the website), info.
 */
import type { LocalListing, MetadataName } from "./local";
import type { Snapshot } from "./snapshot";

export type Status = "ok" | "missing" | "differs" | "todo" | "manual" | "info";

export interface Item {
  section: string;
  label: string;
  status: Status;
  detail?: string;
}

/** Local screenshot folders and the App Store Connect display type each one fills. */
export const SCREENSHOT_SETS: Record<string, { displayType: string; label: string }> = {
  "iphone-6.9": { displayType: "APP_IPHONE_67", label: 'iPhone 6.9" screenshots' },
  "ipad-13": { displayType: "APP_IPAD_PRO_3GEN_129", label: 'iPad 13" screenshots' },
};

const normalize = (s: string | undefined) => (s ?? "").replace(/\r\n/g, "\n").trim();
/** "Developer Tools" -> "DEVELOPER_TOOLS", the category IDs App Store Connect uses. */
export const categoryId = (name: string | undefined) => normalize(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_");

function compare(section: string, label: string, remote: string | undefined, local: string | undefined): Item {
  if (!normalize(remote)) {
    return { section, label, status: "missing", detail: local ? "the repository has text for it" : undefined };
  }
  if (local === undefined || normalize(remote) === normalize(local)) return { section, label, status: "ok" };
  return { section, label, status: "differs", detail: "App Store Connect has different text from the repository" };
}

export function checklist(snap: Snapshot, local: LocalListing): Item[] {
  const items: Item[] = [];
  const m = (name: MetadataName) => local.metadata[name];

  // -- App and builds ------------------------------------------------------------------------
  items.push({
    section: "App",
    label: "App record",
    status: "info",
    detail: `${snap.app.name ?? "?"} (${snap.app.bundleId ?? "?"}), primary language ${snap.app.primaryLocale ?? "?"}`,
  });

  items.push({
    section: "App",
    label: "Content rights",
    status: snap.app.contentRights ? "ok" : "missing",
    detail: snap.app.contentRights ? undefined : "say whether the app shows third-party content",
  });

  const latest = snap.builds[0];
  if (!latest) {
    items.push({ section: "TestFlight", label: "Builds", status: "missing", detail: "no build uploaded" });
  } else {
    const ready = latest.processingState === "VALID" && !latest.expired;
    items.push({
      section: "TestFlight",
      label: `Newest build (${latest.version})`,
      status: ready ? "ok" : "info",
      detail: ready ? undefined : `processing state ${latest.processingState ?? "?"}${latest.expired ? ", expired" : ""}`,
    });
    items.push(compare("TestFlight", `What to Test for build ${latest.version}`, latest.whatToTest, m("testflight_what_to_test")));
  }
  const external = snap.betaGroups.filter((g) => !g.internal);
  items.push({
    section: "TestFlight",
    label: "Tester groups",
    status: "info",
    detail: snap.betaGroups.length
      ? snap.betaGroups.map((g) => `${g.name ?? "?"} (${g.internal ? "internal" : "external"})`).join(", ")
      : "none",
  });
  if (external.length === 0) {
    items.push({
      section: "TestFlight",
      label: "External testers",
      status: "info",
      detail: "no external group yet: only needed to test with people outside your team",
    });
  }

  // -- App Information -----------------------------------------------------------------------
  const info = snap.appInfo;
  items.push(compare("App Information", "Name", info?.name, m("name")));
  items.push(compare("App Information", "Subtitle", info?.subtitle, m("subtitle")));
  items.push(compare("App Information", "Privacy Policy URL", info?.privacyPolicyUrl, m("privacy_url")));
  items.push(compare("App Information", "Primary category", info?.primaryCategory, m("primary_category") && categoryId(m("primary_category"))));
  if (m("secondary_category")) {
    items.push(compare("App Information", "Secondary category", info?.secondaryCategory, categoryId(m("secondary_category"))));
  }
  items.push({
    section: "App Information",
    label: "Age rating",
    status: info?.ageRatingDeclared ? "ok" : "missing",
    detail: info?.ageRatingDeclared ? undefined : "not answered yet; the answers in store/README.md give 4+",
  });
  items.push({
    section: "App Information",
    label: "App Privacy",
    status: "manual",
    detail: 'not in the API: check App Store Connect → App Privacy says "Data Not Collected" and is Published (saving alone isn\'t enough)',
  });

  // -- The version ---------------------------------------------------------------------------
  const v = snap.version;
  if (!v) {
    items.push({ section: "Version", label: "App Store version", status: "missing", detail: "no iOS version created yet" });
  } else {
    items.push({
      section: "Version",
      label: `Version ${v.versionString ?? "?"}`,
      status: v.state === "PREPARE_FOR_SUBMISSION" ? "ok" : "info",
      detail: v.state,
    });
    const loc = v.localization;
    items.push(compare("Version", "Description", loc?.description, m("description")));
    items.push(compare("Version", "Keywords", loc?.keywords, m("keywords")));
    items.push(compare("Version", "Promotional text", loc?.promotionalText, m("promotional_text")));
    items.push(
      m("whats_new")
        ? compare("Version", "What's New", loc?.whatsNew, m("whats_new"))
        : {
            section: "Version",
            label: "What's New",
            status: "info",
            detail: "no whats_new.txt: needed for every version after the first",
          },
    );
    items.push(compare("Version", "Support URL", loc?.supportUrl, m("support_url")));
    if (m("marketing_url")) items.push(compare("Version", "Marketing URL", loc?.marketingUrl, m("marketing_url")));
    items.push(compare("Version", "Copyright", v.copyright, m("copyright")));

    for (const [folder, set] of Object.entries(SCREENSHOT_SETS)) {
      const remote = v.screenshotSets[set.displayType] ?? 0;
      const localCount = local.screenshots[folder]?.length ?? 0;
      items.push({
        section: "Version",
        label: set.label,
        status: remote === 0 ? "missing" : remote === localCount ? "ok" : "differs",
        detail:
          remote === localCount ? `${remote} uploaded` : `${remote} uploaded, ${localCount} in store/ios/screenshots/${folder}`,
      });
    }

    items.push({
      section: "Version",
      label: "Build",
      status: v.build ? "ok" : "missing",
      detail: v.build ? `build ${v.build}` : latest ? `choose a build (newest is ${latest.version})` : "upload a build first",
    });

    const r = v.review;
    const contactOk = !!(r?.contactName && r.contactEmail && r.contactPhone);
    items.push({
      section: "App Review",
      label: "Contact (name, email, phone)",
      status: contactOk ? "ok" : "missing",
      detail: contactOk ? r?.contactName : "App Review needs someone to reach",
    });
    items.push(compare("App Review", "Notes", r?.notes, m("review_notes")));
    items.push({
      section: "App Review",
      label: "Sign-in required",
      status: r?.demoAccountRequired ? "differs" : "ok",
      detail: r?.demoAccountRequired ? "set to required; the app has no sign-in (the notes explain the demo device)" : "no",
    });
  }

  // -- Pricing and availability --------------------------------------------------------------
  items.push(
    snap.priceSet === undefined
      ? { section: "Pricing", label: "Price", status: "manual", detail: "couldn't read it: check Pricing and Availability" }
      : { section: "Pricing", label: "Price", status: snap.priceSet ? "ok" : "missing", detail: snap.priceSet ? undefined : "no price set (free is a price)" },
  );
  items.push(
    snap.territories === undefined
      ? { section: "Pricing", label: "Availability", status: "manual", detail: "couldn't read it: check Pricing and Availability" }
      : {
          section: "Pricing",
          label: "Availability",
          status: snap.territories > 0 ? "ok" : "missing",
          detail: snap.territories > 0 ? `${snap.territories.toLocaleString("en-US")} countries or regions` : "not available anywhere yet",
        },
  );

  for (const what of snap.unreadable) {
    items.push({ section: "Couldn't read", label: what.split(":")[0] ?? what, status: "manual", detail: what });
  }
  return items;
}

const MARK: Record<Status, string> = { ok: "ok", missing: "MISSING", differs: "DIFFERS", todo: "TODO", manual: "CHECK", info: "-" };

/** Plain-text report, grouped by section, with a count of what's left. */
export function formatReport(items: Item[]): string {
  const lines: string[] = [];
  let section = "";
  for (const item of items) {
    if (item.section !== section) {
      section = item.section;
      lines.push("", section);
    }
    const detail = item.detail ? `  (${item.detail})` : "";
    lines.push(`  ${MARK[item.status].padEnd(8)}${item.label}${detail}`);
  }
  const open = items.filter((i) => i.status === "missing" || i.status === "differs" || i.status === "todo").length;
  const manual = items.filter((i) => i.status === "manual").length;
  lines.push("", `${open.toLocaleString("en-US")} to fix, ${manual.toLocaleString("en-US")} to check on the website.`);
  return lines.join("\n").trimStart();
}
