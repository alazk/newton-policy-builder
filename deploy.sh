#!/usr/bin/env bash
#
# Ship to Vercel, refusing to ship something broken.
#
#   bash deploy.sh
#
# The order matters. `next dev` tolerates type errors; `next build` does not,
# so a session's worth of edits can run fine locally and still fail in CI. The
# build runs here first — locally, where the error is readable — rather than
# being discovered in a Vercel log five minutes later.

set -euo pipefail
cd "$(dirname "$0")"

echo "==> Checking nothing secret is staged"
if git status --porcelain | grep -qE '\.env(\.|$)'; then
  echo "STOP — a .env file is about to be committed."
  git status --porcelain | grep -E '\.env(\.|$)'
  echo "These hold your private keys and API key. Add them to .gitignore first."
  exit 1
fi
echo "    clean"

echo "==> Typecheck"
npx tsc --noEmit

echo "==> Production build (this is what Vercel runs)"
npm run build

echo "==> Committing"
git add -A
git status --short
git commit -m "Shared on-chain run history, uniform spacing scale, verdict fail-closed" || echo "    nothing to commit"
git push

# Why not just rely on the push:
#
# The project has no domain alias attached, so a git push deploys to a fresh
# preview URL and leaves newton-policy-builder.vercel.app pointing at whatever
# was there before. That has cost several rounds of "it's still the old one".
# --prod is what moves the alias.
echo "==> Promoting to production"
npx vercel --prod
