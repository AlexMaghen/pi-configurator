/**
 * A small App Store Connect API client: signs a short-lived ES256 token with the team API key
 * and reads JSON:API documents, following `links.next` for lists.
 *
 * The key's three values come from the environment, never from a repository:
 *   ASC_KEY_ID      the Key ID shown in App Store Connect (also in the file name)
 *   ASC_ISSUER_ID   the Issuer ID shown above the key list
 *   ASC_KEY_PATH    the AuthKey_<Key ID>.p8 file (defaults to ~/.appstoreconnect/private_keys/)
 *
 * The private key is only read to sign tokens; it's never printed or sent anywhere.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.appstoreconnect.apple.com";
/** Apple allows at most 20 minutes. */
const TOKEN_LIFETIME_S = 15 * 60;

export interface KeySettings {
  keyId: string;
  issuerId: string;
  keyPath: string;
}

export function keyFromEnv(env: Record<string, string | undefined> = process.env): KeySettings {
  const keyId = env.ASC_KEY_ID;
  const issuerId = env.ASC_ISSUER_ID;
  if (!keyId || !issuerId) {
    throw new Error("set ASC_KEY_ID and ASC_ISSUER_ID (and ASC_KEY_PATH if the key isn't in ~/.appstoreconnect/private_keys)");
  }
  const keyPath = env.ASC_KEY_PATH || join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`);
  return { keyId, issuerId, keyPath };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/** The signed JWT App Store Connect expects. `now` is in seconds. */
export function makeToken(key: KeySettings, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: key.keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({ iss: key.issuerId, iat: now, exp: now + TOKEN_LIFETIME_S, aud: "appstoreconnect-v1" }),
  );
  const signer = createSign("SHA256");
  signer.update(`${header}.${payload}`);
  // JWTs carry the raw r||s signature, not the DER form Node produces by default.
  const signature = signer.sign({ key: privateKeyPem, dsaEncoding: "ieee-p1363" });
  return `${header}.${payload}.${base64url(signature)}`;
}

/** One JSON:API resource. Attributes are read with the helpers below. */
export interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
}

interface Document {
  data: Resource | Resource[] | null;
  links?: { next?: string };
  errors?: { status: string; code: string; title: string; detail?: string }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class AppStoreConnect {
  private token?: { value: string; expires: number };

  constructor(
    private readonly key: KeySettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private bearer(): string {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || this.token.expires - now < 60) {
      const pem = readFileSync(this.key.keyPath, "utf8");
      this.token = { value: makeToken(this.key, pem, now), expires: now + TOKEN_LIFETIME_S };
    }
    return this.token.value;
  }

  private async document(pathOrUrl: string, params?: Record<string, string>): Promise<Document> {
    const url = new URL(pathOrUrl, API);
    for (const [name, value] of Object.entries(params ?? {})) url.searchParams.set(name, value);
    const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.bearer()}` } });
    const body = (await response.json().catch(() => ({}))) as Document;
    if (!response.ok) {
      const first = body.errors?.[0];
      throw new ApiError(response.status, first ? `${first.title}${first.detail ? `: ${first.detail}` : ""}` : response.statusText);
    }
    return body;
  }

  /** POST, PATCH or DELETE a JSON:API body; returns the resource it answers with, if any. */
  async send(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<Resource | null> {
    const response = await this.fetchImpl(new URL(path, API), {
      method,
      headers: { Authorization: `Bearer ${this.bearer()}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const doc = (await response.json().catch(() => ({}))) as Document;
    if (!response.ok) {
      const details = (doc.errors ?? []).map((e) => `${e.title}${e.detail ? `: ${e.detail}` : ""}`).join("; ");
      throw new ApiError(response.status, `${method} ${path}: ${details || response.statusText}`);
    }
    return Array.isArray(doc.data) ? (doc.data[0] ?? null) : (doc.data ?? null);
  }

  /** Sends one part of a file to the storage URL App Store Connect gave (no API token there). */
  async upload(op: UploadOperation, bytes: Uint8Array): Promise<void> {
    const headers = Object.fromEntries(op.requestHeaders.map((h) => [h.name, h.value]));
    const part = bytes.subarray(op.offset, op.offset + op.length);
    const response = await this.fetchImpl(op.url, { method: op.method, headers, body: part });
    if (!response.ok) throw new ApiError(response.status, `upload failed: ${response.statusText}`);
  }

  /** A single resource, or null when the relationship is empty. */
  async one(path: string, params?: Record<string, string>): Promise<Resource | null> {
    const { data } = await this.document(path, params);
    return Array.isArray(data) ? (data[0] ?? null) : data;
  }

  /** Every resource of a list, page by page. */
  async all(path: string, params?: Record<string, string>): Promise<Resource[]> {
    const out: Resource[] = [];
    let next: string | undefined = path;
    let first = true;
    while (next) {
      const doc: Document = await this.document(next, first ? params : undefined);
      first = false;
      if (Array.isArray(doc.data)) out.push(...doc.data);
      else if (doc.data) out.push(doc.data);
      next = doc.links?.next;
    }
    return out;
  }
}

/** One part of a file upload, as App Store Connect hands it out (`uploadOperations`). */
export interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: { name: string; value: string }[];
}

export const text = (r: Resource | null | undefined, name: string): string | undefined => {
  const value = r?.attributes?.[name];
  return typeof value === "string" ? value : undefined;
};
