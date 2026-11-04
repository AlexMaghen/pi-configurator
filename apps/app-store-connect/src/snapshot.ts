/**
 * Reads what App Store Connect has for one app, as plain data the checklist can compare: the
 * app record, recent builds and their TestFlight notes, tester groups, the App Info (name,
 * subtitle, privacy URL, categories, age rating), the version being prepared (texts,
 * screenshots, build, review details), pricing and availability. Read-only.
 */
import { ApiError, type AppStoreConnect, type Resource, text } from "./client";

export interface BuildInfo {
  version: string;
  processingState?: string;
  uploadedDate?: string;
  expired: boolean;
  whatToTest?: string;
}

export interface VersionInfo {
  versionString?: string;
  state?: string;
  copyright?: string;
  releaseType?: string;
  build?: string;
  localization?: {
    description?: string;
    keywords?: string;
    promotionalText?: string;
    supportUrl?: string;
    marketingUrl?: string;
    whatsNew?: string;
  };
  /** Display type (e.g. APP_IPHONE_67) to the number of screenshots uploaded. */
  screenshotSets: Record<string, number>;
  review?: {
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    notes?: string;
    demoAccountRequired?: boolean;
  };
}

export interface Snapshot {
  app: { id: string; name?: string; bundleId?: string; sku?: string; primaryLocale?: string };
  builds: BuildInfo[];
  betaGroups: { name?: string; internal: boolean }[];
  appInfo?: {
    state?: string;
    name?: string;
    subtitle?: string;
    privacyPolicyUrl?: string;
    primaryCategory?: string;
    secondaryCategory?: string;
    ageRatingDeclared: boolean;
  };
  version?: VersionInfo;
  /** undefined when the API wouldn't say. */
  priceSet?: boolean;
  territories?: number;
  /** Reads that failed, as "what: why", so the report can say what it couldn't check. */
  unreadable: string[];
}

/** Version states in which the listing can still be edited. */
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_DEVELOPER_RELEASE",
]);

/** For `.catch`: a 404 means "not set yet"; anything else is a real failure. */
const notFoundAs =
  <T>(value: T) =>
  (err: unknown): T => {
    if (err instanceof ApiError && err.status === 404) return value;
    throw err;
  };

const ageRatingFields = [
  "violenceCartoonOrFantasy",
  "violenceRealistic",
  "profanityOrCrudeHumor",
  "sexualContentOrNudity",
  "gamblingSimulated",
  "medicalOrTreatmentInformation",
] as const;

