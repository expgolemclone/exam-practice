const assert = require("node:assert/strict");
const path = require("node:path");
const { readExamPracticeConfiguration } = require("../../scripts/config.cjs");
const { STUDYZ_BOKI3_SITE, questionIdFromURL } = require("../../contracts/sites.mjs");
const { launchChromeWithCurrentUserscript, readChromeUserDataDir, resolveSyncToken,
  DEFAULT_SYNC_API_ORIGIN } = require("./support/chrome_tampermonkey");
const { blockAdRequests } = require("./support/third_party_ads");

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
    await frame.locator("body").evaluate(element => new Promise(resolve =>
      element.ownerDocument.defaultView.jQuery(resolve)));
    const count = await frame.locator("#question_options li").count();
    assert.equal(count, 8);
    const nativeURL = await frame.locator("body").evaluate(element => element.ownerDocument.location.href);
    const questionId = questionIdFromURL(nativeURL, STUDYZ_BOKI3_SITE);
    assert.notEqual(questionId, null);
    assert.equal(await frame.locator("#question_options").getAttribute("data-id"), questionId);
    await page.keyboard.press("i");
    assert.equal(await frame.locator("#question_options li[data-exam-practice-selected]").getAttribute("data-selected"), "8");
    await page.keyboard.press("Enter");
    await frame.locator(".question_answer.correct, .question_answer.wrong").waitFor({ state: "visible" });
    let attempt = null;
    const answerDeadline = Date.now() + 60000;
    while (Date.now() < answerDeadline) {
      const state = await request(token, "/v12/state?" + parameters);
      const current = await details(state.today);
      attempt = current.tables.attempts.find(row => row.question_id === questionId && !seen.has(row.operation_id));
      if (attempt) break;
      await page.waitForTimeout(250);
    }
    assert(attempt, "The native answer did not reach the production learning store");
    assert.equal(attempt.site, STUDYZ_BOKI3_SITE);
    assert(["correct", "incorrect"].includes(attempt.answer_result));
    assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
    if (attempt.answer_result === "incorrect") await page.keyboard.press("Enter");
    await page.waitForFunction(previous => {
      const current = document.querySelector("#exam-practice-reader-frame")?.contentWindow;
      return current?.location.href !== previous && current?.document.querySelector("#question_options li");
    }, nativeURL);
    console.log(JSON.stringify({ site: STUDYZ_BOKI3_SITE, choices: count, nativeAnswer: attempt.answer_result,
      productionSync: "passed", scriptHandler: "Tampermonkey" }));
  } finally { await chrome.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
