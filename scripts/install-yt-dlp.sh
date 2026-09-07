#!/usr/bin/env bash
# Downloads the yt-dlp binary directly from its official GitHub release into bin/yt-dlp - no
# Python/pip required, since Render's Node.js build image doesn't reliably have either (that was
# the actual cause of the previous pip-based approach failing in production: "Binary yt-dlp tidak
# ditemukan di PATH server").
#
# Runs relative to wherever it's invoked from - `npm run build` always runs from the project
# root, so this always lands at <project root>/bin/yt-dlp, matching YT_DLP_LOCAL_PATH in
# server.ts's resolveYtDlpBinary() and scripts/live-intel-watcher.ts's equivalent.
#
# Best-effort by design: this script ALWAYS exits 0, even on total failure (no curl/wget, network
# down, bad download). A network hiccup during build must never fail the actual app build - if
# this download doesn't happen, resolveYtDlpBinary() falls back to a bare "yt-dlp" PATH lookup
# (which still works in local dev / the GitHub Actions watcher workflow, both of which already
# install yt-dlp onto PATH themselves), and the fetch-youtube-transcript endpoint already reports
# a clear "not installed" error to the admin instead of crashing.
set -uo pipefail

BIN_DIR="bin"
BIN_PATH="$BIN_DIR/yt-dlp"
URL="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"

mkdir -p "$BIN_DIR"

download_ok=1
if command -v curl >/dev/null 2>&1; then
  # "latest" is resolved fresh by GitHub on every request (not something curl itself caches
  # locally) - the no-cache headers below are belt-and-suspenders against any caching proxy that
  # might otherwise sit between this build and GitHub, so every build genuinely gets whatever
  # yt-dlp release is newest right now, never a stale one.
  if curl -fsSL -H "Cache-Control: no-cache" -H "Pragma: no-cache" -o "$BIN_PATH" "$URL"; then
    download_ok=0
  fi
elif command -v wget >/dev/null 2>&1; then
  if wget -q --header="Cache-Control: no-cache" --header="Pragma: no-cache" -O "$BIN_PATH" "$URL"; then
    download_ok=0
  fi
else
  echo "[install-yt-dlp] Neither curl nor wget is available - skipping yt-dlp download."
fi

if [ "$download_ok" -ne 0 ] || [ ! -s "$BIN_PATH" ]; then
  echo "[install-yt-dlp] yt-dlp download failed or produced an empty file - skipping. The admin \"Ambil Transkrip dari Link YouTube\" feature will be unavailable until yt-dlp is installed on this server manually. Everything else still deploys normally."
  rm -f "$BIN_PATH"
  exit 0
fi

chmod +x "$BIN_PATH"

if "$BIN_PATH" --version >/dev/null 2>&1; then
  echo "[install-yt-dlp] yt-dlp installed successfully at $BIN_PATH (version: $("$BIN_PATH" --version))"
else
  echo "[install-yt-dlp] Downloaded binary at $BIN_PATH did not run correctly - removing it. The admin YouTube-transcript feature will be unavailable until yt-dlp is installed on this server manually."
  rm -f "$BIN_PATH"
fi

exit 0