export async function readSnapshot(asc: AppStoreConnect, bundleId: string): Promise<Snapshot> {
  const unreadable: string[] = [];
  /** A read that may fail without stopping the others. */
  async function maybe<T>(what: string, read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await read();
    } catch (err) {
      unreadable.push(`${what}: ${err instanceof ApiError ? `${err.status} ${err.message}` : String(err)}`);
      return undefined;
    }
  }

  const app = await asc.one("/v1/apps", { "filter[bundleId]": bundleId });
  if (!app) throw new Error(`no app with bundle ID ${bundleId} in this App Store Connect account`);
  const primaryLocale = text(app, "primaryLocale");

  const builds =
    (await maybe("builds", async () => {
      const list = await asc.all("/v1/builds", { "filter[app]": app.id, sort: "-uploadedDate", limit: "10" });
      return Promise.all(
        list.slice(0, 10).map(async (b): Promise<BuildInfo> => {
          const notes = await asc.all(`/v1/builds/${b.id}/betaBuildLocalizations`).catch(() => [] as Resource[]);
          return {
            version: text(b, "version") ?? "?",
            processingState: text(b, "processingState"),
            uploadedDate: text(b, "uploadedDate"),
            expired: b.attributes?.expired === true,
            whatToTest: text(notes.find((n) => text(n, "locale") === primaryLocale) ?? notes[0], "whatsNew"),
          };
        }),
      );
    })) ?? [];

  const betaGroups =
    (await maybe("TestFlight groups", async () =>
      (await asc.all(`/v1/apps/${app.id}/betaGroups`)).map((g) => ({
        name: text(g, "name"),
        internal: g.attributes?.isInternalGroup === true,
      })),
    )) ?? [];

  const appInfo = await maybe("App Information", async () => {
    const infos = await asc.all(`/v1/apps/${app.id}/appInfos`);
    // An app that's live has two: the live one and the one being edited.
    const info = infos.find((i) => text(i, "state") !== "READY_FOR_DISTRIBUTION") ?? infos[0];
    if (!info) return undefined;
    const locs = await asc.all(`/v1/appInfos/${info.id}/appInfoLocalizations`);
    const loc = locs.find((l) => text(l, "locale") === primaryLocale) ?? locs[0];
    const primary = await asc.one(`/v1/appInfos/${info.id}/primaryCategory`).catch(() => null);
    const secondary = await asc.one(`/v1/appInfos/${info.id}/secondaryCategory`).catch(() => null);
    const age = await asc.one(`/v1/appInfos/${info.id}/ageRatingDeclaration`).catch(() => null);
    return {
      state: text(info, "state") ?? text(info, "appStoreState"),
      name: text(loc, "name"),
      subtitle: text(loc, "subtitle"),
      privacyPolicyUrl: text(loc, "privacyPolicyUrl"),
      primaryCategory: primary?.id,
      secondaryCategory: secondary?.id,
      ageRatingDeclared: ageRatingFields.some((f) => age?.attributes?.[f] != null),
    };
  });

  const version = await maybe("App Store version", async () => {
    const versions = await asc.all(`/v1/apps/${app.id}/appStoreVersions`, { "filter[platform]": "IOS" });
    const state = (v: Resource) => text(v, "appVersionState") ?? text(v, "appStoreState");
    const v = versions.find((x) => EDITABLE_STATES.has(state(x) ?? "")) ?? versions[0];
    if (!v) return undefined;
    const locs = await asc.all(`/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations`);
    const loc = locs.find((l) => text(l, "locale") === primaryLocale) ?? locs[0];
    const screenshotSets: Record<string, number> = {};
    if (loc) {
      for (const set of await asc.all(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)) {
        const shots = await asc.all(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
        screenshotSets[text(set, "screenshotDisplayType") ?? set.id] = shots.length;
      }
    }
    const build = await asc.one(`/v1/appStoreVersions/${v.id}/build`).catch(() => null);
    const review = await asc.one(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`).catch(() => null);
    const info: VersionInfo = {
      versionString: text(v, "versionString"),
      state: state(v),
      copyright: text(v, "copyright"),
      releaseType: text(v, "releaseType"),
      build: text(build, "version"),
      localization: loc && {
        description: text(loc, "description"),
        keywords: text(loc, "keywords"),
        promotionalText: text(loc, "promotionalText"),
        supportUrl: text(loc, "supportUrl"),
        marketingUrl: text(loc, "marketingUrl"),
        whatsNew: text(loc, "whatsNew"),
      },
      screenshotSets,
      review: review
        ? {
            contactName: [text(review, "contactFirstName"), text(review, "contactLastName")].filter(Boolean).join(" ") || undefined,
            contactEmail: text(review, "contactEmail"),
            contactPhone: text(review, "contactPhone"),
            notes: text(review, "notes"),
            demoAccountRequired: review.attributes?.demoAccountRequired === true,
          }
        : undefined,
    };
    return info;
  });

  // Both answer 404 until they've been set for the first time.
  const priceSet = await maybe("pricing", async () => {
    const schedule = await asc.one(`/v1/apps/${app.id}/appPriceSchedule`).catch(notFoundAs(null));
    if (!schedule) return false;
    const prices = await asc.all(`/v1/appPriceSchedules/${schedule.id}/manualPrices`).catch(notFoundAs([]));
    return prices.length > 0;
  });

  const territories = await maybe("availability", async () => {
    const availability = await asc.one(`/v1/apps/${app.id}/appAvailabilityV2`).catch(notFoundAs(null));
    if (!availability) return 0;
    const list = await asc.all(`/v2/appAvailabilities/${availability.id}/territoryAvailabilities`, { limit: "200" });
    return list.filter((t) => t.attributes?.available === true).length;
  });

  return {
    app: { id: app.id, name: text(app, "name"), bundleId: text(app, "bundleId"), sku: text(app, "sku"), primaryLocale },
    builds,
    betaGroups,
    appInfo,
    version,
    priceSet,
    territories,
    unreadable,
  };
}
