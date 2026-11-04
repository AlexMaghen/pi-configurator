/**
 * Sends the repository's listing to App Store Connect: App Information (name, subtitle, privacy
 * URL, categories, age rating), the version being prepared (texts, copyright, manual release,
 * build, screenshots, review notes), the newest build's What to Test, the price (free) and
 * availability (every country or region, and new ones as Apple adds them).
 *
 * Safe to run again: fields are overwritten with the repository's values, and screenshots are
 * only uploaded to sets that are still empty. It never submits anything for review.
 *
 * Settings that are the owner's standing choices for every app: manual release, global
 * availability, free. Age rating: every content question "NONE", every yes/no question false.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SCREENSHOT_SETS, categoryId } from "./checklist";
import { ApiError, type AppStoreConnect, type Resource, type UploadOperation, text } from "./client";
import type { LocalListing } from "./local";

/** Age rating questions answered with a level; the rest of the questionnaire is yes/no. */
const LEVEL_QUESTIONS = new Set([
  "alcoholTobaccoOrDrugUseOrReferences",
  "contests",
  "gamblingSimulated",
  "gunsOrOtherWeapons",
  "horrorOrFearThemes",
  "matureOrSuggestiveThemes",
  "medicalOrTreatmentInformation",
  "profanityOrCrudeHumor",
  "sexualContentGraphicAndNudity",
  "sexualContentOrNudity",
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "violenceRealisticProlongedGraphicOrSadistic",
]);
/** Attributes of the declaration that aren't questions. */
const NOT_QUESTIONS = new Set([
  "kidsAgeBand",
  "ageRatingOverride",
  "ageRatingOverrideV2",
  "koreaAgeRatingOverride",
  "gracRatingClassificationNumber",
  "developerAgeRatingInfoUrl",
]);

/** "No" to every question, for an app with no objectionable content (rated 4+). */
export function ageRatingAnswers(attributes: Record<string, unknown>): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const name of Object.keys(attributes)) {
    if (NOT_QUESTIONS.has(name)) continue;
    out[name] = LEVEL_QUESTIONS.has(name) ? "NONE" : false;
  }
  return out;
}

const ref = (type: string, id: string) => ({ data: { type, id } });

export interface PushOptions {
  bundleId: string;
  storeDir: string;
  log: (line: string) => void;
}

