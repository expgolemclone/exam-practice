import { spawn } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import examPracticeConfig from "./config.cjs";
import chromeDevTools from "./chrome-devtools.cjs";
import windowsChromeProfile from "./windows-chrome-profile.cjs";

const { examPracticeFreeEnvironment, readExamPracticeConfiguration } = examPracticeConfig;
const {
  TAMPERMONKEY_BETA_EXTENSION_ID,
  activePortPath,
  prepareExamPracticePage,
  readDevToolsActivePort,
  waitForDevToolsActivePort,
} = chromeDevTools;
const {
  CHROME_AUTOPLAY_ARGUMENT,
  CHROME_REMOTE_DEBUGGING_ARGUMENT,
  inspectDedicatedChrome,
  isSameOrDescendantPath,
  stopDedicatedChrome,
} = windowsChromeProfile;

export const EXAM_PRACTICE_OPEN_URL = "https://exam-practice-sync.expgolemclone.workers.dev/open";
export { CHROME_AUTOPLAY_ARGUMENT, CHROME_REMOTE_DEBUGGING_ARGUMENT };
export const CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT = "--hide-crash-restore-bubble";
export const CHROME_BOOTSTRAP_URL = "about:blank";
const READER_METADATA_PATH = fileURLToPath(
  new URL("../reader/src/userscript.meta.txt", import.meta.url),
);

export function readUserscriptIdentity({ readFile = readFileSync } = {}) {
  const source = readFile(READER_METADATA_PATH, "utf8");
  const readDirective = (directive) => {
    const matches = [...source.matchAll(new RegExp(`^// @${directive}\\s+(.+)$`, "gm"))];
    if (matches.length !== 1 || matches[0][1].trim() === "") {
      throw new Error(`Reader metadata must contain exactly one @${directive} directive`);
    }
    return matches[0][1].trim();
  };
  return Object.freeze({
    name: readDirective("name"),
    namespace: readDirective("namespace"),
  });
}

function requirePathType(candidatePath, expectedType, stat = statSync) {
  let stats;
  try {
    stats = stat(candidatePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${expectedType} was not found: ${candidatePath}`);
    }
    throw error;
  }

  const matches = expectedType === "Chrome executable" ? stats.isFile() : stats.isDirectory();
  if (!matches) {
    throw new Error(`${expectedType} has an unexpected type: ${candidatePath}`);
  }
}

export function resolveExamPracticeLaunch({
  configuration = readExamPracticeConfiguration(),
  platform = process.platform,
  stat = statSync,
  systemEnvironment = process.env,
} = {}) {
  if (platform !== "win32") {
    throw new Error("open requires Windows");
  }

  const programFiles = systemEnvironment.ProgramFiles;
  if (!programFiles) {
    throw new Error("ProgramFiles is not set");
  }
  const localAppData = systemEnvironment.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error("LOCALAPPDATA is not set");
  }

  const executablePath = path.win32.resolve(
    configuration.EXAM_PRACTICE_CHROME_EXECUTABLE ??
      path.win32.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
  );
  const userDataDir = path.win32.resolve(
    configuration.EXAM_PRACTICE_CHROME_USER_DATA_DIR ??
      path.win32.join(localAppData, "exam-practice-chrome-e2e"),
  );
  const standardUserDataDir = path.win32.resolve(
    path.win32.join(localAppData, "Google", "Chrome", "User Data"),
  );

  requirePathType(executablePath, "Chrome executable", stat);
  requirePathType(userDataDir, "Dedicated Chrome profile", stat);
  if (isSameOrDescendantPath(standardUserDataDir, userDataDir, path.win32)) {
    throw new Error(
      "EXAM_PRACTICE_CHROME_USER_DATA_DIR must be outside the standard Chrome user data directory",
    );
  }

  return {
    arguments: [
      `--user-data-dir=${userDataDir}`,
      CHROME_HIDE_CRASH_RESTORE_BUBBLE_ARGUMENT,
      CHROME_AUTOPLAY_ARGUMENT,
      CHROME_REMOTE_DEBUGGING_ARGUMENT,
      CHROME_BOOTSTRAP_URL,
    ],
    executablePath,
    userDataDir,
  };
}

function isCompatibleExamPracticeProfile(profileState) {
  return (
    profileState.processCount > 0 &&
    profileState.autoplayAllowed &&
    profileState.remoteDebuggingEnabled
  );
}

export async function ensureExamPracticeBrowser({
  configuration = readExamPracticeConfiguration(),
  inspectProfile = inspectDedicatedChrome,
  platform = process.platform,
  readDevToolsPort = readDevToolsActivePort,
  removeFile = rmSync,
  spawnProcess = spawn,
  stat = statSync,
  stopProfile = stopDedicatedChrome,
  systemEnvironment = process.env,
  waitForDevToolsPort = waitForDevToolsActivePort,
} = {}) {
  const launch = resolveExamPracticeLaunch({
    configuration,
    platform,
    stat,
    systemEnvironment,
  });
  const profileState = inspectProfile(launch.userDataDir, {
    systemEnvironment,
  });
  const existingProfileIsCompatible = isCompatibleExamPracticeProfile(profileState);
  if (profileState.processCount > 0 && !existingProfileIsCompatible) {
    stopProfile(launch.userDataDir, { systemEnvironment });
  }
  const coldStart = !existingProfileIsCompatible;
  let port;
  if (coldStart) {
    removeFile(activePortPath(launch.userDataDir), { force: true });
    const browserProcess = spawnProcess(launch.executablePath, launch.arguments, {
      detached: true,
      env: examPracticeFreeEnvironment(systemEnvironment),
      stdio: "ignore",
    });
    browserProcess.unref();
    port = await waitForDevToolsPort(launch.userDataDir, browserProcess);
  } else {
    port = readDevToolsPort(launch.userDataDir);
  }

  return Object.freeze({
    ...launch,
    browserStarted: coldStart,
    devToolsPort: port,
  });
}

export async function openExamPracticeURL({
  configuration = readExamPracticeConfiguration(),
  inspectProfile = inspectDedicatedChrome,
  platform = process.platform,
  prepareBrowser = prepareExamPracticePage,
  readDevToolsPort = readDevToolsActivePort,
  stat = statSync,
  systemEnvironment = process.env,
  userscriptIdentity = readUserscriptIdentity(),
} = {}) {
  const launch = resolveExamPracticeLaunch({
    configuration,
    platform,
    stat,
    systemEnvironment,
  });
  const profileState = inspectProfile(launch.userDataDir, {
    systemEnvironment,
  });
  if (!isCompatibleExamPracticeProfile(profileState)) {
    throw new Error("Dedicated Chrome is not ready for the application URL");
  }
  const port = readDevToolsPort(launch.userDataDir);

  const prepared = await prepareBrowser(port, {
    openURL: EXAM_PRACTICE_OPEN_URL,
    target: null,
    tampermonkeyExtensionId: TAMPERMONKEY_BETA_EXTENSION_ID,
    userscriptIdentity,
  });
  return Object.freeze({
    ...launch,
    applicationOpened: true,
    devToolsPort: port,
    targetId: prepared.targetId,
  });
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  try {
    const phase = process.argv[2];
    if (phase === "browser") {
      await ensureExamPracticeBrowser();
    } else if (phase === "url") {
      await openExamPracticeURL();
    } else {
      throw new Error("open-study requires exactly one phase: browser or url");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
