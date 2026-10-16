#!/usr/bin/env bash
# Demo: puts the loan rule back (limit 11x -> 10x).
# Run from the repo root.
sed -i.bak 's/downPayment \* 11;/downPayment * 10;/' server.js
rm -f server.js.bak
grep -n "const approved" server.js