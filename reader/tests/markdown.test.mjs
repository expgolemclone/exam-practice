import assert from "node:assert/strict";
import test from "node:test";
import { build } from "vite";
import { chromium } from "playwright";
import configuration from "../../scripts/config.cjs";

const fixture = `<div id="js-answer-result-box" class="is-correct"></div>
  <div class="problem_detail"><div class="when">Question 問1</div>
    <div class="question-writing-scroll"><div class="ttl">Question text <span hidden>hidden question</span></div></div>
    <p class="question-writing-hint">Scroll hint</p>
    <div class="zoomin"><a href="/question-diagram.png"><img src="/question-diagram.png" alt="Question diagram"><span>Open image in a new tab</span></a></div>
    <ul class="list"><li><label><input type="radio" name="answer" checked>Answer A</label></li>
      <li><label><input type="radio" name="answer">Answer B</label></li></ul>
    <button>解答する</button></div>
  <div id="js-commentary-wrap"><div class="item"><div class="num">01</div>
    <div class="text"><ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>
      <ol start="3"><li>Third<ol><li>Nested ordered</li></ol></li></ol>
      <p><a href="javascript:alert(1)">Unsafe link text</a></p>
      <p><a href="/reference">Reference</a></p>
      <img src="/diagram.png"><p>Between diagrams</p><img src="/second.png">
      <a href="/diagram.png"><img src="/diagram.png"></a>
      <a href="/image-reference"><img src="/linked-diagram.png" alt="Linked diagram"><span>Related diagram</span></a>
      <span style="display:none">hidden explanation</span>
    </div></div></div>`;

test("wrapped question text is read and copied with structured, visible Markdown", async () => {
  const output = await build({ configFile: false, logLevel: "silent", build: {
    write: false, minify: false,
    lib: { entry: "reader/src/markdown.js", name: "MarkdownTest", formats: ["iife"] },
  } });
  const code = (Array.isArray(output) ? output[0] : output).output.find(item => item.type === "chunk").code;
  const contentOutput = await build({ configFile: false, logLevel: "silent", build: {
    write: false, minify: false,
    lib: { entry: "reader/src/sites/kakomonn.js", name: "SiteTest", formats: ["iife"] },
  } });
  const contentCode = (Array.isArray(contentOutput) ? contentOutput[0] : contentOutput)
    .output.find(item => item.type === "chunk").code;
  const local = configuration.readExamPracticeConfiguration();
  const browser = await chromium.launch({ headless: true,
    channel: "chrome",
    env: configuration.examPracticeFreeEnvironment(),
    ...(local.EXAM_PRACTICE_CHROME_EXECUTABLE ? { executablePath: local.EXAM_PRACTICE_CHROME_EXECUTABLE } : {}),
  });
  try {
    const page = await browser.newPage();
    await page.route("https://chushoks.kakomonn.com/**", route => route.fulfill({
      status: 200, contentType: "text/html; charset=utf-8", body: fixture,
    }));
    await page.goto("https://chushoks.kakomonn.com/questions/1");
    await page.addScriptTag({ content: code });
    await page.addScriptTag({ content: contentCode });
    assert.equal(await page.evaluate(() => SiteTest.extractQuestionTextFromDocument(document)), "Question text");
    const { state, markdown } = await page.evaluate(() => MarkdownTest.buildCopyMarkdown(document, SiteTest.kakomonn));
    assert.equal(state, "ready");
    assert.match(markdown, /## 問題文\n\nQuestion text/);
    assert.doesNotMatch(markdown, /Scroll hint/);
    assert.match(markdown, /- +Parent\n +- +Child\n- +Sibling/);
    assert.match(markdown, /3\. +Third\n +1\. +Nested ordered/);
    assert.match(markdown, /Unsafe link text/);
    assert.doesNotMatch(markdown, /javascript:|hidden question|hidden explanation/);
    assert.match(markdown, /\[Reference\]\(https:\/\/chushoks.kakomonn.com\/reference\)/);
    assert.equal(markdown.split("https://chushoks.kakomonn.com/diagram.png").length - 1, 1);
    assert.equal(markdown.split("https://chushoks.kakomonn.com/question-diagram.png").length - 1, 1);
    assert.match(markdown, /!\[Question diagram\]/);
    assert.match(markdown, /Open image in a new tab/);
    assert.match(markdown, /!\[Linked diagram\]/);
    assert.equal(markdown.includes("](https://chushoks.kakomonn.com/image-reference)"), true);
    assert.match(markdown, /!\[解説画像 1\]\(https:\/\/chushoks\.kakomonn\.com\/diagram\.png\)\s+Between diagrams\s+!\[解説画像 2\]\(https:\/\/chushoks\.kakomonn\.com\/second\.png\)/);
  } finally {
    await browser.close();
  }
});
