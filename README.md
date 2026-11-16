# exam-practice

Unofficial reading, keyboard and spaced-repetition tools for [kakomonn.com](https://kakomonn.com/) and [1st Studyz bookkeeping level 3](https://1studyz.com/boki3/). Not affiliated with either operator.

[Install Reader](reader/README.md#installation) / [Learning log](https://exam-practice-sync.kakomonn.workers.dev/) / [Usage and development](docs/guide.md)

<img src="docs/assets/kakomonn-demo.gif" alt="Reader demo" width="960">

## Get started

Use Windows 11 Chrome with Tampermonkey Beta, or iPhone Safari with Tampermonkey. Install Reader and enter your sync token when prompted. Speech requires an internet connection.

Open the [next question](https://exam-practice-sync.kakomonn.workers.dev/open), or use the [Windows launcher](docs/guide.md#windows-setup).

### PC keyboard shortcuts

| Key | Action |
| --- | --- |
| `q`, `w`, `e`, `r`, `t`, `y`, `u`, `i`, `o`, `p` | Select answer 1 through 10, up to the current choice count. |
| `Enter` | Submit the answer. After an incorrect answer, advance to the next question. |
| `a`, `s`, `d`, `f`, `g`, `h`, `j`, `k`, `l`, `;` | Toggle strikethrough on the corresponding choice. |
| `Space` | Pause or resume speech. |
| `n` | Skip the current question, recording it as incorrect. |
| `z` / `x` | Scroll down / up. |
| `gg` | Return to the top of the question. |
| `Shift+H` | Go back to the learning log. |

Shortcuts are disabled while typing in text fields. After an incorrect answer, browser Forward also advances to the next question.

### iPhone controls

- Tap an answer choice, then tap the site's answer button to submit.
- If speech does not start, tap the page to allow audio playback.
- After an incorrect answer, swipe left from the middle of the screen to continue. Avoid starting at the edge, where Safari handles navigation gestures.
- Use Safari Back to return to the learning log and Forward to resume the latest question.

On both devices, correct answers advance automatically. Answering also copies accessible question and explanation content as Markdown to the clipboard. 1st Studyz requires login for explanations; locked explanations are not copied. If syncing fails, use the retry action in the error dialog before continuing.

## Components

| Component | Purpose |
| --- | --- |
| [Reader](reader/README.md) | Read aloud, answer by keyboard and copy Markdown. |
| [Sync](sync/README.md) | Schedule questions with FSRS and share learning records across devices. |

[Tests](docs/guide.md#tests) / [Release and deployment](docs/guide.md#release-and-deployment) / [MIT license](LICENSE)
