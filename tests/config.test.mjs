import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  EXAM_PRACTICE_CONFIGURATION_KEYS,
  REPOSITORY_CONFIGURATION_PATH,
  examPracticeFreeEnvironment,
  readExamPracticeConfiguration,
  requireExamPracticeConfiguration,
} = require("../scripts/config.cjs");

function configurationFrom(contents) {
  return readExamPracticeConfiguration({
    existsSync: () => true,
    readFileSync: () => contents,
  });
}

test("configuration is relative to its source, not the working directory", () => {
  assert.equal(REPOSITORY_CONFIGURATION_PATH,
    fileURLToPath(new URL("../exam-practice.toml", import.meta.url)));
  let observed;
  readExamPracticeConfiguration({
    existsSync(file) { observed = file; return false; },
    readFileSync() { assert.fail("absent configuration must not be read"); },
  });
  assert.equal(observed, REPOSITORY_CONFIGURATION_PATH);
});

test("reads only supported non-empty string settings from TOML", () => {
  assert.deepEqual(configurationFrom([
    '# configuration',
    'EXAM_PRACTICE_SYNC_TOKEN = "fixture-token"',
    "EXAM_PRACTICE_CHROME_USER_DATA_DIR = 'C:\\profiles\\exam-practice'",
    'EXAM_PRACTICE_READER_SCRIPT_PATH = ""',
  ].join("\n")), {
    EXAM_PRACTICE_SYNC_TOKEN: "fixture-token",
    EXAM_PRACTICE_CHROME_USER_DATA_DIR: "C:\\profiles\\exam-practice",
  });
});

test("returns an empty frozen configuration when the file is absent", () => {
  const configuration = readExamPracticeConfiguration({ existsSync: () => false });
  assert.deepEqual(configuration, {});
  assert.equal(Object.isFrozen(configuration), true);
});

test("the parser rejects duplicate keys including quoted key spellings", () => {
  for (const key of ['EXAM_PRACTICE_SYNC_TOKEN', '"EXAM_PRACTICE_SYNC_TOKEN"', "'EXAM_PRACTICE_SYNC_TOKEN'"]) {
    assert.throws(() => configurationFrom(
      `EXAM_PRACTICE_SYNC_TOKEN = "first"\n${key} = "second"\n`), /already|duplicate/i);
  }
});

test("quoted multi-line values are not reparsed as configuration keys", () => {
  assert.deepEqual(configurationFrom('EXAM_PRACTICE_SYNC_TOKEN = """\nfirst\nEXAM_PRACTICE_UNKNOWN_SETTING=literal\nlast"""'), {
    EXAM_PRACTICE_SYNC_TOKEN: "first\nEXAM_PRACTICE_UNKNOWN_SETTING=literal\nlast",
  });
});

test("rejects unsupported keys, non-string values, and dotenv export syntax", () => {
  assert.throws(() => configurationFrom('EXAM_PRACTICE_UNKNOWN_SETTING = "value"'), /Unsupported/);
  assert.throws(() => configurationFrom('EXAM_PRACTICE_SYNC_TOKEN = 123'), /must be a string/);
  assert.throws(() => configurationFrom('export EXAM_PRACTICE_SYNC_TOKEN=first'));
});

test("requires explicit values without consulting the process environment", () => {
  const original = process.env.EXAM_PRACTICE_SYNC_TOKEN;
  process.env.EXAM_PRACTICE_SYNC_TOKEN = "stale-process-token";
  try {
    assert.equal(requireExamPracticeConfiguration(
      configurationFrom('EXAM_PRACTICE_SYNC_TOKEN = "fixture-token"'), "EXAM_PRACTICE_SYNC_TOKEN"), "fixture-token");
    assert.throws(() => requireExamPracticeConfiguration({}, "EXAM_PRACTICE_SYNC_TOKEN"), /is not set in/);
  } finally {
    if (original === undefined) delete process.env.EXAM_PRACTICE_SYNC_TOKEN;
    else process.env.EXAM_PRACTICE_SYNC_TOKEN = original;
  }
});

test("removes every ExamPractice setting from child environments", () => {
  assert.deepEqual(examPracticeFreeEnvironment({
    EXAM_PRACTICE_SYNC_TOKEN: "secret", EXAM_PRACTICE_CHROME_EXECUTABLE: "chrome.exe", PATH: "system-path",
  }), { PATH: "system-path" });
  assert.equal(EXAM_PRACTICE_CONFIGURATION_KEYS.length, 4);
});
