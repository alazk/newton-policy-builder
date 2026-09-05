# Enforcing Sanctions Controls in a DeFi Rewards Program

_A case study in screening reward recipients against a sanctions list and
verifiably enforcing the result before the claim executes._

In this case study we show how Newton lets a project screen reward recipients
against a published sanctions list and enforce the result on-chain — with a
verifiable attestation — before any tokens move.

## 01 — The challenge

A project distributes tokens to eligible users through a smart contract. The
distribution contract has no built-in way to screen recipients for sanctions
compliance. Regulators expect any distribution to comply with applicable
sanctions, and the requirement is one line: do not send rewards to sanctioned
wallets.

The distribution contract was built to answer a different question, and the
team has no appetite for standing up the compliance stack of an exchange. What's
missing is a way to have a sanctions rule enforced by the contract itself,
before any tokens are sent.

## 02 — The control gap

The sanctions list lives off the payout path. The payout happens on-chain.
Nothing currently connects the two at the moment the payout is decided.

## 03 — The solution

A Newton Policy brings the sanctions rule and the sanctions list together and
enforces them at the moment of the claim. Every distribution is checked against
a published list of designated addresses, and the verdict is proven on-chain
before the tokens are released.

## 04 — How Newton works

Newton adds one step to a transaction: a policy check, before the money moves.

When a claim comes in, it goes to Newton's network. A group of operators each
check it against the rule the project set. Once enough of them agree on the
answer, their approvals are combined into a single signature — a receipt saying
the network checked this transaction against this rule and here is the verdict.
That receipt travels back to the smart contract, which reads it and either
releases the tokens or does not.

The rule itself is written in Rego, a policy language large enterprises already
use for compliance. Every operator evaluates the identical rule against the
identical data, so they all reach the same verdict.

In this case study the sanctions list is a **consolidated set of designated
digital-currency addresses** — drawn from the US OFAC, Israeli MOD, Japanese MoF
and French Trésor lists — published on-chain as the policy's own parameters.
Every operator reads the same list from the same source.

## 05 — Configure the policy

Newton policies are assembled in three parts.

**Choose the data.** A policy can only see the transaction in front of it and
the data it is given. Here the data is a consolidated designated-address list —
US, Israeli, Japanese and French sanctions sources — published on-chain in the
policy's parameters. Newton also publishes ready-made
data oracles — code that fetches external data live at the moment of the check,
for sanctions, KYC, wallet risk, vault yields and gas prices — for cases that
need a live feed rather than a published list. This control uses the published
list: the set of addresses is committed on-chain and updated by the project
when the list changes, without touching the distribution contract.

**Write the rule.** The rule is written in Rego and reads the list. This is
where the project decides what the data means: a recipient on the list means a
blocked claim, anything else is allowed, and the default when the list is
missing or empty is to refuse — an empty list is not evidence that an address is
clean.

**Deploy it.** The policy is published and gets its own address. The smart
contract points at that address and checks incoming proofs against it. The rule
and the contract stay separate, so the rule — or the list — can change without
redeploying the contract or touching the application logic underneath.

A policy can also combine several data sources at once. A project could screen
sanctions, check jurisdiction and cap gas in a single rule.

## 06 — A clean wallet claim

A user claims their reward. Newton checks the wallet against the sanctions list,
the operators agree there is no match, and the claim goes through — **Compliant**.

## 07 — A sanctioned wallet claim

The same claim, from a wallet on one of the sanctions lists. The check matches, and the
transaction is blocked — **Non Compliant**. No tokens move. The blocked claim is
recorded publicly on the Newton Explorer, showing what was attempted and what
the rule decided.

## 08 — The proof

Every decision, allowed or blocked, becomes a public record on the Newton
Explorer. Each record shows the wallet, the rule that was applied, the verdict,
and the time.

This is what a project can hand to a regulator, an auditor or a partner. Both
the approved claim and the blocked one appear under the same rule, so anyone can
verify the control was actually running — not just that the project says it was.

### What the rule actually answers

One question: is this transfer allowed under the sanctions rule the project
deployed?

That is worth being precise about. Getting a sanctions signal and acting on it
are two different things. Plenty of projects have the signal. The signal only
does any work when it can stop a transaction.

## 09 — Scope and limits

This is an example of a sanctions screening control, not a complete sanctions
compliance program.

The screening list in this demonstration is a **fixed snapshot of designated
digital-currency addresses**, committed on-chain as policy parameters. It draws
from several sanctions sources — US OFAC, Israeli MOD, Japanese MoF and French
Trésor — and covers Ethereum addresses only. As a snapshot it reflects those
lists as of the last update, not a live feed: it does not automatically pick up
a designation made afterward, and the project refreshes the on-chain list when
the sources change. A variant that reads OpenSanctions live through a
self-hosted yente data oracle at the moment of each check — continuous coverage,
more regimes, and every crypto asset rather than Ethereum only — is supported by
the same policy model and is the natural next step where that is required.

Newton evaluates the configured policy and produces a verifiable attestation of
that evaluation. The demonstration does not establish regulatory compliance by
itself, and screening data, coverage, risk assessment, recordkeeping and other
compliance requirements remain separate considerations. The sanctions policy
here is illustrative, intended to demonstrate the protocol's functionality, and
runs on **Ethereum Sepolia**, a test network.

## 10 — Outcome

The project gets a sanctions control on its rewards without changing how rewards
work.

- The published multi-regime sanctions list supplies the data.
- The policy holds the rule: a designated recipient means a blocked claim.
- Newton runs the check and produces the proof, before the payout.
- The smart contract pays out only what the rule allowed.

## 11 — Takeaway

A sanctions signal is only worth having if you can act on it. This puts a
control between the signal and the payout.

_Try the policy yourself → open the Newton Sanctions Screener._
