#!/usr/bin/env bash
# Creates the two SecureString parameters GateKeeper's Lambdas read at cold start.
# Standard-tier SSM parameters have no monthly fee. Run once per stage.
#   STAGE=dev AWS_REGION=ap-south-1 ./scripts/create-secrets.sh
set -euo pipefail
STAGE="${STAGE:-dev}"
PREFIX="/gatekeeper/${STAGE}"
gen() { openssl rand -base64 48 | tr -d '\n'; }
for name in qr-token-pepper encryption-key; do
  if aws ssm get-parameter --name "${PREFIX}/${name}" >/dev/null 2>&1; then
    echo "exists: ${PREFIX}/${name} (left unchanged — rotating it invalidates outstanding passes)"
  else
    aws ssm put-parameter --name "${PREFIX}/${name}" --type SecureString --value "$(gen)" >/dev/null
    echo "created: ${PREFIX}/${name}"
  fi
done
