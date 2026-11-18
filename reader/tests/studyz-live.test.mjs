import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
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

test("Reader shortcuts and restricted incorrect-answer review work on real Studyz question 17174 with fixture sync", { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" });
    await adSupport.blockAdRequests(context);
    const script = await readFile(new URL("../dist/exam-practice-reader.user.js", import.meta.url), "utf8");
    await frameSupport.installReaderInChildFrames(context, script);
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
    await page.keyboard.press("i");
    await page.keyboard.press("Enter");
    await page.waitForFunction(async site => {
      const pending = await GM.getValue("exam-practice-reader." + site + ".v9.pending-attempt");
      return pending?.phase === "recorded" && pending.copy.state === "restricted";
    }, STUDYZ_BOKI3_SITE);
    await expect(page).toHaveURL(url);
    await expect(frame.locator("#answer .question_answer.wrong")).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.__syncFixture.clipboardWrites), []);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(questionURL(STUDYZ_BOKI3_SITE, "17139"));
    await page.locator('#exam-practice-reader-time-limit[data-phase="question"]').waitFor();
    assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
  } finally { await browser.close(); }
});
