#!/usr/bin/env bash
# Tests the S3 storage driver against two local moto S3 servers (an independent
# implementation of the S3 API; no cloud account or credentials needed):
#   - one verifies request signatures: round trips, encryption, a private bucket, and then
#     the whole API and worker test suites with S3 as their storage;
#   - one runs in moto's default mode, where a public bucket policy or moto's anonymous
#     listings stand in for a misconfigured public bucket.
#
#   pnpm test:s3
#
# Needs python3 (moto is installed once into var/s3-test/venv, git-ignored) and the local
# PostgreSQL, because the shared test setup prepares a template database.
set -euo pipefail
cd "$(dirname "$0")/.."
MOTO_VERSION="5.2.5"
DIR=var/s3-test
VENV="$DIR/venv"
mkdir -p "$DIR"
if [ ! -x "$VENV/bin/moto_server" ] || ! "$VENV/bin/pip" --disable-pip-version-check show moto 2>/dev/null | grep -qx "Version: $MOTO_VERSION"; then
  echo "Installing moto $MOTO_VERSION into $VENV (one time)..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" --disable-pip-version-check install -q "moto[server]==$MOTO_VERSION"
fi

free_port() { "$VENV/bin/python" -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'; }
# Waits for a TCP listener without sending a request (requests to the signing server are counted).
wait_port() {
  "$VENV/bin/python" -I -c '
import socket, sys, time
for _ in range(100):
    try:
        socket.create_connection(("127.0.0.1", int(sys.argv[1])), 0.2).close()
        sys.exit(0)
    except OSError:
        time.sleep(0.1)
sys.exit("moto did not start")
' "$1"
}

AUTH_PORT="$(free_port)"
OPEN_PORT="$(free_port)"
# The signing server allows its first three requests without credentials: just enough to
# create a test user, allow it S3 access and issue it a key. Everything after must be signed.
INITIAL_NO_AUTH_ACTION_COUNT=3 "$VENV/bin/moto_server" -H 127.0.0.1 -p "$AUTH_PORT" >"$DIR/moto-signed.log" 2>&1 &
AUTH_PID=$!
"$VENV/bin/moto_server" -H 127.0.0.1 -p "$OPEN_PORT" >"$DIR/moto-open.log" 2>&1 &
OPEN_PID=$!
trap 'kill "$AUTH_PID" "$OPEN_PID" 2>/dev/null || true' EXIT
wait_port "$AUTH_PORT"
wait_port "$OPEN_PORT"

BOOTSTRAP='
import json, sys
import boto3
endpoint = "http://127.0.0.1:" + sys.argv[1]
iam = boto3.client("iam", endpoint_url=endpoint, region_name="us-east-1", aws_access_key_id="bootstrap", aws_secret_access_key="bootstrap")
iam.create_user(UserName="sim-it")
iam.put_user_policy(UserName="sim-it", PolicyName="s3", PolicyDocument=json.dumps({"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": "s3:*", "Resource": "*"}]}))
key = iam.create_access_key(UserName="sim-it")["AccessKey"]
# Signed from here on: a private bucket for the API and worker suites.
s3 = boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1", aws_access_key_id=key["AccessKeyId"], aws_secret_access_key=key["SecretAccessKey"])
s3.create_bucket(Bucket="sim-services-it")
print(key["AccessKeyId"], key["SecretAccessKey"])
'
read -r KEY_ID SECRET < <("$VENV/bin/python" -I -c "$BOOTSTRAP" "$AUTH_PORT")

export S3_TEST_ENDPOINT="http://127.0.0.1:$AUTH_PORT"
export S3_TEST_ACCESS_KEY_ID="$KEY_ID"
export S3_TEST_SECRET_ACCESS_KEY="$SECRET"
export S3_TEST_OPEN_ENDPOINT="http://127.0.0.1:$OPEN_PORT"
export S3_TEST_BUCKET="sim-services-it"
echo "1/2 S3 driver tests"
npx vitest run packages/storage
echo "2/2 API and worker suites with S3 storage"
SIM_TEST_STORAGE=s3 npx vitest run apps/api apps/worker