export async function pushListing(asc: AppStoreConnect, local: LocalListing, opts: PushOptions): Promise<void> {
  const { log } = opts;
  const m = local.metadata;
  const app = await asc.one("/v1/apps", { "filter[bundleId]": opts.bundleId });
  if (!app) throw new Error(`no app with bundle ID ${opts.bundleId}`);
  const locale = text(app, "primaryLocale") ?? "en-US";
  const pick = (list: Resource[]) => list.find((r) => text(r, "locale") === locale) ?? list[0];

  // -- App Information -----------------------------------------------------------------------
  const infos = await asc.all(`/v1/apps/${app.id}/appInfos`);
  const info = infos.find((i) => text(i, "state") !== "READY_FOR_DISTRIBUTION") ?? infos[0];
  if (!info) throw new Error("the app has no App Information to edit");
  const infoLoc = pick(await asc.all(`/v1/appInfos/${info.id}/appInfoLocalizations`));
  if (infoLoc) {
    await asc.send("PATCH", `/v1/appInfoLocalizations/${infoLoc.id}`, {
      data: {
        type: "appInfoLocalizations",
        id: infoLoc.id,
        attributes: { name: m.name, subtitle: m.subtitle, privacyPolicyUrl: m.privacy_url },
      },
    });
    log("App Information: name, subtitle, privacy policy URL");
  }
  if (m.primary_category) {
    const relationships: Record<string, unknown> = {
      primaryCategory: ref("appCategories", categoryId(m.primary_category)),
    };
    if (m.secondary_category) relationships.secondaryCategory = ref("appCategories", categoryId(m.secondary_category));
    await asc.send("PATCH", `/v1/appInfos/${info.id}`, { data: { type: "appInfos", id: info.id, relationships } });
    log(`App Information: categories ${m.primary_category}${m.secondary_category ? `, ${m.secondary_category}` : ""}`);
  }
  const age = await asc.one(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  if (age) {
    await asc.send("PATCH", `/v1/ageRatingDeclarations/${age.id}`, {
      data: { type: "ageRatingDeclarations", id: age.id, attributes: ageRatingAnswers(age.attributes ?? {}) },
    });
    log("App Information: age rating (no to every question)");
  }

  // -- The version ---------------------------------------------------------------------------
  const versions = await asc.all(`/v1/apps/${app.id}/appStoreVersions`, { "filter[platform]": "IOS" });
  const version = versions.find((v) => (text(v, "appVersionState") ?? text(v, "appStoreState")) === "PREPARE_FOR_SUBMISSION");
  if (!version) throw new Error("no iOS version is being prepared (create one in App Store Connect first)");
  const versionName = text(version, "versionString") ?? "?";

  const builds = await asc.all("/v1/builds", { "filter[app]": app.id, sort: "-uploadedDate", limit: "10" });
  const build = builds.find((b) => text(b, "processingState") === "VALID" && b.attributes?.expired !== true);
  await asc.send("PATCH", `/v1/appStoreVersions/${version.id}`, {
    data: {
      type: "appStoreVersions",
      id: version.id,
      attributes: { copyright: m.copyright, releaseType: "MANUAL" },
      relationships: build ? { build: ref("builds", build.id) } : undefined,
    },
  });
  log(`Version ${versionName}: copyright, manual release${build ? `, build ${text(build, "version")}` : ""}`);

  const versionLoc = pick(await asc.all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`));
  if (!versionLoc) throw new Error(`version ${versionName} has no ${locale} localization`);
  await asc.send("PATCH", `/v1/appStoreVersionLocalizations/${versionLoc.id}`, {
    data: {
      type: "appStoreVersionLocalizations",
      id: versionLoc.id,
      attributes: {
        description: m.description,
        keywords: m.keywords,
        promotionalText: m.promotional_text,
        supportUrl: m.support_url,
        ...(m.marketing_url ? { marketingUrl: m.marketing_url } : {}),
      },
    },
  });
  log(`Version ${versionName}: description, keywords, promotional text, support URL`);

  const review = await asc.one(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`).catch(() => null);
  const reviewAttributes = { notes: m.review_notes, demoAccountRequired: false };
  if (review) {
    await asc.send("PATCH", `/v1/appStoreReviewDetails/${review.id}`, {
      data: { type: "appStoreReviewDetails", id: review.id, attributes: reviewAttributes },
    });
  } else {
    await asc.send("POST", "/v1/appStoreReviewDetails", {
      data: {
        type: "appStoreReviewDetails",
        attributes: reviewAttributes,
        relationships: { appStoreVersion: ref("appStoreVersions", version.id) },
      },
    });
  }
  log("App Review: notes, no sign-in required");

  await uploadScreenshots(asc, versionLoc.id, local, opts);

  // -- TestFlight ----------------------------------------------------------------------------
  if (build && m.testflight_what_to_test) {
    const notes = pick(await asc.all(`/v1/builds/${build.id}/betaBuildLocalizations`));
    if (notes) {
      await asc.send("PATCH", `/v1/betaBuildLocalizations/${notes.id}`, {
        data: { type: "betaBuildLocalizations", id: notes.id, attributes: { whatsNew: m.testflight_what_to_test } },
      });
    } else {
      await asc.send("POST", "/v1/betaBuildLocalizations", {
        data: {
          type: "betaBuildLocalizations",
          attributes: { locale, whatsNew: m.testflight_what_to_test },
          relationships: { build: ref("builds", build.id) },
        },
      });
    }
    log(`TestFlight: What to Test for build ${text(build, "version")}`);
  }

  // -- Price and availability ----------------------------------------------------------------
  await setFree(asc, app.id, log);
  await setAvailableEverywhere(asc, app.id, log);
}

async function uploadScreenshots(asc: AppStoreConnect, versionLocId: string, local: LocalListing, opts: PushOptions) {
  const sets = await asc.all(`/v1/appStoreVersionLocalizations/${versionLocId}/appScreenshotSets`);
  for (const [folder, { displayType, label }] of Object.entries(SCREENSHOT_SETS)) {
    const files = local.screenshots[folder] ?? [];
    if (files.length === 0) continue;
    let set = sets.find((s) => text(s, "screenshotDisplayType") === displayType) ?? null;
    if (set && (await asc.all(`/v1/appScreenshotSets/${set.id}/appScreenshots`)).length > 0) {
      opts.log(`${label}: already uploaded, left as they are`);
      continue;
    }
    set ??= await asc.send("POST", "/v1/appScreenshotSets", {
      data: {
        type: "appScreenshotSets",
        attributes: { screenshotDisplayType: displayType },
        relationships: { appStoreVersionLocalization: ref("appStoreVersionLocalizations", versionLocId) },
      },
    });
    if (!set) throw new Error(`couldn't create the ${label} set`);

    const ids: string[] = [];
    for (const shot of files) {
      const bytes = new Uint8Array(readFileSync(join(opts.storeDir, "ios", "screenshots", folder, shot.file)));
      const created = await asc.send("POST", "/v1/appScreenshots", {
        data: {
          type: "appScreenshots",
          attributes: { fileName: shot.file, fileSize: bytes.length },
          relationships: { appScreenshotSet: ref("appScreenshotSets", set.id) },
        },
      });
      if (!created) throw new Error(`couldn't reserve ${shot.file}`);
      const ops = (created.attributes?.uploadOperations ?? []) as UploadOperation[];
      for (const op of ops) await asc.upload(op, bytes);
      await asc.send("PATCH", `/v1/appScreenshots/${created.id}`, {
        data: {
          type: "appScreenshots",
          id: created.id,
          attributes: { uploaded: true, sourceFileChecksum: createHash("md5").update(bytes).digest("hex") },
        },
      });
      ids.push(created.id);
    }
    await asc.send("PATCH", `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
      data: ids.map((id) => ({ type: "appScreenshots", id })),
    });
    opts.log(`${label}: ${files.length.toLocaleString("en-US")} uploaded`);
  }
}

/** For `.catch`: a 404 means "not set yet". */
const notFound = <T>(value: T) => (err: unknown): T => {
  if (err instanceof ApiError && err.status === 404) return value;
  throw err;
};

async function setFree(asc: AppStoreConnect, appId: string, log: (line: string) => void) {
  const schedule = await asc.one(`/v1/apps/${appId}/appPriceSchedule`).catch(notFound(null));
  if (schedule && (await asc.all(`/v1/appPriceSchedules/${schedule.id}/manualPrices`).catch(notFound([]))).length > 0) {
    log("Pricing: already set, left as it is");
    return;
  }
  const points = await asc.all(`/v1/apps/${appId}/appPricePoints`, { "filter[territory]": "USA", limit: "200" });
  const free = points.find((p) => Number(text(p, "customerPrice")) === 0);
  if (!free) throw new Error("couldn't find the free price point");
  await asc.send("POST", "/v1/appPriceSchedules", {
    data: {
      type: "appPriceSchedules",
      relationships: {
        app: ref("apps", appId),
        baseTerritory: ref("territories", "USA"),
        manualPrices: { data: [{ type: "appPrices", id: "${price}" }] },
      },
    },
    included: [
      {
        type: "appPrices",
        id: "${price}",
        attributes: { startDate: null },
        relationships: { appPricePoint: ref("appPricePoints", free.id) },
      },
    ],
  });
  log("Pricing: free");
}

async function setAvailableEverywhere(asc: AppStoreConnect, appId: string, log: (line: string) => void) {
  if (await asc.one(`/v1/apps/${appId}/appAvailabilityV2`).catch(notFound(null))) {
    log("Availability: already set, left as it is");
    return;
  }
  const territories = await asc.all("/v1/territories", { limit: "200" });
  const local = (t: Resource) => `\${t-${t.id}}`;
  await asc.send("POST", "/v2/appAvailabilities", {
    data: {
      type: "appAvailabilities",
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: ref("apps", appId),
        territoryAvailabilities: { data: territories.map((t) => ({ type: "territoryAvailabilities", id: local(t) })) },
      },
    },
    included: territories.map((t) => ({
      type: "territoryAvailabilities",
      id: local(t),
      attributes: { available: true },
      relationships: { territory: ref("territories", t.id) },
    })),
  });
  log(`Availability: all ${territories.length.toLocaleString("en-US")} countries and regions, and new ones`);
}
