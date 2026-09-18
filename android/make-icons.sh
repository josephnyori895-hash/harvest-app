#!/bin/bash
# Generates all launcher icons + splash screens from the SVG artwork.
# Requires ImageMagick 7 (magick).
set -e
cd "$(dirname "$0")"

FG=artwork/icon-foreground.svg
LG=artwork/icon-legacy.svg
PURPLE='#7C3AED'
RES=app/src/main/res

# Adaptive icon foregrounds (108dp buckets: mdpi 108 → xxxhdpi 432)
for pair in mdpi:108 hdpi:162 xhdpi:216 xxhdpi:324 xxxhdpi:432; do
  d=${pair%%:*}; F=${pair##*:}
  magick -background none "$FG" -resize "${F}x${F}" "$RES/mipmap-$d/ic_launcher_foreground.png"
done

# Legacy launcher icons (48dp buckets) — purple square + HF monogram
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; S=${pair##*:}
  magick -background "$PURPLE" "$LG" -resize "${S}x${S}" "$RES/mipmap-$d/ic_launcher.png"
  # Round variant: purple circle + gold HF drawn directly (alpha preserved)
  magick -size "${S}x${S}" xc:none -fill "$PURPLE" \
    -draw "circle $((S/2)),$((S/2)) $((S/2)),0" \
    -font "$FONT" -pointsize $((S*5/8)) -fill '#FCD34D' -gravity center \
    -annotate +0+0 "HF" "$RES/mipmap-$d/ic_launcher_round.png"
done

# Splash screens — exact per-bucket dimensions (Capacitor defaults)
SPLASHES="\
drawable:480x320\
 drawable-land-mdpi:480x320\
 drawable-land-hdpi:800x480\
 drawable-land-xhdpi:1280x720\
 drawable-land-xxhdpi:1600x960\
 drawable-land-xxxhdpi:1920x1280\
 drawable-port-mdpi:320x480\
 drawable-port-hdpi:480x800\
 drawable-port-xhdpi:720x1280\
 drawable-port-xxhdpi:960x1600\
 drawable-port-xxxhdpi:1280x1920"
for item in $SPLASHES; do
  dir=${item%%:*}; dim=${item##*:}
  W=${dim%x*}; H=${dim#*x}
  magick -size "${W}x${H}" xc:"$PURPLE" \
    \( "$FG" -resize "x$((H/3))" \) -gravity center -compose over -composite \
    "$RES/$dir/splash.png"
done

echo "Icons and splash generated."
