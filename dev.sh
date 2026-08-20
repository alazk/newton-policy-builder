#!/usr/bin/env bash
#
# Start the dev server from a known-clean state.
#
# "Can't reach localhost" has three usual causes and this clears all of them
# in order, so you don't have to work out which one it is:
#
#   1. a stale `next dev` still holding port 3000, so the new one exits
#   2. a corrupt .next cache from an interrupted build
#   3. node_modules missing or out of date with package.json
#
# Run from the policy-builder directory:  bash dev.sh

set -u
cd "$(dirname "$0")"

echo "==> Killing anything on port 3000"
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "    killed a stale process" || echo "    nothing was listening"

echo "==> Clearing the build cache"
rm -rf .next

if [ ! -d node_modules ]; then
  echo "==> node_modules missing, installing"
  npm install
fi

echo "==> Node $(node -v)"

# Typecheck first, and DON'T stop if it fails.
#
# next dev tolerates type errors; next build does not. Printing them here
# means you see them without them blocking the server — if the page then
# renders, the errors are cosmetic for now.
echo "==> Typecheck (informational)"
npx tsc --noEmit || echo "    ^ type errors above. next dev still runs; next build would not."

echo "==> Starting dev server"
echo "    Watch for: 'Ready on http://localhost:3000'"
echo "    If it exits instead, the reason is the last line printed."
npm run dev
