#!/usr/bin/env bash
#
# Ship to Vercel, refusing to ship something broken.
#
#   bash deploy.sh "commit message"
#
# The message is the one argument. It used to be hardcoded, which meant every
# deploy carried the subject line of whatever change happened to be in flight
# the day the script was written — a log where every entry says the same thing
# is a log nobody reads.
#
# The order matters. `next dev` tolerates type errors; `next build` does not,
# so a session's worth of edits can run fine locally and still fail in CI. The
# build runs here first — locally, where the error is readable — rather than
# being discovered in a Vercel log five minutes later.

set -euo pipefail
cd "$(dirname "$0")"

MSG="${1:-}"
if [ -z "$MSG" ]; then
  echo "Usage: bash deploy.sh \"what changed\""
  exit 1
fi

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
git commit -m "$MSG" || echo "    nothing to commit"

# --rebase, because the remote has picked up commits behind our back before
# (the case-study branch) and a plain push just gets rejected after the build
# has already run.
git pull --rebase
git push

# Why not just rely on the push:
#
# The project has no domain alias attached, so a git push deploys to a fresh
# preview URL and leaves newton-policy-builder.vercel.app pointing at whatever
# was there before. That has cost several rounds of "it's still the old one".
# --prod is what moves the alias.
echo "==> Promoting to production"
npx vercel --prod
