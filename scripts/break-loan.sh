#!/usr/bin/env bash
# Demo: breaks the loan rule (limit 10x -> 11x) so LOAN-03 fails.
# Run from the repo root, on a branch (never on main).
sed -i.bak 's/downPayment \* 10;/downPayment * 11;/' server.js
rm -f server.js.bak
grep -n "const approved" server.js