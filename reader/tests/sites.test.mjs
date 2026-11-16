import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildSiteBundle } from "./support/site-bundle.mjs";
import { chromium } from "playwright";
import { expect } from "playwright/test";
import { STUDYZ_BOKI3_SITE, questionURL } from "../../contracts/sites.mjs";
import syncFixture from "./support/sync-fixture.cjs";
import frameSupport from "./support/frame_reader.js";

const question = questionURL(STUDYZ_BOKI3_SITE, "17139");
const nextQuestion = questionURL(STUDYZ_BOKI3_SITE, "17140");
function fixture({ restricted = false } = {}) {
  return `<section class="question">
    <div id="answer" style="display:none"><div class="question_answer"></div>
      <span id="answered_item"></span>
      <div id="questionExplanation">${restricted ? '<div class="question_explanation_locked">Log in to read explanations.</div>' :
        '<p>Visible explanation.</p><table><tr><th>Account</th><th>Amount</th></tr><tr><td>Cash</td><td>100</td></tr></table><span hidden>Hidden explanation.</span>'}</div>
      <a class="test_next" href="${nextQuestion}">Next question</a></div>
    <div id="question-open"><div class="question_box_info"><p>Synthetic bookkeeping question.<span hidden>Hidden question.</span></p>
      <div class="question_box_source">Synthetic bookkeeping source</div></div></div>
    <div id="question-image-open"><img src="https://images.example.test/question.png" alt="Question diagram"></div>
    <div id="question_choice_container">${Array.from({ length: 8 }, (_, index) =>
      `<div class="answer-list"><dl><dt>Choice ${index + 1}</dt><dd>Account ${index + 1}</dd></dl></div>`).join("")}</div>
    <ul id="question_options" data-id="17139">${Array.from({ length: 8 }, (_, index) =>
      `<li data-selected="${index + 1}" tabindex="0">${index + 1}</li>`).join("")}</ul>
    </section><script>
    window.nativeSubmissions = 0;
    document.querySelectorAll('#question_options li').forEach(option => option.addEventListener('click', () => {
      window.nativeSubmissions++;
      document.querySelector('.question_answer').className = 'question_answer ' + (option.dataset.selected === '8' ? 'correct' : 'wrong');
      document.querySelector('#answered_item').textContent = option.dataset.selected;
      for (const id of ['question-open', 'question-image-open', 'question_choice_container', 'question_options']) document.getElementById(id).style.display = 'none';
      document.querySelector('#answer').style.display = 'block';
    }));
    document.querySelectorAll('.answer-list dl').forEach(choice => choice.addEventListener('click', () => choice.classList.toggle('clicked')));
    </script><style>#question_options li {display:inline-block;padding:10px}.answer-list {padding:8px}</style>`;
}

test("1st Studyz site integration uses native submission, eight choices, visible snapshots and authorization", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const bundle = await buildSiteBundle();
  try {
    for (const restricted of [false, true]) {
      const page = await browser.newPage();
      await page.route("https://1studyz.com/boki3/**", route => route.fulfill({ contentType: "text/html", body: fixture({ restricted }) }));
      await page.goto(question);
      await page.addScriptTag({ content: bundle });
      const result = await page.evaluate(() => {
        const site = SiteTest.studyzBoki3;
        const controls = site.currentQuestionControls(document);
        const before = site.copySource(document).state;
        const selected = site.selectChoice(controls, 7);
        const submissionsBeforeCommit = window.nativeSubmissions;
        const submitted = site.submitAnswer(controls);
        return { before, selected, submissionsBeforeCommit, submitted, count: controls.answerChoiceControls.length,
          answer: site.answerResultFromDocument(document), submissions: window.nativeSubmissions,
          copy: SiteTest.buildCopyMarkdown(document, site) };
      });
      assert.equal(result.before, "locked");
      assert.equal(result.count, 8);
      assert.equal(result.selected, true);
      assert.equal(result.submissionsBeforeCommit, 0);
      assert.equal(result.submitted, true);
      assert.equal(result.submissions, 1);
      assert.equal(result.answer, "correct");
      assert.equal(result.copy.state, restricted ? "restricted" : "ready");
      if (!restricted) {
        assert.match(result.copy.markdown, /Synthetic bookkeeping question/);
        assert.match(result.copy.markdown, /Question diagram/);
        assert.match(result.copy.markdown, /選択肢8: Choice 8/);
        assert.match(result.copy.markdown, /\| Account \| Amount \|/);
        assert.doesNotMatch(result.copy.markdown, /Hidden question|Hidden explanation/);
      } else assert.equal(result.copy.markdown, "");
      await page.close();
    }
  } finally { await browser.close(); }
});

