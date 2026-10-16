#!/usr/bin/env bash
# Call cua-driver on the QA VM: PASEO_QA_VM=<ssh-target> vcua.sh <tool> '<json>'
# JSON goes over stdin; cmd and PowerShell argument quoting mangles inline JSON.
: "${PASEO_QA_VM:?set PASEO_QA_VM to the QA VM ssh target}"
printf '%s' "$2" | ssh -o BatchMode=yes -o ConnectTimeout=10 "$PASEO_QA_VM" "cua-driver call $1"
