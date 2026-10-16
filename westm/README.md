# West Muskingum customizations

This repo is a fork of [OpenSignLabs/OpenSign](https://github.com/OpenSignLabs/OpenSign).
To make upstream upgrades painless, our changes live in files upstream never touches,
and upstream files only carry one-line hooks into them. See [UPGRADING.md](UPGRADING.md).

## Where everything lives

| What | Where |
|---|---|
| Cloud functions `sendsetupemail`, `sendreminderemail`, `updatecustomemailtemplates` | `apps/OpenSignServer/custom/` (registered in `custom/cloud.js`) |
| Setup-email swap (password reset → "set your password" email) | `apps/OpenSignServer/custom/setupEmail.js` |
| Default setup / reminder email templates | `apps/OpenSignServer/custom/templates/` |
| Setup / Reminder editors on Preferences → Email | `apps/OpenSign/src/custom/CustomMailTemplates.jsx` |
| Logos | `westm/branding/` — mirrors repo paths, copied over upstream's files at image build |
| Password reset page | `westm/parse-server/views/choose_password` — copied into parse-server at image build |
| Image builds | `westm/server.Dockerfile`, `westm/client.Dockerfile` (copies of upstream's `Dockerhubfile`s + our overlays) |
| Deployment | `docker-compose.yml` (ours; upstream's is unused) |
| Nightly Mongo backup | `backup-mongo.sh` (cron, 02:30) |
| Smoke test + throwaway test stack | `westm/smoke-test.sh`, `westm/test-stack/` |

## Hooks in upstream files

Every edit to an upstream file is marked `West Muskingum`. Find them with:

```sh
git grep -n "West Muskingum" -- apps
```

| File | Hook |
|---|---|
| `apps/OpenSignServer/cloud/main.js` | `import '../custom/cloud.js';` |
| `apps/OpenSignServer/index.js` | import + `await applyCustomSetupEmail(payload);` in the mail adapter's `apiCallback`; `PUBLIC_URL` env override for the `public_url` header |
| `apps/OpenSign/src/components/preferences/tabs/Email.jsx` | import + `<CustomMailTemplates … />` |

## External callers

n8n automations call `sendreminderemail` (master key) and `sendsetupemail` (master key).
Don't rename these functions or change their parameters.

## Tenant fields we add

`partners_Tenant`: `SetupEmailBody`, `SetupEmailSubject`, `ReminderEmailBody`, `ReminderEmailSubject`.