test("1st Studyz catalogs use all public question sitemaps and reject cross-course entries", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    await page.goto("about:blank");
    await page.addScriptTag({ content: await buildSiteBundle() });
    const result = await page.evaluate(async siteId => {
      const documents = new Map([
        ['https://1studyz.com/boki3/wp-sitemap.xml', '<sitemapindex><sitemap><loc>https://1studyz.com/boki3/wp-sitemap-posts-questions-1.xml</loc></sitemap><sitemap><loc>https://1studyz.com/boki3/wp-sitemap-posts-questions-2.xml</loc></sitemap></sitemapindex>'],
        ['https://1studyz.com/boki3/wp-sitemap-posts-questions-1.xml', '<urlset><url><loc>https://1studyz.com/boki3/test/17139</loc></url></urlset>'],
        ['https://1studyz.com/boki3/wp-sitemap-posts-questions-2.xml', '<urlset><url><loc>https://1studyz.com/boki3/test/17427/</loc></url></urlset>'],
      ]);
      const calls = [];
      const load = async url => { calls.push(url); return new DOMParser().parseFromString(documents.get(url), 'application/xml'); };
      const options = { SyncRequestError: Error };
      const ids = await SiteTest.studyzBoki3.loadCatalog(siteId, load, options);
      documents.set('https://1studyz.com/boki3/wp-sitemap-posts-questions-2.xml', '<urlset><url><loc>https://1studyz.com/boki2/test/1/</loc></url></urlset>');
      let rejected = false;
      try { await SiteTest.studyzBoki3.loadCatalog(siteId, load, options); } catch { rejected = true; }
      return { ids, rejected, firstCalls: calls.slice(0, 3) };
    }, STUDYZ_BOKI3_SITE);
    assert.deepEqual(result.ids, ["17139", "17427"]);
    assert.equal(result.firstCalls.length, 3);
    assert.equal(result.rejected, true);
  } finally { await browser.close(); }
});

test("the shared Reader records a restricted eight-choice answer without copying gated content", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" });
    const script = await readFile(new URL("../dist/exam-practice-reader.user.js", import.meta.url), "utf8");
    await frameSupport.installReaderInChildFrames(context, script);
    await context.route("https://1studyz.com/boki3/**", route => route.fulfill({ contentType: "text/html", body: fixture({ restricted: true }) }));
    const page = await context.newPage();
    page.on("pageerror", error => console.error("Reader page error:", error.message));
    await page.goto(question);
    await syncFixture.installSyncFixture(page, { site: STUDYZ_BOKI3_SITE, nextQuestionId: "17140" });
    await page.addScriptTag({ content: script });
    const frame = page.frameLocator("#exam-practice-reader-frame");
    await frame.locator("#question_options li").first().waitFor({ timeout: 5000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ url: location.href, ua: navigator.userAgent, body: document.body.innerText.slice(0, 500), frames: [...document.querySelectorAll("iframe")].map(frame => ({ id: frame.id, src: frame.src, body: frame.contentDocument?.body?.innerText.slice(0, 500) })) })));
      throw error;
    });
    await page.waitForFunction(() => document.querySelector("#exam-practice-reader-error-dialog") === null);
    await page.keyboard.press("q");
    await frame.locator('#question_options li[data-exam-practice-selected=""]').waitFor();
    await page.keyboard.press("Enter");
    await frame.locator("#answer").waitFor({ state: "visible" });
    await page.waitForFunction(() => window.__syncFixture.calls.some(call => new URL(call.url).pathname === "/v12/attempts"));
    await page.waitForFunction(site => window.__syncFixture.storageWrites.some(write =>
      write.key === "exam-practice-reader." + site + ".v9.pending-attempt" && write.value?.copy?.state === "not-required"), STUDYZ_BOKI3_SITE);
    const recorded = await page.evaluate(() => ({ calls: window.__syncFixture.calls, copied: window.__syncFixture.clipboardWrites }));
    const attempt = recorded.calls.find(call => new URL(call.url).pathname === "/v12/attempts");
    assert.equal(attempt.body.site, STUDYZ_BOKI3_SITE);
    assert.equal(attempt.body.questionId, "17139");
    assert.equal(attempt.body.answerResult, "incorrect");
    assert.deepEqual(recorded.copied, []);
    assert.equal(recorded.calls.some(call => new URL(call.url).pathname === "/v12/copy-failures"), false);
  } finally { await browser.close(); }
});


