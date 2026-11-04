# Store assets for pi-fig

Everything needed to submit pi-fig to the App Store (iPhone and iPad) and Google Play. TestFlight
needs only the build; the rest is for the store listing.

## Contents

| File | Size / limit | Goes to |
|---|---|---|
| `ios/app-icon-1024.png` | 1024 x 1024, no transparency | Built into the app (from `apps/mobile/assets/icon.png`); App Store Connect takes it from the build |
| `ios/screenshots/iphone-6.9/*.png` | 1320 x 2868 (6.9" display, required) | App Store Connect → the version → iPhone screenshots |
| `ios/screenshots/ipad-13/*.png` | 2064 x 2752 (13" display, required for iPad apps) | App Store Connect → the version → iPad screenshots |
| `ios/metadata/name.txt` | 30 characters | App name (must be unique on the App Store) |
| `ios/metadata/subtitle.txt` | 30 | Subtitle |
| `ios/metadata/promotional_text.txt` | 170 | Promotional text (can change without a new build) |
| `ios/metadata/description.txt` | 4,000 | Description |
| `ios/metadata/keywords.txt` | 100, comma-separated | Keywords |
| `ios/metadata/primary_category.txt`, `secondary_category.txt` | | Category |
| `ios/metadata/copyright.txt` | | Copyright |
| `ios/metadata/review_notes.txt` | 4,000 | App Review Information → Notes (explains the demo device) |
| `ios/metadata/testflight_what_to_test.txt` | 4,000 | TestFlight → the build → Test Details → What to Test (walks testers through the demo device) |
| `android/play-icon-512.png` | 512 x 512 | Play Console → Main store listing → App icon |
| `android/feature-graphic-1024x500.png` | 1024 x 500, required | Feature graphic |
| `android/screenshots/phone/*.png` | 1434 x 2868 (at most 2:1) | Phone screenshots |
| `android/screenshots/tablet/*.png` | 2064 x 2752 | 7-inch and 10-inch tablet screenshots |
| `android/metadata/title.txt` | 30 | App name |
| `android/metadata/short_description.txt` | 80 | Short description |
| `android/metadata/full_description.txt` | 4,000 | Full description |
| `android/metadata/category.txt` | | Category (Tools) |
| `website-page.md` | | Privacy (section 1) and Support (section 2), pasted into https://maghen.com/devprojects/pifig/ |
| `ios/metadata/privacy_url.txt`, `support_url.txt` | | Privacy Policy URL and Support URL (both that page) |
| `android/metadata/privacy_url.txt` | | Play Console → App content → Privacy policy |

Icons inside the app (`apps/mobile/assets/`) come from the same script: `icon.png`,
`android-icon-foreground.png`, `android-icon-monochrome.png` and `splash-icon.png`.

## Regenerating

```bash
./store/scripts/make-icons.sh
```

```bash
./store/scripts/make-play-screenshots.sh
```

The App Store screenshots are taken from a Release build in the Simulator (iPhone 17 Pro Max and
iPad Pro 13-inch) with the demo device on, the status bar set to 9:41 with full signal and
battery (`xcrun simctl status_bar booted override ...`), and light mode, saved with
`xcrun simctl io <device> screenshot`, then flattened (App Store Connect rejects images with an
alpha channel):

```bash
for f in store/ios/screenshots/*/*.png; do magick "$f" -background white -alpha remove -alpha off "$f"; done
```

The five shots, in order (taken 2026-11-04, build 7): Application Settings with a change ready
to save, the save's progress and Saved message, Device & Network, the Wi-Fi networks the Pi
sees, and Device Data. They show the demo device, which uses `config-template/config.json`:
retake them when the template's settings or the layout change.

## Building and uploading to TestFlight

Uploads sign in with an App Store Connect API key, not the Apple ID in Xcode. Xcode's sign-in
expires now and then ("missing Xcode-Token"), but the key stays valid until it's revoked. The
key is a team key for every app in the account. Its three values come from the environment
(set in `~/.zshrc`), never from this repository:

```bash
export ASC_KEY_ID="<Key ID>"
export ASC_ISSUER_ID="<Issuer ID>"
export ASC_KEY_PATH="<path to AuthKey_<Key ID>.p8>"
```

Raise `buildNumber` and `versionCode` in `apps/mobile/app.config.ts`, then from `apps/mobile`:

```bash
LANG=en_US.UTF-8 CI=1 npx expo prebuild --clean --platform ios
```

```bash
xcodebuild archive -workspace ios/pifig.xcworkspace -scheme pifig -configuration Release \
  -destination "generic/platform=iOS" -archivePath build/pifig.xcarchive -allowProvisioningUpdates
```

```bash
xcodebuild -exportArchive -archivePath build/pifig.xcarchive -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export -allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID"
```

The build shows up in TestFlight after Apple's processing, usually within 15 minutes. Paste
`ios/metadata/testflight_what_to_test.txt` into the build's Test Details.

To see what App Store Connect has and what a submission still needs, compared with the files
here: `pnpm --filter app-store-connect status` (see
[apps/app-store-connect](../apps/app-store-connect/README.md)).

## Answers App Store Connect will ask for

- **App Privacy:** Data Not Collected. The app has no server, analytics, ads or crash reporting.
- **Age rating:** answer "None" to every question; the result is 4+.
- **Export compliance:** `ITSAppUsesNonExemptEncryption` is `false` in the app, so uploads skip
  the question. The app's encryption only protects the link to the user's own device (SRP-6a and
  AES-GCM); confirm the exemption is right for you.
- **Content rights:** the app shows no third-party content.
- **Price:** Free (assumed).
- **Sign-in required:** No. The review notes explain how to use the demo device.

## Still needed from the owner

- Paste `website-page.md` into https://maghen.com/devprojects/pifig/ and publish it.
- The support link points to https://github.com/AlexMaghen/pi-configurator, which doesn't exist
  yet (the repo has no remote). Create it under that name, or change the link, before the page
  goes live; it must be public before the store listing is.
- Check "pi-fig" is available as an App Store name when creating the app record. If not, try
  "pi-fig: Pi Setup".
- The demo device's name in the screenshots is "BallsPi", and its settings are BallsPi's until
  the template is made generic.
- "Raspberry Pi" appears in the description and keywords. The description says pi-fig is not
  affiliated with Raspberry Pi Ltd; keep that line.
