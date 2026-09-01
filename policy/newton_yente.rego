# NOT THE SOURCE. Do not edit, do not deploy.
#
# The deployable file is:
#
#   ../sanctions-oracle/yente-policy-files/policy.rego
#
# which sits next to the params schema, the metadata and the policy.wasm that
# `newton-cli policy deploy -p` reads. That directory is the policy; this was a
# transcription made before I knew it existed.
#
# Keeping a second copy here is how generated-policy.rego happened — a file
# that claimed to be the deployed policy, drifted, and was still sitting in the
# repo months later being diffed against the explorer. One copy, in the
# directory that deploys it.
#
# `node policy/check.mjs` reads the real file at the path above and diffs it
# against the bytes pinned on chain. That is the check; this file is a
# signpost.
#
# The correction being deployed — inverting the confidence gate so a confirmed
# hit with an absent match_score denies rather than allows — is marked in the
# real file, and measured in policy/gate_test.py.
