#!/usr/bin/env bash
#
# Smoke test for the West Muskingum customizations, run against a THROWAWAY test
# stack (westm/test-stack/) — never production. It creates users and documents.
#
#   cd westm/test-stack && TAG=<image tag> docker compose up -d
#   ../smoke-test.sh
#
# Checks: custom cloud functions, setup + reminder emails (captured by Mailpit),
# template saving/permissions, upstream template saving, choose_password page, logos.

set -uo pipefail

SERVER="${SERVER:-http://localhost:8092/app}"
CLIENT="${CLIENT:-http://localhost:3010}"
MAILPIT="${MAILPIT:-http://localhost:8025}"
APP_ID="${APP_ID:-opensign}"
MASTER_KEY="${MASTER_KEY:-testmasterkey123}"
HERE="$(cd "$(dirname "$0")" && pwd)"

case "$SERVER" in
  http://localhost:*|http://127.0.0.1:*) ;;
  *) echo "Refusing to run against $SERVER — this test writes data. Use the local test stack." >&2; exit 2 ;;
esac

PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

H=(-H "X-Parse-Application-Id: $APP_ID" -H "Content-Type: application/json")
master() { curl -s "${H[@]}" -H "X-Parse-Master-Key: $MASTER_KEY" "$@"; }
as()     { local tok="$1"; shift; curl -s "${H[@]}" -H "X-Parse-Session-Token: $tok" "$@"; }
mail_clear() { curl -s -X DELETE "$MAILPIT/api/v1/messages" >/dev/null; }
# Waits for an email to $1 and prints "<subject>\t<html>"
mail_to() {
  local id=""
  for _ in $(seq 1 20); do
    id=$(curl -s "$MAILPIT/api/v1/messages" | jq -r --arg to "$1" '[.messages[] | select(.To[0].Address==$to)][0].ID // empty')
    [ -n "$id" ] && break; sleep 1
  done
  [ -z "$id" ] && return 1
  curl -s "$MAILPIT/api/v1/message/$id" | jq -r '[.Subject, .HTML] | @tsv'
}

RUN=$(date +%s)
ADMIN_EMAIL="admin-$RUN@example.com"
USER_EMAIL="user-$RUN@example.com"
SIGNER_EMAIL="signer-$RUN@example.com"
PASSWORD="Test-Passw0rd!"

