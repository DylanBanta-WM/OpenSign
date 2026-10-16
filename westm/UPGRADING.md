# Upgrading to a new OpenSign release

We follow upstream **release tags** (`v2.41.3`, …), one release at a time, never
their `main`/`staging` branches. Our changes live in `westm/` and `*/custom/` (see
[README.md](README.md)), so most releases merge with no conflicts.

Get notified of releases: on GitHub, watch OpenSignLabs/OpenSign → Custom → Releases.

## One-time setup (per clone)

```sh
git remote add upstream https://github.com/OpenSignLabs/OpenSign.git   # if missing
git config rerere.enabled true      # remember conflict resolutions
git config rerere.autoupdate true
```

## 1. Merge the release on a branch

Use a separate worktree. **Don't switch branches in `/NAS/lx03/Apps/OpenSign`**, which is
the production checkout.

```sh
cd /NAS/lx03/Apps/OpenSign
git fetch upstream --tags
git tag --sort=-creatordate | head          # pick the next release, e.g. v2.42.0
git worktree add -b westm/upgrade-v2.42.0 ../OpenSign-upgrade staging
cd ../OpenSign-upgrade
git merge --no-ff v2.42.0 -m "Merge upstream release v2.42.0"
```

If there are conflicts, they'll almost always be next to one of our hooks. Keep both
sides. `git grep -n "West Muskingum" -- apps` lists every hook.

## 2. Check what a clean merge won't tell you

```sh
# Did upstream change their Dockerfiles? Mirror changes into westm/*.Dockerfile
git diff <previous-tag> <new-tag> -- apps/OpenSignServer/Dockerhubfile apps/OpenSign/Dockerhubfile apps/OpenSign/entrypoint.sh

# Do the files our branding overwrites still exist? (an upstream move = a silent revert to their logo)
(cd westm/branding && find . -type f) | sed 's#^\./##' | while read f; do [ -e "$f" ] || echo "MOVED/REMOVED: $f"; done
#   (apps/OpenSign/public/static/js/assets/images/logo.png is ours only and is expected to show up here)

# Did the files our custom code builds on change?
git diff --stat <previous-tag> <new-tag> -- \
  apps/OpenSignServer/Utils.js apps/OpenSignServer/cloud/parsefunction/sendMailv3.js \
  apps/OpenSign/src/components/EmailBodyEditor.jsx apps/OpenSign/src/components/preferences/tabs/Email.jsx

# New database migrations?
git diff --stat --diff-filter=A <previous-tag> <new-tag> -- apps/OpenSignServer/databases apps/OpenSignServer/migrationdb

# New environment variables?
git diff <previous-tag> <new-tag> -- apps | grep -o "^+.*process.env\.[A-Za-z_]*" | grep -o "process.env\.[A-Za-z_]*" | sort -u
```

Also skim the release notes on GitHub.

## 3. Build and test

```sh
docker build -f westm/server.Dockerfile -t westm-opensignserver:v2.42.0 .
docker build -f westm/client.Dockerfile -t westm-opensign:v2.42.0 .

cd westm/test-stack
# Signing needs a certificate: make a throwaway self-signed one (not committed)
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=OpenSign TEST ONLY" -keyout /tmp/k.pem -out /tmp/c.pem
openssl pkcs12 -export -inkey /tmp/k.pem -in /tmp/c.pem -out /tmp/test.pfx -passout pass:testpass
echo "PFX_BASE64=$(base64 -w0 /tmp/test.pfx)" > test.local.env && echo "PASS_PHRASE=testpass" >> test.local.env
TAG=v2.42.0 docker compose up -d
../smoke-test.sh                     # must end with "Failed: 0"
```

Then click through it at http://localhost:3010. The smoke test leaves an admin
(`admin-<timestamp>@example.com` / `Test-Passw0rd!`), and email lands in Mailpit at http://localhost:8025.
- Preferences → Email: all four templates (request, completion, setup, reminder) save and reset.
  Paste our production request/completion HTML into the test tenant first — the test database starts empty.
- Logos on the login page and in the header
- Upload, place a signer, send, sign. The completion email and certificate show our logo.

Tear it down: `docker compose down -v`

## 4. Deploy

Run this in a quiet window. Users are logged out briefly.

```sh
cd /NAS/lx03/Apps/OpenSign
./backup-mongo.sh && ls -lt Volumes/backups | head -2     # fresh backup first

# keep the running images for rollback
docker tag westm-opensignserver:latest westm-opensignserver:rollback
docker tag westm-opensign:latest       westm-opensign:rollback

git merge --ff-only westm/upgrade-v2.42.0                 # staging → the new code
docker compose build                                      # or retag the tested images as :latest
docker compose up -d
docker compose logs -f server                             # wait for "Successfully run migrations"
```

**One-time, first deploy of v2.38+ only:** v2.38 added a Basic (rich-text) / Advanced (raw HTML)
email editor and opens templates with no saved editor type in Basic. Basic flattens our table-based
HTML templates, both on Preferences → Email and when sending a document. Pin existing custom templates
to Advanced:

```sh
docker exec mongo-container mongosh --quiet OpenSignDB --eval '
  db.partners_Tenant.updateMany(
    { EmailEditorType: { $exists: false },
      $or: [ { RequestBody: { $nin: [null, ""] } }, { CompletionBody: { $nin: [null, ""] } } ] },
    { $set: { EmailEditorType: { request: "advanced", completion: "advanced" } } })'
```
Users must log out and back in to pick it up.

Check https://sign.westmschools.com: log in, open Preferences → Email, and send yourself a reminder.

Finish up:
```sh
git push origin staging
git push --force-with-lease origin staging:main           # keep main = what's deployed
git worktree remove ../OpenSign-upgrade && git branch -d westm/upgrade-v2.42.0
```

**Rollback:** `git reset --hard <previous staging commit>`, retag `:rollback` as `:latest` on both
images, then `docker compose up -d`. Upstream migrations so far only add fields and indexes, so the
old version still runs against the upgraded database. If a release notes a destructive migration,
restore the backup instead.
