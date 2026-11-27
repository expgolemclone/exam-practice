import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium, devices } from "playwright";
import { expect } from "playwright/test";
import { STUDYZ_BOKI3_SITE, questionURL } from "../../contracts/sites.mjs";
import { buildSiteBundle } from "./support/site-bundle.mjs";
import { verifyStudyzShortcuts } from "./support/studyz-shortcuts.cjs";
import syncFixture from "./support/sync-fixture.cjs";
import frameSupport from "./support/frame_reader.js";
import adSupport from "./support/third_party_ads.js";

test("real 1st Studyz supports normal session initialization, native answers and repeated reviews", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const bundle = await buildSiteBundle();
    await page.goto("https://1studyz.com/boki3/test/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.addScriptTag({ content: bundle });
    const ids = await page.evaluate(async siteId => {
      const site = SiteTest.studyzBoki3;
      await site.prepareSession();
      return SiteTest.createCatalogLoader({ siteId, site, fetchConcurrency: 4, timeoutMs: 30000, SyncRequestError: Error }).loadCompleteQuestionCatalog();
    }, STUDYZ_BOKI3_SITE);
    assert(ids.length > 0 && ids.length <= 10000);
    const url = questionURL(STUDYZ_BOKI3_SITE, ids[0]);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.addScriptTag({ content: bundle });
    const before = await page.evaluate(() => {
      const site = SiteTest.studyzBoki3;
      const controls = site.currentQuestionControls(document);
      return { count: controls?.answerChoiceControls.length, questionPresent: site.extractQuestionTextFromDocument(document).length > 0,
        result: site.answerResultFromDocument(document), copy: site.copySource(document).state };
    });
    assert.equal(before.questionPresent, true);
    assert(before.count >= 2);
    assert.equal(before.result, "unknown");
    assert.equal(before.copy, "locked");
    await page.evaluate(() => {
      const site = SiteTest.studyzBoki3;
      const controls = site.currentQuestionControls(document);
      if (!site.selectChoice(controls, controls.answerChoiceControls.length - 1) || !site.submitAnswer(controls)) {
        throw new Error("Native answer submission was not available.");
      }
    });
    await page.waitForFunction(() => SiteTest.studyzBoki3.answerResultFromDocument(document) !== "unknown", null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => SiteTest.studyzBoki3.copySource(document).state), "restricted");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.addScriptTag({ content: bundle });
    assert.equal(page.url(), url);
    assert.equal(await page.evaluate(() => SiteTest.studyzBoki3.answerResultFromDocument(document)), "unknown");
    assert.equal(await page.evaluate(() => SiteTest.studyzBoki3.currentQuestionControls(document).answerChoiceControls.length), before.count);
    const freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await fresh.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(fresh.url(), "https://1studyz.com/boki3/test/");
    console.log(JSON.stringify({ site: STUDYZ_BOKI3_SITE, catalogCount: ids.length, choiceCount: before.count,
      sessionInitialization: "passed", nativeAnswer: "passed", repeatedReview: "passed", guestExplanation: "restricted" }));
  } finally { await browser.close(); }
});

async function studyzReaderContext(browser, device = "Desktop Chrome") {
  const context = await browser.newContext(devices[device]);
  await adSupport.blockAdRequests(context);
  const script = await readFile(new URL("../dist/exam-practice-reader.user.js", import.meta.url), "utf8");
  await frameSupport.installReaderInChildFrames(context, script);
  return { context, script };
}

