#!/usr/bin/env bash
# Draws the pi-fig app icon (the chip from apps/mobile/src/components/Icon.tsx) at every size the
# stores and the Expo build need, and writes them into apps/mobile/assets/ and store/.
#
#   ./store/scripts/make-icons.sh
#
# Needs ImageMagick 7 (`brew install imagemagick`). Each image is drawn at 4x and scaled down, so
# edges are smooth. Run it again after changing a colour or size below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ASSETS="$ROOT/apps/mobile/assets"
IOS="$ROOT/store/ios"
ANDROID="$ROOT/store/android"
mkdir -p "$IOS" "$ANDROID"

# Same blue as `accent` in apps/mobile/src/theme/colors.ts (light theme).
BLUE="#0A66D8"
WHITE="#FFFFFF"
SS=4 # supersampling factor

# chip_draw SCALE CX CY -> the magick -draw primitives for the chip.
# The chip is drawn on Icon.tsx's 24x24 grid (centre 12,12), SCALE pixels per grid unit, centred
# on CX,CY; stroke width 2 units with round caps, like the in-app icon.
chip_draw() {
  local k=$1 cx=$2 cy=$3
  awk -v k="$k" -v cx="$cx" -v cy="$cy" '
  function X(u) { return cx + (u - 12) * k }
  function Y(u) { return cy + (u - 12) * k }
  BEGIN {
    printf "stroke-linecap round stroke-linejoin round "
    printf "roundrectangle %.2f,%.2f %.2f,%.2f %.2f,%.2f ", X(4), Y(4), X(20), Y(20), 2 * k, 2 * k
    printf "rectangle %.2f,%.2f %.2f,%.2f ", X(9), Y(9), X(15), Y(15)
    # pins: top, bottom, right, left
    printf "line %.2f,%.2f %.2f,%.2f ", X(9), Y(1), X(9), Y(4)
    printf "line %.2f,%.2f %.2f,%.2f ", X(15), Y(1), X(15), Y(4)
    printf "line %.2f,%.2f %.2f,%.2f ", X(9), Y(20), X(9), Y(23)
    printf "line %.2f,%.2f %.2f,%.2f ", X(15), Y(20), X(15), Y(23)
    printf "line %.2f,%.2f %.2f,%.2f ", X(20), Y(9), X(23), Y(9)
    printf "line %.2f,%.2f %.2f,%.2f ", X(20), Y(14), X(23), Y(14)
    printf "line %.2f,%.2f %.2f,%.2f ", X(1), Y(9), X(4), Y(9)
    printf "line %.2f,%.2f %.2f,%.2f", X(1), Y(14), X(4), Y(14)
  }'
}

# draw OUT SIZE BACKGROUND COLOR UNITS_FRACTION
# Draws the chip centred on a square SIZE canvas. FRACTION is the share of the canvas width the
# chip (22 grid units, pin tip to pin tip) spans. BACKGROUND "none" keeps transparency.
draw() {
  local out=$1 size=$2 bg=$3 color=$4 fraction=$5
  local big=$((size * SS))
  local k
  k=$(awk -v b="$big" -v f="$fraction" 'BEGIN { printf "%.4f", b * f / 22 }')
  magick -size "${big}x${big}" "xc:$bg" -fill none -stroke "$color" \
    -strokewidth "$(awk -v k="$k" 'BEGIN { print 2 * k }')" \
    -draw "$(chip_draw "$k" $((big / 2)) $((big / 2)))" -resize "${size}x${size}" "$out"
}

# --- iOS -------------------------------------------------------------------------------------
# App icon: 1024x1024, no transparency (Apple rejects alpha); iOS rounds the corners itself.
draw "$ASSETS/icon.png" 1024 "$WHITE" "$BLUE" 0.56
magick "$ASSETS/icon.png" -background "$WHITE" -alpha remove -alpha off "$ASSETS/icon.png"
cp "$ASSETS/icon.png" "$IOS/app-icon-1024.png"

# --- Android -------------------------------------------------------------------------------
# Adaptive icon foreground: the launcher masks a 1024 canvas to its middle ~66%, so the chip is
# kept small. The background is a plain colour set in app.config.ts.
draw "$ASSETS/android-icon-foreground.png" 1024 none "$BLUE" 0.40
# Monochrome (Android 13+ themed icons): only the shape's alpha is used.
draw "$ASSETS/android-icon-monochrome.png" 1024 none "#000000" 0.40
# Google Play listing icon: 512x512, full square (Play rounds it).
draw "$ANDROID/play-icon-512.png" 512 "$WHITE" "$BLUE" 0.56
magick "$ANDROID/play-icon-512.png" -alpha off "$ANDROID/play-icon-512.png"

# Splash image (chip only, transparent), kept for a future splash screen.
draw "$ASSETS/splash-icon.png" 512 none "$BLUE" 0.9

# Google Play feature graphic: 1024x500, required. Chip on the left, name and tagline on the right.
FONT_BOLD="/System/Library/Fonts/HelveticaNeue.ttc"
fg_big_w=$((1024 * SS))
fg_big_h=$((500 * SS))
k=$(awk -v h="$fg_big_h" 'BEGIN { printf "%.4f", h * 0.56 / 22 }')
magick -size "${fg_big_w}x${fg_big_h}" "xc:$WHITE" -fill none -stroke "$BLUE" \
  -strokewidth "$(awk -v k="$k" 'BEGIN { print 2 * k }')" \
  -draw "$(chip_draw "$k" $((fg_big_h / 2 + 40 * SS)) $((fg_big_h / 2)))" \
  -stroke none -fill "#111827" -font "$FONT_BOLD" -pointsize $((96 * SS)) \
  -annotate "+$((540 * SS))+$((235 * SS))" "pi-fig" \
  -fill "#4B5563" -pointsize $((36 * SS)) \
  -annotate "+$((544 * SS))+$((300 * SS))" "Set up Raspberry Pi" \
  -annotate "+$((544 * SS))+$((346 * SS))" "devices over Bluetooth" \
  -resize 1024x500 -alpha off "$ANDROID/feature-graphic-1024x500.png"

rm -f "$ASSETS/android-icon-background.png"
echo "Icons written to $ASSETS, $IOS and $ANDROID"
