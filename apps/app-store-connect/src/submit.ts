/**
 * Submits the version being prepared for App Review, the way App Store Connect's "Add for
 * Review" then "Submit" does: a review submission for the app, the version added to it as an
 * item, then the submission sent. Reuses a submission that was started but never sent.
 *
 * Only run on the owner's go-ahead for that submission. What happens after approval follows the
 * version's release setting (manual for the owner's apps).
 */
import { type AppStoreConnect, text } from "./client";

const ref = (type: string, id: string) => ({ data: { type, id } });

export async function submitForReview(asc: AppStoreConnect, bundleId: string, log: (line: string) => void): Promise<void> {
  const app = await asc.one("/v1/apps", { "filter[bundleId]": bundleId });
  if (!app) throw new Error(`no app with bundle ID ${bundleId}`);
  const versions = await asc.all(`/v1/apps/${app.id}/appStoreVersions`, { "filter[platform]": "IOS" });
  const version = versions.find((v) => (text(v, "appVersionState") ?? text(v, "appStoreState")) === "PREPARE_FOR_SUBMISSION");
  if (!version) throw new Error("no iOS version is waiting to be submitted");
  const name = text(version, "versionString") ?? "?";

  const open = await asc.all("/v1/reviewSubmissions", {
    "filter[app]": app.id,
    "filter[platform]": "IOS",
    "filter[state]": "READY_FOR_REVIEW",
  });
  const submission =
    open[0] ??
    (await asc.send("POST", "/v1/reviewSubmissions", {
      data: { type: "reviewSubmissions", attributes: { platform: "IOS" }, relationships: { app: ref("apps", app.id) } },
    }));
  if (!submission) throw new Error("couldn't start a review submission");

  const items = await asc.all(`/v1/reviewSubmissions/${submission.id}/items`);
  if (items.length === 0) {
    await asc.send("POST", "/v1/reviewSubmissionItems", {
      data: {
        type: "reviewSubmissionItems",
        relationships: {
          reviewSubmission: ref("reviewSubmissions", submission.id),
          appStoreVersion: ref("appStoreVersions", version.id),
        },
      },
    });
  }
  await asc.send("PATCH", `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: "reviewSubmissions", id: submission.id, attributes: { submitted: true } },
  });
  log(`submitted version ${name} for App Review`);
}