test("Reader shortcuts and restricted incorrect-answer review work on real Studyz question 17174 with fixture sync", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const { context, script } = await studyzReaderContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto("https://1studyz.com/boki3/random", { waitUntil: "domcontentloaded", timeout: 60000 });
    const url = questionURL(STUDYZ_BOKI3_SITE, "17174");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await syncFixture.installSyncFixture(page, { site: STUDYZ_BOKI3_SITE, nextQuestionId: "17139" });
    await page.addScriptTag({ content: script });
    await page.locator('#exam-practice-reader-time-limit[data-phase="question"]').waitFor();
    const frame = page.frameLocator("#exam-practice-reader-frame");
    await frame.locator("body").evaluate(body => new Promise(resolve => body.ownerDocument.defaultView.jQuery(resolve)));
    await verifyStudyzShortcuts(page, frame);
    assert.equal(page.url(), url);
    assert.equal(await frame.locator("#question_options").getAttribute("data-id"), "17174");
    await page.evaluate(() => { window.__syncFixture.commitThenFailNextAttempt = true; });
    await page.keyboard.press("i");
    await page.keyboard.press("Enter");
    await expect(page.locator("#exam-practice-reader-error-detail")).toContainText("attempt-sync");
    await expect(frame.locator("#answer .question_answer.wrong")).toBeVisible();
    await page.locator("#exam-practice-reader-error-retry").click();
    await expect(page.locator("#exam-practice-reader-error-dialog")).toHaveCount(0);
    await page.waitForFunction(site => {
      const pending = window.__getGMValue("exam-practice-reader." + site + ".v9.pending-attempt");
      return pending?.phase === "recorded" && pending.copy.state === "restricted";
    }, STUDYZ_BOKI3_SITE);
    await expect(page).toHaveURL(url);
    await expect(frame.locator("#answer .question_answer.wrong")).toBeVisible();
    const operations = await page.evaluate(() => window.__syncFixture.calls
      .filter(call => new URL(call.url).pathname === "/v12/attempts").map(call => call.body.operationId));
    assert.equal(operations.length, 2);
    assert.equal(operations[0], operations[1]);
    assert.equal(await page.evaluate(() => window.__syncFixture.attemptCount), 1);
    assert.deepEqual(await page.evaluate(() => window.__syncFixture.clipboardWrites), []);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(questionURL(STUDYZ_BOKI3_SITE, "17139"));
    await page.locator('#exam-practice-reader-time-limit[data-phase="question"]').waitFor();
    assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
  } finally { await browser.close(); }
});

test("fresh Studyz questions accept desktop and touch answers after an interrupted attempt", { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const site = STUDYZ_BOKI3_SITE;
    const queued = { site, questionId: "17174", pageURL: questionURL(site, "17174"),
      operationId: "a".repeat(32), phase: "queued", answerResult: "incorrect", copy: { state: "restricted" } };
    const previous = { ...queued, phase: "recorded", nextURL: questionURL(site, "17139") };
    for (const [id, choice, device, pendingAttempt] of [
      ["17140", "1", "Desktop Chrome", previous],
      ["17174", "8", "iPhone 13", previous],
      ["17174", "8", "Desktop Chrome", { ...previous, copy: { state: "required" } }],
      ["17140", "1", "Desktop Chrome", { ...previous, answerResult: "correct", kpiQuestionsRemaining: 1 }],
      ["17140", "1", "Desktop Chrome", queued],
    ]) {
      const { context, script } = await studyzReaderContext(browser, device);
      const page = await context.newPage();
      await page.goto("https://1studyz.com/boki3/random", { waitUntil: "domcontentloaded" });
      await page.goto(questionURL(site, id), { waitUntil: "domcontentloaded" });
      await syncFixture.installSyncFixture(page, { site, pendingAttempt, nextQuestionId: "17144" });
      await page.addScriptTag({ content: script });
      await page.locator('#exam-practice-reader-time-limit[data-phase="question"]').waitFor();
      const frame = page.frameLocator("#exam-practice-reader-frame");
      await frame.locator("body").evaluate(body => new Promise(resolve => body.ownerDocument.defaultView.jQuery(resolve)));
      const replayed = pendingAttempt.phase === "queued" ? 1 : 0;
      const attemptCount = () => page.evaluate(() => window.__syncFixture.attemptCount);
      await expect.poll(attemptCount).toBe(replayed);
      const option = frame.locator(`#question_options li[data-selected="${choice}"]`);
      if (devices[device].hasTouch) await option.tap();
      else await option.click();
      await expect(frame.locator("#answer .question_answer.wrong")).toBeVisible();
      await expect.poll(attemptCount).toBe(replayed + 1);
      const attempts = await page.evaluate(() => window.__syncFixture.calls
        .filter(call => new URL(call.url).pathname === "/v12/attempts").map(call => call.body));
      assert.equal(attempts.length, replayed + 1);
      if (replayed) assert.equal(attempts[0].operationId, previous.operationId);
      const attempt = attempts.at(-1);
      assert.notEqual(attempt.operationId, previous.operationId);
      assert.deepEqual([attempt.site, attempt.questionId, attempt.answerResult], [site, id, "incorrect"]);
      if (devices[device].hasTouch) {
        const questionFrame = page.frames().find(candidate => candidate.parentFrame() === page.mainFrame() &&
          candidate.url() === questionURL(site, id));
        const swipe = await frameSupport.dispatchNextQuestionSwipe(questionFrame);
        assert.equal(swipe.endDefaultPrevented, true);
      } else {
        await page.keyboard.press("Enter");
      }
      await expect(page).toHaveURL(questionURL(site, "17144"));
      await context.close();
    }
  } finally { await browser.close(); }
});
