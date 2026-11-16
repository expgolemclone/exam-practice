# exam-practice-reader

A userscript for reading and answering questions from the supported study sites.

## Installation

See the root [getting-started guide and controls](../README.md#get-started) for supported devices and everyday use.

Install the [latest release](https://github.com/expgolemclone/exam-practice/releases/latest/download/exam-practice-reader.user.js) in Tampermonkey. For an existing installation, first copy only the new download\'s `@name` and `@namespace` header values into the existing script in Tampermonkey\'s editor and save. Then install the new download as that script\'s update, not as a second script. This retains its GM store, allowing the one-time key migration to preserve the token and pending records. Back up the existing script with its storage before upgrading. On Windows, use Tampermonkey Beta 5.6 or later in `UserScripts API Dynamic` mode with `Allow User Scripts` enabled. Use the production Worker's `SYNC_TOKEN` on each device. Never put the token in a URL.

See [Windows setup](../docs/guide.md#windows-setup) and [opening the next question](../sync/README.md#open-the-next-question). To host your own service, first [deploy Sync](../sync/README.md#deployment), then update `SYNC_API_URL` in [`src/reader-controller.js`](src/reader-controller.js) and `@connect` in [`src/userscript.meta.txt`](src/userscript.meta.txt) before building.

## Release

See the shared [test requirements](../docs/guide.md#tests) and [`package.json`](../package.json) for build and test commands.

Bump `@version` in the userscript metadata using SemVer. Do not commit generated files. Prepare the Windows test environment, jj, and an authenticated GitHub CLI (`gh auth login`). After integrating and pushing `main`, run from the repository root:

```powershell
npm run release:reader
```

Publish only the synchronized `main` tip. If validation or publication fails, fix the cause and rerun without bypasses. Coordinate service changes using the [release and deployment order](../docs/guide.md#release-and-deployment).
