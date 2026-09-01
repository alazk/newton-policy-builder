#!/usr/bin/env bash
#
# Replaced by policy/check.mjs.
#
# This version read the chain through /api/policy-source, which meant the dev
# server had to be running to answer a question about a contract. It is not a
# dependency the question has. check.mjs talks to the RPC directly through
# viem, which is already installed, and gets keccak256 from viem too — so no
# python and no pip install either.
#
# Kept as a redirect rather than deleted, because it is the filename in the
# earlier runbook and in your shell history.

echo "Use: node policy/check.mjs           (before)"
echo "     node policy/check.mjs --after   (after)"
echo
echo "No dev server needed — it reads Sepolia directly."
exit 1
