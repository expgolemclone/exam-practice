import assert from "node:assert/strict";
import test from "node:test";

import {
  IPHONE_RUNTIME_RECYCLE_AFTER_TRANSITIONS,
  createReaderRuntimeRecycleTracker,
} from "../src/runtime-recycle.mjs";

const siteId = "chushoks.kakomonn.com";
const origin = "https://" + siteId;

test("reader runtime recycle tracker fires after 25 completed question transitions", () => {
  assert.equal(IPHONE_RUNTIME_RECYCLE_AFTER_TRANSITIONS, 25);
  const tracker = createReaderRuntimeRecycleTracker(siteId);
  assert.equal(tracker.record(`${origin}/questions/1000`), false);
  for (let index = 1; index < 25; index += 1) {
    assert.equal(tracker.record(`${origin}/questions/${1000 + index}`), false);
  }
  assert.equal(tracker.record(`${origin}/questions/1025`), true);
});

test("reader runtime recycle tracker ignores duplicate and non-question loads", () => {
  const tracker = createReaderRuntimeRecycleTracker(siteId, 2);
  assert.equal(tracker.record(`${origin}/questions/1000`), false);
  assert.equal(tracker.record(`${origin}/questions/1000`), false);
  assert.equal(tracker.record("about:blank"), false);
  assert.equal(tracker.record(`${origin}/questions/1001?cached=1`), false);
  assert.equal(tracker.record("https://example.com/questions/1001"), false);
  assert.equal(tracker.record(`${origin}/questions/1001`), false);
  assert.equal(tracker.record(`${origin}/questions/next/1002`), true);
});

test("reader runtime recycle tracker follows the 1st Studyz course URL rules", () => {
  const tracker = createReaderRuntimeRecycleTracker("studyz-boki3", 1);
  assert.equal(tracker.record("https://1studyz.com/boki3/test/17139/"), false);
  assert.equal(tracker.record("https://1studyz.com/boki2/test/17140/"), false);
  assert.equal(tracker.record("https://1studyz.com/boki3/test/17140/"), true);
});

test("reader runtime recycle tracker rejects invalid transition limits", () => {
  for (const transitionLimit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => createReaderRuntimeRecycleTracker(siteId, transitionLimit), TypeError);
  }
});
