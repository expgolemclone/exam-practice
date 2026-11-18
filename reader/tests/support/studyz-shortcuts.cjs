const assert = require("node:assert/strict");
const { expect } = require("playwright/test");

async function verifyStudyzShortcuts(page, frame) {
  const choices = frame.locator("#question_choice_container .answer-list dl");
  assert.equal(await choices.count(), 8);
  for (const focus of ["outer", "frame"]) {
    if (focus === "frame") await page.locator("#exam-practice-reader-frame").focus();
    for (const [index, key] of [..."asdfghjk"].entries()) {
      const choice = choices.nth(index);
      await page.keyboard.press(key);
      await expect(choice).toHaveClass("clicked");
      await expect(choice).toHaveCSS("text-decoration-line", "line-through");
      await page.keyboard.press(key);
      await expect(choice).not.toHaveClass("clicked");
      await expect(choice).toHaveCSS("text-decoration-line", "none");
    }
    for (const [index, key] of [..."qwertyui"].entries()) {
      await page.keyboard.press(key);
      const selected = frame.locator("#question_options li[data-exam-practice-selected]");
      await expect(selected).toHaveCount(1);
      await expect(selected).toHaveAttribute("data-selected", String(index + 1));
    }
    const scrollY = () => frame.locator("body").evaluate(body => body.ownerDocument.defaultView.scrollY);
    await frame.locator("body").evaluate(body => body.ownerDocument.defaultView.scrollTo(0, 100));
    await page.keyboard.press("z");
    await expect.poll(scrollY).toBe(200);
    await page.keyboard.press("x");
    await expect.poll(scrollY).toBe(100);
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await expect.poll(scrollY).toBe(0);
    await expect(choices.nth(4)).not.toHaveClass("clicked");
  }
}

module.exports = { verifyStudyzShortcuts };
