#!/bin/sh
# Domain.swift vs src/domain.js on the same cases. Prints PARITY OK / DIFF. No network.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
swiftc -O -o "$TMP/parity" "$HERE/../Sources/Domain.swift" "$HERE/../Sources/CommonWords.swift" "$HERE/parity/main.swift" || exit 2
"$TMP/parity" "$HERE/parity/cases.json" > "$TMP/swift.json" || exit 3
node "$HERE/parity/node_ref.mjs" "$HERE/parity/cases.json" > "$TMP/node.json" || exit 4
python3 -I - "$TMP/swift.json" "$TMP/node.json" <<'PY'
import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
bad=[(x['id'],k) for x,y in zip(a,b) for k in x if x[k]!=y[k]]
print('cases',len(a),'/',len(b),'fields_differing',len(bad),bad)
sys.exit(1 if bad or len(a)!=len(b) else 0)
PY
RC=$?; [ $RC -eq 0 ] && echo "PARITY OK" || echo "PARITY DIFF"; exit $RC
