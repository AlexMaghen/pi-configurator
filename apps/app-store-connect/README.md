# app-store-connect

Compares an app's App Store Connect record with the listing kept in the repository
(`store/ios/metadata/*.txt` and `store/ios/screenshots/`), and sends that listing.

```bash
pnpm --filter app-store-connect status
```

`status` only reads, and lists what an App Review submission still needs.

```bash
pnpm --filter app-store-connect push
```

`push` sends the listing to the version being prepared:
- App Information: name, subtitle, privacy URL, categories, and the age rating with "no" to
  every question;
- the version: description, keywords, promotional text, support URL, copyright, manual
  release, and the newest processed build;
- the App Review notes, with no sign-in required;
- screenshots, but only into sets that are still empty;
- the newest build's What to Test;
- price (free) and availability (every country or region), if they aren't set yet.

It never submits for review, and it doesn't set the App Review contact. Running it again is safe.

Other apps: `bun src/main.ts status --bundle-id com.example.app --store-dir /path/to/store`.
`--json` prints everything it read.

## The API key

It signs in with an App Store Connect API team key (Users and Access → Integrations → App Store
Connect API), not an Apple ID. Three environment variables, set in `~/.zshrc`:

| Variable | Value |
|---|---|
| `ASC_KEY_ID` | The key's Key ID (also in its file name) |
| `ASC_ISSUER_ID` | The Issuer ID shown above the key list |
| `ASC_KEY_PATH` | The `AuthKey_<Key ID>.p8` file; defaults to `~/.appstoreconnect/private_keys/` |

The `.p8` file is the secret: keep it out of every repository.

## What it can't see

App Privacy (the privacy "nutrition label") isn't in the API, so the report always says to
check it on the website.