echo "== Setup"
check "server health" "$(curl -s "$SERVER/health" | jq -r .status)" "ok"
master -X POST "$SERVER/functions/addadmin" -d "{\"userDetails\":{\"name\":\"Test Admin\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$PASSWORD\",\"company\":\"Test Co\",\"role\":\"contracts_Admin\",\"timezone\":\"America/New_York\"}}" >/dev/null
ADMIN_TOKEN=$(curl -s "${H[@]}" -X POST "$SERVER/login" -d "{\"username\":\"$ADMIN_EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.sessionToken // empty')
[ -n "$ADMIN_TOKEN" ] && ok "admin created and logged in" || { bad "admin login"; exit 1; }
ADMIN_ID=$(curl -s "${H[@]}" -H "X-Parse-Session-Token: $ADMIN_TOKEN" "$SERVER/users/me" | jq -r .objectId)
EXT=$(master -G "$SERVER/classes/contracts_Users" --data-urlencode "where={\"UserId\":{\"__type\":\"Pointer\",\"className\":\"_User\",\"objectId\":\"$ADMIN_ID\"}}" | jq '.results[0]')
EXT_ID=$(jq -r .objectId <<<"$EXT"); TENANT_ID=$(jq -r .TenantId.objectId <<<"$EXT")
[ "$TENANT_ID" != "null" ] && ok "tenant $TENANT_ID" || { bad "tenant lookup"; exit 1; }

# Non-admin user in the same tenant
USER_ID=$(master -X POST "$SERVER/users" -d "{\"username\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\",\"email\":\"$USER_EMAIL\",\"name\":\"Test User\"}" | jq -r .objectId)
master -X POST "$SERVER/classes/contracts_Users" -d "{\"UserId\":{\"__type\":\"Pointer\",\"className\":\"_User\",\"objectId\":\"$USER_ID\"},\"TenantId\":{\"__type\":\"Pointer\",\"className\":\"partners_Tenant\",\"objectId\":\"$TENANT_ID\"},\"UserRole\":\"contracts_User\",\"Email\":\"$USER_EMAIL\",\"Name\":\"Test User\"}" >/dev/null
USER_TOKEN=$(curl -s "${H[@]}" -X POST "$SERVER/login" -d "{\"username\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.sessionToken // empty')
[ -n "$USER_TOKEN" ] && ok "non-admin user created" || bad "non-admin user login"

echo "== Template saving"
R=$(as "$ADMIN_TOKEN" -X POST "$SERVER/functions/updatetenant" -d "{\"tenantId\":\"$TENANT_ID\",\"details\":{\"RequestSubject\":\"Req $RUN\",\"RequestBody\":\"<p>req</p>\"}}")
check "upstream updatetenant saves request template" "$(jq -r .result.RequestSubject <<<"$R")" "Req $RUN"
R=$(as "$ADMIN_TOKEN" -X POST "$SERVER/functions/updatecustomemailtemplates" -d "{\"tenantId\":\"$TENANT_ID\",\"details\":{\"SetupEmailSubject\":\"Custom setup $RUN\",\"SetupEmailBody\":\"<p>Custom setup <a href='{{link}}'>go</a></p>\",\"ReminderEmailSubject\":\"Custom reminder {{document_title}}\",\"ReminderEmailBody\":\"<p>Hi {{receiver_name}} please sign {{document_title}} at {{signing_url}}</p>\"}}")
check "admin saves setup+reminder templates" "$(jq -r .result.SetupEmailSubject <<<"$R")" "Custom setup $RUN"
R=$(as "$USER_TOKEN" -X POST "$SERVER/functions/updatecustomemailtemplates" -d "{\"tenantId\":\"$TENANT_ID\",\"details\":{\"SetupEmailSubject\":\"hacked\"}}")
check "non-admin is refused" "$(jq -r .code <<<"$R")" "119"
R=$(as "$ADMIN_TOKEN" -X POST "$SERVER/functions/updatecustomemailtemplates" -d "{\"tenantId\":\"someOtherTenant\",\"details\":{\"SetupEmailSubject\":\"hacked\"}}")
check "other tenant is refused" "$(jq -r .code <<<"$R")" "119"

echo "== Setup email (sendsetupemail)"
mail_clear
R=$(as "$ADMIN_TOKEN" -X POST "$SERVER/functions/sendsetupemail" -d "{\"email\":\"$USER_EMAIL\"}")
check "sendsetupemail requires master key" "$(jq -r .code <<<"$R")" "119"
master -X POST "$SERVER/functions/sendsetupemail" -d "{\"email\":\"$USER_EMAIL\"}" >/dev/null
M=$(mail_to "$USER_EMAIL") || M=""
check "custom setup email subject" "$(cut -f1 <<<"$M")" "Custom setup $RUN"
grep -q "Custom setup <a href=.*choose_password\|Custom setup <a href=.*request_password_reset\|Custom setup <a href=.http" <<<"$M" && ok "setup link substituted" || bad "setup link substituted"
as "$ADMIN_TOKEN" -X POST "$SERVER/functions/updatecustomemailtemplates" -d "{\"tenantId\":\"$TENANT_ID\",\"details\":{\"SetupEmailSubject\":\"\",\"SetupEmailBody\":\"\"}}" >/dev/null
mail_clear
master -X POST "$SERVER/functions/sendsetupemail" -d "{\"email\":\"$USER_EMAIL\"}" >/dev/null
M=$(mail_to "$USER_EMAIL") || M=""
check "default setup email subject after reset" "$(cut -f1 <<<"$M")" "$(cat "$HERE/../apps/OpenSignServer/custom/templates/setup_email_subject.txt" | tr -d '\n')"
mail_clear
curl -s "${H[@]}" -X POST "$SERVER/requestPasswordReset" -d "{\"email\":\"$USER_EMAIL\"}" >/dev/null
M=$(mail_to "$USER_EMAIL") || M=""
[ -n "$M" ] && [ "$(cut -f1 <<<"$M")" != "$(cat "$HERE/../apps/OpenSignServer/custom/templates/setup_email_subject.txt" | tr -d '\n')" ] \
  && ok "normal password reset is not turned into a setup email" || bad "normal password reset email ($(cut -f1 <<<"$M"))"

echo "== Reminder email (sendreminderemail)"
DOC_ID=$(master -X POST "$SERVER/classes/contracts_Document" -d "{\"Name\":\"Doc $RUN\",\"ExtUserPtr\":{\"__type\":\"Pointer\",\"className\":\"contracts_Users\",\"objectId\":\"$EXT_ID\"},\"Placeholders\":[{\"Role\":\"signer\",\"Id\":1,\"email\":\"$SIGNER_EMAIL\"}],\"Signers\":[]}" | jq -r .objectId)
mail_clear
R=$(as "$USER_TOKEN" -X POST "$SERVER/functions/sendreminderemail" -d "{\"documentId\":\"$DOC_ID\"}")
check "non-owner can't send reminders" "$(jq -r .code <<<"$R")" "119"
R=$(as "$ADMIN_TOKEN" -X POST "$SERVER/functions/sendreminderemail" -d "{\"documentId\":\"$DOC_ID\"}")
check "owner sends reminder" "$(jq -r .result.sent <<<"$R")" "1"
M=$(mail_to "$SIGNER_EMAIL") || M=""
check "custom reminder subject" "$(cut -f1 <<<"$M")" "Custom reminder Doc $RUN"
grep -q "please sign Doc $RUN at http" <<<"$M" && ok "reminder variables substituted" || bad "reminder variables substituted"
R=$(master -X POST "$SERVER/functions/sendreminderemail" -d "{\"documentId\":\"$DOC_ID\"}")
check "master key (n8n) can send reminders" "$(jq -r .result.sent <<<"$R")" "1"

echo "== Branding"
curl -s "$SERVER/apps/choose_password?id=$APP_ID" | grep -q "westmschools.com" && ok "custom choose_password page served" || bad "custom choose_password page served"
check "client is up" "$(curl -s -o /dev/null -w '%{http_code}' "$CLIENT/")" "200"
check "client static logo is ours" \
  "$(curl -s "$CLIENT/static/js/assets/images/logo.png" | md5sum | cut -d' ' -f1)" \
  "$(md5sum < "$HERE/branding/apps/OpenSign/public/static/js/assets/images/logo.png" | cut -d' ' -f1)"

echo
echo "Passed: $PASS  Failed: $FAIL"
[ "$FAIL" -eq 0 ]
