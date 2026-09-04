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

# Only main goes to production.
#
# This script ends in `vercel --prod`, which moves the alias. Run it from an
# experiment branch and the live demo becomes whatever you were mid-way through
# trying — with no warning, because every step before it succeeds normally.
#
# Off main it still commits, pushes and builds; it just deploys to a preview
# URL instead of promoting. Which is what you want from a branch anyway: a
# link to look at that nobody else is pointed at.
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
PROMOTE=1
if [ "$BRANCH" != "main" ]; then
  PROMOTE=0
  echo "==> On branch '$BRANCH' — preview deploy, production alias untouched"
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
#
# Only when there IS an upstream. A branch pushed for the first time has none,
# and `git pull --rebase` then exits non-zero — which under `set -e` killed
# this script after it had already committed, leaving the branch built and
# committed but never deployed.
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git pull --rebase
else
  echo "    no upstream yet — first push of '$BRANCH'"
fi

git push -u origin "$BRANCH"

# Why not just rely on the push:
#
# The project has no domain alias attached, so a git push deploys to a fresh
# preview URL and leaves newton-policy-builder.vercel.app pointing at whatever
# was there before. That has cost several rounds of "it's still the old one".
# --prod is what moves the alias.
if [ "$PROMOTE" = "1" ]; then
  echo "==> Promoting to production"
  npx vercel --prod
else
  echo "==> Preview deploy (branch '$BRANCH')"
  npx vercel
  echo
  echo "    newton-policy-builder.vercel.app is unchanged."
  echo "    Merge to main and run this again to promote."
fi
