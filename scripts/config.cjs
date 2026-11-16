const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("smol-toml");

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_CONFIGURATION_PATH = path.join(REPOSITORY_ROOT, "exam-practice.toml");
const EXAM_PRACTICE_CONFIGURATION_KEYS = Object.freeze([
  "EXAM_PRACTICE_SYNC_TOKEN",
  "EXAM_PRACTICE_CHROME_USER_DATA_DIR",
  "EXAM_PRACTICE_CHROME_EXECUTABLE",
  "EXAM_PRACTICE_READER_SCRIPT_PATH",
]);
const EXAM_PRACTICE_CONFIGURATION_KEY_SET = new Set(EXAM_PRACTICE_CONFIGURATION_KEYS);

function readExamPracticeConfiguration({
  configurationFilePath = REPOSITORY_CONFIGURATION_PATH,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync,
} = {}) {
  if (!existsSync(configurationFilePath)) {
    return Object.freeze({});
  }
  const parsed = parse(readFileSync(configurationFilePath, "utf8"));
  const configuration = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!EXAM_PRACTICE_CONFIGURATION_KEY_SET.has(key)) {
      throw new Error(`Unsupported ExamPractice configuration key: ${key}`);
    }
    if (typeof value !== "string") {
      throw new TypeError(`ExamPractice configuration must be a string: ${key}`);
    }
    if (value !== "") configuration[key] = value;
  }
  return Object.freeze(configuration);
}

function requireExamPracticeConfiguration(configuration, key) {
  if (!EXAM_PRACTICE_CONFIGURATION_KEY_SET.has(key)) {
    throw new Error(`Unsupported ExamPractice configuration key: ${key}`);
  }
  const value = configuration?.[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} is not set in ${REPOSITORY_CONFIGURATION_PATH}`);
  }
  return value;
}

function examPracticeFreeEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.startsWith("EXAM_PRACTICE_")),
  );
}

module.exports = {
  EXAM_PRACTICE_CONFIGURATION_KEYS,
  REPOSITORY_CONFIGURATION_PATH,
  REPOSITORY_ROOT,
  examPracticeFreeEnvironment,
  readExamPracticeConfiguration,
  requireExamPracticeConfiguration,
};
