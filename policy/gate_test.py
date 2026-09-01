"""
Does inverting the confidence gate actually close the hole?

    pip install regopy --break-system-packages
    python3 policy/gate_test.py

Runs the deployed rule and the corrected rule side by side over six inputs.
Case C is the one that matters: a CONFIRMED sanctioned match whose
`match_score` key is absent. The deployed policy ALLOWS it, with an empty deny
set — no reason recorded anywhere.

Case D (`match_score: null`) denies on both, because null orders below every
number so the comparison stays defined. That is engine-defined behaviour and
Newton runs a Regorus fork, not the engine this measures on, so do not read it
as a guarantee. The corrected form denies regardless, which is the point.

Only the gate rules differ between the two programs. The five assertions, the
seven denies and `allow if count(deny) == 0` are byte-identical, so any
difference in verdict is attributable to the gate and nothing else.

Engine is rego-cpp (regopy). It is a different partial implementation from
Regorus, so this proves the LOGIC, not the deployment. The deployment check is
newton-cli against the real thing — see policy/DEPLOY.md.

A note on the harness itself, which bit once already: an unparseable module
makes every rule undefined, which makes every negated deny fire, which denies
everything — and a policy that denies everything looks exactly like a policy
screening correctly. So case A (both parties clean) must come back ALLOW. If
it does not, the harness is broken, not the policy, and the run aborts.
"""

import json
import sys

from regopy import Interpreter

COMMON_HEAD = """
package t

import future.keywords.contains
import future.keywords.if
import future.keywords.in

default allow := false

yente_ok if data.wasm.status == 200
payee_screened if data.wasm.to.screened == true
payer_screened if data.wasm.from.screened == true
payee_address_matches if lower(data.wasm.to.address) == lower(input.to)
payer_address_matches if lower(data.wasm.from.address) == lower(input.from)

default min_score := 0
min_score := data.params.min_match_score if is_number(data.params.min_match_score)
"""

# As deployed. The gate is a positive condition inside the hit rule, so an
# undefined match_score makes the body undefined and no deny fires.
DEPLOYED_GATE = """
payee_hit if {
	data.wasm.to.sanctioned == true
	data.wasm.to.match_score >= min_score
}

payer_hit if {
	data.wasm.from.sanctioned == true
	data.wasm.from.match_score >= min_score
}
"""

# Corrected. The gate is its own rule that must be positively true to suppress
# the deny, so undefined denies — like every other rule in the file.
CORRECTED_GATE = """
payee_match_too_weak if data.wasm.to.match_score < min_score
payer_match_too_weak if data.wasm.from.match_score < min_score

payee_hit if {
	data.wasm.to.sanctioned == true
	not payee_match_too_weak
}

payer_hit if {
	data.wasm.from.sanctioned == true
	not payer_match_too_weak
}
"""

COMMON_TAIL = """
deny contains "screening_unavailable" if not yente_ok
deny contains "payee_not_screened" if not payee_screened
deny contains "payer_not_screened" if not payer_screened
deny contains "payee_address_mismatch" if not payee_address_matches
deny contains "payer_address_mismatch" if not payer_address_matches
deny contains "payee_sanctioned" if payee_hit
deny contains "payer_sanctioned" if payer_hit

allow if count(deny) == 0
"""

TO = "0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c"
FROM = "0x1111111111111111111111111111111111111111"

OMIT = object()


def party(addr, sanctioned=False, score=OMIT):
    p = {
        "address": addr,
        "screened": True,
        "sanctioned": sanctioned,
        "datasets": ["us_ofac_sdn"] if sanctioned else [],
    }
    if score is not OMIT:
        p["match_score"] = score
    return p


def world(to_party, params=None):
    return {
        "wasm": {"status": 200, "to": to_party, "from": party(FROM, False, 0.0)},
        "params": params or {},
    }


CASES = [
    ("A  both clean", world(party(TO, False, 0.0)), "allow"),
    ("B  payee sanctioned, score 0.99, no threshold", world(party(TO, True, 0.99)), "deny"),
    ("C  payee sanctioned, match_score ABSENT", world(party(TO, True)), "deny"),
    ("D  payee sanctioned, match_score null", world(party(TO, True, None)), "deny"),
    (
        "E  weak hit 0.40 under threshold 0.80 (gate should suppress)",
        world(party(TO, True, 0.40), {"min_match_score": 0.80}),
        "allow",
    ),
    (
        "F  strong hit 0.90 over threshold 0.80",
        world(party(TO, True, 0.90), {"min_match_score": 0.80}),
        "deny",
    ),
]


def run(policy, data):
    rego = Interpreter()
    rego.add_module("t", policy)
    rego.add_data_json(json.dumps(data))
    rego.set_input_term(json.dumps({"to": TO, "from": FROM}))
    doc = json.loads(str(rego.query("data.t")))["expressions"][0]
    return bool(doc.get("allow")), sorted(doc.get("deny") or [])


deployed = COMMON_HEAD + DEPLOYED_GATE + COMMON_TAIL
corrected = COMMON_HEAD + CORRECTED_GATE + COMMON_TAIL

# Harness self-check before trusting a single verdict below.
for label, prog in (("deployed", deployed), ("corrected", corrected)):
    ok, why = run(prog, CASES[0][1])
    if not ok:
        print(f"HARNESS BROKEN: the {label} program denies two clean parties.")
        print(f"denies: {why}")
        print("Every rule undefined looks identical to every rule working. Fix this first.")
        sys.exit(1)

print(f"{'case':<60} {'deployed':<10} {'corrected':<10} expected")
print("-" * 100)

wrong = 0
for name, data, expected in CASES:
    dep_ok, dep_why = run(deployed, data)
    cor_ok, cor_why = run(corrected, data)
    dep = "allow" if dep_ok else "deny"
    cor = "allow" if cor_ok else "deny"

    note = ""
    if cor != expected:
        note = "   <-- CORRECTED IS WRONG"
        wrong += 1
    elif dep != expected:
        note = "   <-- deployed wrong, correction fixes it"

    print(f"{name:<60} {dep:<10} {cor:<10} {expected}{note}")
    if dep != cor:
        print(f"{'':<60} deployed:  {dep_why or '(nothing)'}")
        print(f"{'':<60} corrected: {cor_why or '(nothing)'}")

print()
print("FAILED" if wrong else "Every corrected verdict matches expectation.")
sys.exit(1 if wrong else 0)