test("source overview pages retain pending data without starting question synchronization", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const script = await readFile(new URL("../dist/exam-practice-reader.user.js", import.meta.url), "utf8");
  try {
    for (const [url, site] of [["https://chushoks.kakomonn.com/", "chushoks.kakomonn.com"],
        ["https://1studyz.com/boki3/test/", STUDYZ_BOKI3_SITE]]) {
      const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route(url, route => route.fulfill({ contentType: "text/html", body: "<main>Start a native question.</main>" }));
      await page.goto(url);
      await syncFixture.installSyncFixture(page, { site });
      const pending = { operationId: "overview-fixture", copy: { state: "required" } };
      await page.evaluate(({ site, pending }) => GM.setValue("exam-practice-reader." + site + ".v9.pending-attempt", pending), { site, pending });
      await page.addScriptTag({ content: script });
      assert.deepEqual(await page.evaluate(site => GM.getValue("exam-practice-reader." + site + ".v9.pending-attempt"), site), pending);
      assert.equal(await page.locator("#exam-practice-reader-shell").count(), 0);
      assert.deepEqual(await page.evaluate(() => window.__syncFixture.calls), []);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
});

test("the course launcher initializes and recovers an expired native iframe session", async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36" });
    const script = await readFile(new URL("../dist/exam-practice-reader.user.js", import.meta.url), "utf8");
    await frameSupport.installReaderInChildFrames(context, script);
    let session = false;
    let canInitialize = true;
    let initializations = 0;
    await context.route("https://1studyz.com/boki3/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/boki3/test/") && path !== "/boki3/test/" && !session) {
        return route.fulfill({ contentType: "text/html", body: '<script>history.replaceState(null, "", "/boki3/test/")</script><main>Start a native question.</main>' });
      }
      return route.fulfill({ contentType: "text/html", body: path === "/boki3/test/" ? "<main>Start a native question.</main>" : fixture({ restricted: true }) });
    });
    const page = await context.newPage();
    await page.goto("https://1studyz.com/boki3/test/#exam-practice-next");
    await page.exposeFunction("initializeSessionFixture", () => { session = canInitialize; initializations++; });
    await page.evaluate(question => {
      const nativeFetch = window.fetch;
      window.fetch = async (...args) => {
        if (args[0] !== "https://1studyz.com/boki3/random") return nativeFetch(...args);
        await window.initializeSessionFixture();
        const result = new Response("", { status: 200 });
        Object.defineProperty(result, "url", { value: question });
        return result;
      };
    }, question);
    await syncFixture.installSyncFixture(page, { site: STUDYZ_BOKI3_SITE, nextQuestionId: "17140" });
    await page.addScriptTag({ content: script });
    const frame = page.frameLocator("#exam-practice-reader-frame");
    await frame.locator("#question_options li").first().waitFor({ timeout: 5000 }).catch(async error => {
      console.error("Launcher diagnostic", await page.evaluate(() => ({ body: document.body.innerText.slice(0, 2000), calls: window.__syncFixture.calls.map(call => call.url) })), { initializations });
      throw error;
    });
    assert.equal(initializations, 1);
    session = false;
    await page.evaluate(() => { window.__syncFixture.nextQuestionId = "17139"; });
    await page.keyboard.press("n");
    await expect.poll(() => initializations, { timeout: 5000 }).toBe(2);
    await frame.locator("#question_options li").first().waitFor();
    assert.equal(await page.locator("#exam-practice-reader-error-dialog").count(), 0);
    assert.equal(new URL(page.url()).origin, "https://1studyz.com");
    session = false;
    canInitialize = false;
    await page.evaluate(() => { window.__syncFixture.nextQuestionId = "17140"; });
    await page.keyboard.press("n");
    await page.locator("#exam-practice-reader-error-dialog").waitFor();
    assert.equal(initializations, 3);
    await page.waitForTimeout(100);
    assert.equal(initializations, 3, "A failed session recovery must not loop");
  } finally { await browser.close(); }
});
