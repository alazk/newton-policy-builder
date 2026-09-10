#!/usr/bin/env bash
#
# Poll the yente path until Newton's backend ingests the policy CID.
#
#   bash policy/watch-yente.sh            # every 5 min, until it resolves
#   bash policy/watch-yente.sh 60         # every 60s
#
# No gas, no chain writes — just a submit against the already-bound yente
# client. Prints a line each check; when the "not found in persisted immutable
# data backend" error finally clears, it beeps, says so, and exits 0 so you can
# chain the switch after it.
#
# The client 0x7497… is bound to policy 0x990A6E4f (cid bafkreidos2…), so this
# hits the exact object that has been failing. When it flips:
#
#   1. providers: ["yente"] in lib/catalog.ts
#   2. restore the live-feed copy at the markers in Wizard.tsx + layout.tsx
#   3. bash deploy.sh "Switch to live yente oracle"
#   4. verify clean=Compliant, sanctioned=Non Compliant on the live site
#
# See ../STATUS.md.

APP="https://newton-policy-builder.vercel.app"
SANCTIONED="0x175d44451403edf28469df03a9280c1197adb92c"
INTERVAL="${1:-300}"

check() {
  curl -sS -X POST "$APP/api/evaluate" \
    -H 'content-type: application/json' \
    -d "{\"mode\":\"submit\",\"providerId\":\"yente\",\"to\":\"$SANCTIONED\",\"policyDataAddress\":\"x\"}" \
    | python3 -c '
import sys, json
try:
    r = json.load(sys.stdin).get("result") or {}
except Exception:
    print("BADRESP"); sys.exit(0)
e = r.get("error")
if e and "not found" in e:
    print("WAIT")
elif e:
    print("ERR:" + e[:80])
else:
    tr = r.get("task_response") or {}
    ev = tr.get("evaluation_result") or []
    print("RESOLVED" if ev and ev[-1] == 0 else "RESOLVED_BUT_ALLOWED")
'
}

echo "Watching yente ingestion every ${INTERVAL}s. Ctrl-C to stop."
while true; do
  ts="$(date '+%H:%M:%S')"
  status="$(check)"
  case "$status" in
    WAIT)
      echo "$ts  still not ingested" ;;
    RESOLVED)
      printf '\a'
      echo "$ts  RESOLVED — sanctioned address DENIED. Backend has recovered."
      echo "Next: flip providers to yente and deploy. See STATUS.md."
      exit 0 ;;
    RESOLVED_BUT_ALLOWED)
      printf '\a'
      echo "$ts  CID resolves, but a SANCTIONED address came back ALLOWED."
      echo "Do NOT switch. The oracle data path may be wrong — check STATUS.md."
      exit 1 ;;
    ERR:*)
      echo "$ts  ${status#ERR:}" ;;
    *)
      echo "$ts  unexpected response, retrying" ;;
  esac
  sleep "$INTERVAL"
done
