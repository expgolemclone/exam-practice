const assert = require("node:assert/strict");
const path = require("node:path");
const { readExamPracticeConfiguration } = require("../../scripts/config.cjs");
const { STUDYZ_BOKI3_SITE, questionIdFromURL, questionURL } = require("../../contracts/sites.mjs");
const { launchChromeWithCurrentUserscript, readChromeUserDataDir, resolveSyncToken,
  DEFAULT_SYNC_API_ORIGIN } = require("./support/chrome_tampermonkey");
const { blockAdRequests } = require("./support/third_party_ads");
const { verifyStudyzShortcuts } = require("./support/studyz-shortcuts.cjs");

async function request(token, route) {
  const response = await fetch(DEFAULT_SYNC_API_ORIGIN + route, {
    headers: { Authorization: "Bearer " + token }, signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, route);
  return response.json();
}

async function main() {
  const configuration = readExamPracticeConfiguration();
  const token = await resolveSyncToken({ configuration });
  const parameters = new URLSearchParams({ site: STUDYZ_BOKI3_SITE });
  const before = await request(token, "/v12/state?" + parameters);
  const details = async date => request(token, "/v12/daily-details?" + new URLSearchParams({ site: STUDYZ_BOKI3_SITE, date }));
  const baseline = await details(before.today);
  const seen = new Set(baseline.tables.attempts.map(row => row.operation_id));
  const chrome = await launchChromeWithCurrentUserscript({ configuration,
    userDataDir: readChromeUserDataDir({ configuration }),
    userscriptPath: path.resolve(__dirname, "../dist/exam-practice-reader.user.js"),
  });
  try {
    await blockAdRequests(chrome.context);
    const page = await chrome.context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto("https://1studyz.com/boki3/random", { waitUntil: "domcontentloaded", timeout: 60000 });
    const frame = page.frameLocator("#exam-practice-reader-frame");
    await frame.locator("#question_options li").first().waitFor();
    assert.equal(await page.locator("#exam-practice-reader-shell").getAttribute("data-script-handler"), "Tampermonkey");
    const settings = page.locator("#exam-practice-reader-sync-settings");
    if (await settings.count()) {
      await page.locator("#exam-practice-reader-sync-token").fill(token);
      await page.locator("#exam-practice-reader-sync-settings-save").click();
      await settings.waitFor({ state: "detached" });
    }
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      const state = await request(token, "/v12/state?" + parameters);
      if (state.catalog?.questionCount > 0) { ready = true; break; }
      await page.waitForTimeout(250);
    }
    assert.equal(ready, true, "The real source catalog was not synchronized");
    const questionReady = page.locator('#exam-practice-reader-time-limit[data-phase="question"]');
    const cases = [
      { questionId: "17139", choice: 6, input: "keyboard", answerResult: "correct" },
      { questionId: "17140", choice: 2, input: "click", answerResult: "correct" },
      { questionId: "17144", choice: 3, input: "keyboard", answerResult: "correct" },
      { questionId: "17174", choice: 8, input: "keyboard", answerResult: "incorrect" },
    ];
    const answers = [];
    for (const scenario of cases) {
      const nativeURL = questionURL(STUDYZ_BOKI3_SITE, scenario.questionId);
      await page.goto(nativeURL, { waitUntil: "domcontentloaded", timeout: 60000 });
      await questionReady.waitFor();
      await frame.locator("body").evaluate(element => new Promise(resolve =>
        element.ownerDocument.defaultView.jQuery(resolve)));
      assert.equal(page.url(), nativeURL);
      assert.equal(await frame.locator("#question_options li").count(), 8);
      assert.equal(await frame.locator("#question_options").getAttribute("data-id"), scenario.questionId);
      if (["17144", "17174"].includes(scenario.questionId)) {
        const image = frame.locator("#question-image-open img");
        await image.evaluate(element => element.decode());
        assert.equal(await image.isVisible(), true);
        assert.equal(await image.evaluate(element => element.naturalWidth > 0), true);
      }
      if (scenario.questionId === "17174") {
        await verifyStudyzShortcuts(page, frame);
        assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
      }
      if (scenario.input === "click") {
        await frame.locator(`#question_options li[data-selected="${scenario.choice}"]`).click();
      } else {
        await page.keyboard.press("qwertyuiop"[scenario.choice - 1]);
        assert.equal(await frame.locator("#question_options li[data-exam-practice-selected]").getAttribute("data-selected"), String(scenario.choice));
        await page.keyboard.press("Enter");
      }
      await frame.locator(scenario.answerResult === "correct" ? ".question_answer.correct" : ".question_answer.wrong").waitFor({ state: "visible" });
      let attempt = null;
      const answerDeadline = Date.now() + 60000;
      while (Date.now() < answerDeadline) {
        const state = await request(token, "/v12/state?" + parameters);
        const current = await details(state.today);
        attempt = current.tables.attempts.find(row => row.question_id === scenario.questionId && !seen.has(row.operation_id));
        if (attempt) break;
        await page.waitForTimeout(250);
      }
      assert(attempt, "The native answer did not reach the production learning store");
      assert.equal(attempt.site, STUDYZ_BOKI3_SITE);
      assert.equal(attempt.answer_result, scenario.answerResult);
      seen.add(attempt.operation_id);
      assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
      if (scenario.answerResult === "incorrect") {
        assert.equal(page.url(), nativeURL);
        await page.keyboard.press("Enter");
      }
      await page.waitForFunction(previous => {
        const current = document.querySelector("#exam-practice-reader-frame")?.contentWindow;
        return current?.location.href !== previous && current?.document.querySelector("#question_options li");
      }, nativeURL);
      await questionReady.waitFor();
      const nextURL = await frame.locator("body").evaluate(element => element.ownerDocument.location.href);
      assert.notEqual(questionIdFromURL(nextURL, STUDYZ_BOKI3_SITE), null);
      assert.equal(page.url(), nextURL);
      answers.push({ questionURL: nativeURL, choice: scenario.choice, input: scenario.input,
        nativeAnswer: attempt.answer_result, operationId: attempt.operation_id,
        progression: scenario.answerResult === "correct" ? "automatic" : "Enter", nextQuestionURL: nextURL,
        ...(scenario.questionId === "17174" ? { choiceShortcuts: "asdfghjk", scrollShortcuts: "z/x/gg", focus: ["outer", "frame"] } : {}) });
    }
    const reviewURL = questionURL(STUDYZ_BOKI3_SITE, cases[0].questionId);
    await page.goto(reviewURL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await questionReady.waitFor();
    assert.equal(page.url(), reviewURL);
    assert.equal(await frame.locator("#question_options").getAttribute("data-id"), cases[0].questionId);
    assert.equal(await frame.locator(".question_answer.correct, .question_answer.wrong").count(), 0);
    const launchURL = DEFAULT_SYNC_API_ORIGIN + "/open?site=" + STUDYZ_BOKI3_SITE;
    await page.goto(launchURL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await questionReady.waitFor();
    const scheduledURL = await frame.locator("body").evaluate(element => element.ownerDocument.location.href);
    const scheduledId = questionIdFromURL(scheduledURL, STUDYZ_BOKI3_SITE);
    assert.notEqual(scheduledId, null);
    assert.equal(page.url(), scheduledURL);
    assert.equal(await frame.locator("#question_options").getAttribute("data-id"), scheduledId);
    assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
    console.log(JSON.stringify({ site: STUDYZ_BOKI3_SITE, answers, productionSync: "passed",
      repeatedReview: "passed", launchURL, scheduledQuestionURL: scheduledURL,
      scriptHandler: "Tampermonkey" }));
  } finally { await chrome.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
