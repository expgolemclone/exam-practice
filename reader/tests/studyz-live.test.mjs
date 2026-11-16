import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { STUDYZ_BOKI3_SITE, questionURL } from "../../contracts/sites.mjs";
import { buildSiteBundle } from "./support/site-bundle.mjs";

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
