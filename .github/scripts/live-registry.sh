#!/usr/bin/env bash
# يسجّل عنوان الخادم التجريبي الحالي في .live/server.json على هذا الفرع (التزام بواسطة GITHUB_TOKEN)
# الاستعمال: live-registry.sh up <url> [minutes] | live-registry.sh down
set -euo pipefail
STATUS="$1"; URL="${2:-}"; MINUTES="${3:-300}"
REPO="${GITHUB_REPOSITORY}"; BRANCH="${GITHUB_REF_NAME}"; FILE=".live/server.json"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if [ "$STATUS" = "up" ]; then
  START="$NOW"; EXP="$(date -u -d "+${MINUTES} minutes" +%Y-%m-%dT%H:%M:%SZ)"
else
  START="null"; EXP="null"; URL=""
fi
RUN_URL="${GITHUB_SERVER_URL}/${REPO}/actions/runs/${GITHUB_RUN_ID}"
JSON="$(node -e '
  const [status, url, startedAt, expiresAt, runUrl] = process.argv.slice(1);
  const nul = v => (v === "null" || v === "" ? null : v);
  console.log(JSON.stringify({ status, url: nul(url), startedAt: nul(startedAt), expiresAt: nul(expiresAt), runUrl,
    note: "يكتبه تشغيل live-server تلقائياً: العنوان الحالي للخادم التجريبي (يتغيّر مع كل تشغيل)" }, null, 2));
' "$STATUS" "$URL" "$START" "$EXP" "$RUN_URL")"
CONTENT="$(printf '%s\n' "$JSON" | base64 -w0)"
MSG="live: server ${STATUS}${URL:+ ${URL}}"
for attempt in 1 2 3; do
  SHA="$(gh api "repos/${REPO}/contents/${FILE}?ref=${BRANCH}" --jq .sha 2>/dev/null || true)"
  ARGS=(-X PUT "repos/${REPO}/contents/${FILE}" -f message="$MSG" -f content="$CONTENT" -f branch="$BRANCH")
  [ -n "$SHA" ] && ARGS+=(-f sha="$SHA")
  if gh api "${ARGS[@]}" > /dev/null; then echo "سُجّل في المستودع: ${STATUS} ${URL}"; exit 0; fi
  sleep $((attempt * 4))
done
echo "تعذّر تسجيل العنوان في المستودع (يبقى في التعليق والملخّص)"
exit 0
