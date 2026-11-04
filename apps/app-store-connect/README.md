# app-store-connect

Shows what an app's App Store Connect record has, and what an App Review submission still
needs, compared with the listing kept in the repository (`store/ios/metadata/*.txt` and
`store/ios/screenshots/`). It only reads; it changes nothing in App Store Connect.

```bash
pnpm --filter app-store-connect status
```

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
