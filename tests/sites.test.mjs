import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SITE, STUDYZ_BOKI3_SITE, canonicalQuestionIds, isSite, sourceForURL,
  questionURL, questionIdFromURL, scheduledQuestionId, siteStartURL, launchQuestionURL, openSite } from "../contracts/sites.mjs";
import { celebrationURL } from "@expgolemclone/congratulations/celebration";
import { migrateReaderStorage } from "../reader/src/storage-migration.js";

test("sources distinguish the course from its hostname without changing existing identities", () => {
  assert.equal(isSite(DEFAULT_SITE), true);
  assert.equal(isSite(STUDYZ_BOKI3_SITE), true);
  for (const invalid of ["1studyz.com", "1studyz.com/boki2", "kakomonn.com", "fake.kakomonn.com.evil.test", null]) {
    assert.equal(isSite(invalid), false, String(invalid));
  }
  assert.equal(sourceForURL("https://1studyz.com/boki3/test/17139/").id, STUDYZ_BOKI3_SITE);
  for (const invalid of ["https://1studyz.com/boki30/test/1/", "https://1studyz.com/boki2/test/1/",
    "https://1studyz.com:444/boki3/test/1/", "http://1studyz.com/boki3/test/1/", "https://user@1studyz.com/boki3/test/1/"]) {
    assert.equal(sourceForURL(invalid), null, invalid);
  }
});

test("each source owns canonical, strict scheduled URLs and a session-aware launch destination", () => {
  assert.equal(questionURL(DEFAULT_SITE, "1"), "https://chushoks.kakomonn.com/questions/1");
  const question = questionURL(STUDYZ_BOKI3_SITE, "17139");
  assert.equal(question, "https://1studyz.com/boki3/test/17139/");
  assert.equal(scheduledQuestionId(question, STUDYZ_BOKI3_SITE), "17139");
  assert.equal(questionIdFromURL(question.slice(0, -1), STUDYZ_BOKI3_SITE), "17139");
  for (const invalid of [question.slice(0, -1), question + "?x=1", question + "#answer",
    question.replace("1studyz.com", "1studyz.com.evil.test"), question.replace("boki3", "boki2"),
    question.replace("17139", "9223372036854775808")]) {
    assert.equal(scheduledQuestionId(invalid, STUDYZ_BOKI3_SITE), null, invalid);
  }
  assert.equal(launchQuestionURL(question, STUDYZ_BOKI3_SITE), siteStartURL(STUDYZ_BOKI3_SITE));
  assert.equal(new URL(celebrationURL({ source: STUDYZ_BOKI3_SITE, date: "2026-11-16", achievement: "daily-study-quota" })).searchParams.get("source"), STUDYZ_BOKI3_SITE);
  assert.equal(launchQuestionURL(questionURL(DEFAULT_SITE, "1"), DEFAULT_SITE), questionURL(DEFAULT_SITE, "1"));
  assert.deepEqual(canonicalQuestionIds(["10", "2", "01"]), ["01", "2", "10"]);
  assert.throws(() => questionURL(STUDYZ_BOKI3_SITE, "x"), TypeError);
});

test("launch source selection rejects unknown or repeated parameters", () => {
  assert.equal(openSite(""), DEFAULT_SITE);
  assert.equal(openSite("?site=studyz-boki3"), STUDYZ_BOKI3_SITE);
  for (const invalid of ["?site=", "?site=1studyz.com", "?site=x&site=y", "?target=https://evil.test"]) {
    assert.equal(openSite(invalid), null);
  }
});

function storage(initial, failWrite = false) {
  const values = new Map(initial);
  return { values, async listValues() { return [...values.keys()]; },
    async getValue(key) { return structuredClone(values.get(key)); },
    async setValue(key, value) { if (failWrite) throw Error("write failed"); values.set(key, structuredClone(value)); },
    async deleteValue(key) { values.delete(key); } };
}

test("the one-time product rename moves tokens and pending records without retaining aliases", async () => {
  const pending = { operationId: "a".repeat(32), questionId: "1", site: DEFAULT_SITE };
  const gm = storage([["kakomonn-reader.sync-token", "secret"],
    ["kakomonn-reader." + DEFAULT_SITE + ".v9.pending-attempt", pending], ["unrelated", 1]]);
  await migrateReaderStorage(gm);
  assert.equal(gm.values.get("exam-practice-reader.sync-token"), "secret");
  assert.deepEqual(gm.values.get("exam-practice-reader." + DEFAULT_SITE + ".v9.pending-attempt"), pending);
  assert.equal([...gm.values.keys()].some(key => key.startsWith("kakomonn-reader.")), false);
  assert.equal(gm.values.get("unrelated"), 1);
  const snapshot = [...gm.values];
  await migrateReaderStorage(gm);
  assert.deepEqual([...gm.values], snapshot);
});

test("a failed or conflicting migration never deletes the original learning records", async () => {
  const gm = storage([["kakomonn-reader.sync-token", "secret"]], true);
  await assert.rejects(migrateReaderStorage(gm), /write failed/);
  assert.equal(gm.values.get("kakomonn-reader.sync-token"), "secret");
  const conflict = storage([["kakomonn-reader.sync-token", "old"], ["exam-practice-reader.sync-token", "different"]]);
  await assert.rejects(migrateReaderStorage(conflict), /Conflicting Reader storage/);
  assert.equal(conflict.values.get("kakomonn-reader.sync-token"), "old");
});
