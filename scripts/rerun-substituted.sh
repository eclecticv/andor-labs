#!/usr/bin/env bash
#
# Re-run the five companies that were judged by a substituted panel.
#
# Found 2026-08-14: the open provider ladder let other labs answer in a failed
# seat, so these five were scored by a different jury than the other eighteen —
#   playwire, tvscientific, pixalate  — GLM 5.3 (Zhipu) in DeepSeek's seat
#   freestar                          — Qwen 3.8 Max (Alibaba) in DeepSeek's seat
#   chalice                           — Gemini 3.5 Flash in Flash Lite's seat
# The seats are now pinned (providers.ts `only`), so a re-run either seats the
# declared panel or fails cleanly.
#
# DESTRUCTIVE: deletes the five published rows before re-ranking. Run by hand,
# one step at a time. Each re-rank costs 4 model calls (~60-90s).
#
#   set -a; . ./.dev.vars; set +a
#   ./scripts/rerun-substituted.sh delete     # take the five rows down
#   ./scripts/rerun-substituted.sh rank       # re-run each through the pinned panel
#
set -euo pipefail
cd "$(dirname "$0")/.."

SLUGS=(playwire tvscientific pixalate freestar chalice)
DOMAINS=(playwire.com tvscientific.com pixalate.com freestar.com chalice.ai)

case "${1:-}" in
  delete)
    # ranking + juror_take cascade off company.
    SQL=""
    for s in "${SLUGS[@]}"; do SQL+="DELETE FROM company WHERE slug = '$s';"; done
    echo "$SQL" | npx wrangler d1 execute andor-rankings -c d1.wrangler.jsonc --remote --command "$SQL" -y
    ;;
  rank)
    for d in "${DOMAINS[@]}"; do
      echo "── $d ──────────────────────────────" >&2
      npx tsx scripts/rank-local.mts "$d" > "/tmp/rerun-$d.sql"
      grep -v '^\[rank\]' "/tmp/rerun-$d.sql" > "/tmp/rerun-$d-clean.sql"
      npx wrangler d1 execute andor-rankings -c d1.wrangler.jsonc --remote \
        --file "/tmp/rerun-$d-clean.sql" -y
    done
    echo "Done. Redeploy (push main) so the static pages rebuild from D1." >&2
    ;;
  *)
    echo "usage: $0 delete|rank" >&2; exit 1 ;;
esac
