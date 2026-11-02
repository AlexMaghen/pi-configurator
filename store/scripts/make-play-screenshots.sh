#!/usr/bin/env bash
# Makes the Google Play screenshots from the App Store ones in store/ios/screenshots/.
#
#   ./store/scripts/make-play-screenshots.sh
#
# Play allows at most 2:1 (long side / short side). The 6.9" iPhone shots are 1320x2868 (2.17:1),
# so they are padded left and right with the app's background colour to 1434x2868. The 13" iPad
# shots (2064x2752) already fit and are copied as tablet screenshots.
# Needs ImageMagick 7 (`brew install imagemagick`).
set -euo pipefail

STORE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHONE_IN="$STORE/ios/screenshots/iphone-6.9"
TABLET_IN="$STORE/ios/screenshots/ipad-13"
PHONE_OUT="$STORE/android/screenshots/phone"
TABLET_OUT="$STORE/android/screenshots/tablet"
mkdir -p "$PHONE_OUT" "$TABLET_OUT"

# Light-theme `background` from apps/mobile/src/theme/colors.ts.
BACKGROUND="#F2F2F7"

for f in "$PHONE_IN"/*.png; do
  h=$(magick identify -format "%h" "$f")
  w=$((h / 2))
  magick "$f" -background "$BACKGROUND" -gravity center -extent "${w}x${h}" -alpha off \
    "$PHONE_OUT/$(basename "$f")"
done

for f in "$TABLET_IN"/*.png; do
  magick "$f" -alpha off "$TABLET_OUT/$(basename "$f")"
done

echo "Play screenshots written to $PHONE_OUT and $TABLET_OUT"
