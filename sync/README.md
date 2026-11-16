# exam-practice-sync

A Cloudflare Worker for cross-device learning records and Azure Speech authentication.

## Learning log

Open the [dashboard](https://exam-practice-sync.kakomonn.workers.dev/) in a browser profile with [Reader installed and authenticated](../reader/README.md#installation).

## Open the next question

Bookmark this URL on iPhone Safari, or use the [Windows launcher](../docs/guide.md#windows-setup):

```text
https://exam-practice-sync.kakomonn.workers.dev/open
```

The launcher defaults to `chushoks.kakomonn.com`. Use the dashboard source selector and next-question link, or open `/open?site=studyz-boki3` for 1st Studyz bookkeeping level 3. Reader starts the site\'s normal session before opening scheduled questions.

## Development

See the shared [test requirements](../docs/guide.md#tests) and [`package.json`](../package.json) for commands. API validation lives in [`contracts/api.mjs`](../contracts/api.mjs); metrics and persistence live in [`src/learning-store.js`](src/learning-store.js). Refer to the source rather than maintaining separate API or metric specifications.

## Deployment

Prepare the shared [test environment](../docs/guide.md#tests). Authenticate with Azure and create a free F0 Speech resource in Japan East. Replace `<unique-name>` with a globally unique resource name.

```powershell
az login
az group create --name exam-practice-reader --location japaneast
az cognitiveservices account create --name <unique-name> --resource-group exam-practice-reader --kind SpeechServices --sku F0 --location japaneast --yes
$speechKey = az cognitiveservices account keys list --name <unique-name> --resource-group exam-practice-reader --query key1 --output tsv
```

Authenticate with Cloudflare and register the secrets. Use a cryptographically random value of at least 256 bits for `SYNC_TOKEN`. Never commit tokens or keys.

```powershell
npx --no-install wrangler login
npx --no-install wrangler secret put SYNC_TOKEN --config sync/wrangler.jsonc
$speechKey | npx --no-install wrangler secret put AZURE_SPEECH_KEY --config sync/wrangler.jsonc
```

For copy-failure reports, create a fine-grained GitHub PAT restricted to `expgolemclone/exam-practice` with `Issues: Read and write`. Store it only as a Worker secret, never in `exam-practice.toml`, a browser, or a URL:

```powershell
npx --no-install wrangler secret put GITHUB_COPY_FAILURE_TOKEN --config sync/wrangler.jsonc
```

After passing the complete tests and pushing `main`, deploy and verify production:

```powershell
npm run deploy:sync
```

Production verification requires real Chrome, Tampermonkey, a configured Reader token, and an authenticated `gh` CLI. It records a production answer and posts a controlled copy-failure report to GitHub. Run this verification once per deployment, not as a replacement for the complete tests. Use the [release order](../docs/guide.md#release-and-deployment) before publishing a dependent Reader change.
