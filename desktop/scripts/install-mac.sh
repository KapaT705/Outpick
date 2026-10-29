#!/bin/zsh
# Собирает текущий код в macOS-приложение и подменяет им «Dota Mid Helper» в /Applications (для теста на маке
# до релиза: в GitHub уходит только одобренное). Снимает карантин, перезапускает программу.
set -e
cd "$(dirname "$0")/.."
npm run build:mac > /tmp/dmh-build-mac.log 2>&1 || { tail -20 /tmp/dmh-build-mac.log; exit 1; }
APP="dist/mac-arm64/Dota Mid Helper.app"
[ -d "$APP" ] || { echo "сборка не найдена: $APP"; exit 1; }
pkill -f "/Applications/Dota Mid Helper.app/Contents/MacOS" || true
sleep 2
rm -rf "/Applications/Dota Mid Helper.app"
cp -R "$APP" /Applications/
rm -rf dist/mac-arm64
xattr -cr "/Applications/Dota Mid Helper.app"
open "/Applications/Dota Mid Helper.app"
echo "установлено и запущено: $(defaults read '/Applications/Dota Mid Helper.app/Contents/Info.plist' CFBundleShortVersionString) ($(git -C .. rev-parse --short HEAD))"
