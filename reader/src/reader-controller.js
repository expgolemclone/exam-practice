import { isNextResponse } from "../../contracts/api.mjs";
import { DEFAULT_SITE, launchQuestionURL, openSite, sourceForURL, siteStartURL } from "../../contracts/sites.mjs";
import { createCatalogLoader } from "./catalog.js";
import { isVisibleElement, normalizeInlineText, splitText } from "./content.js";
import { siteModule } from "./sites/index.js";
import { migrateReaderStorage } from "./storage-migration.js";
import {
  CORRECT_FEEDBACK_LEAVE_DURATION_MS,
  CORRECT_FEEDBACK_MINIMUM_DURATION_MS,
  chooseCorrectFeedbackVariant,
  FEEDBACK_AUDIO_URLS,
} from "@expgolemclone/congratulations/feedback";
import { calculateKpiQuestionsRemaining, resolveCorrectFeedbackKpi,
  waitForCorrectFeedbackKpi as waitForCorrectFeedbackKpiResult } from "./feedback-kpi.js";
import { buildCopyMarkdown } from "./markdown.js";
import { FRAME_THEME_CSS, installReaderStyles } from "./styles.js";
import { createSyncRequest } from "./sync-request.js";
import { installSyncController } from "./sync-controller.js";
import { installLauncherController } from "./launcher-controller.js";
import { installViewController } from "./view-controller.jsx";
import { installCopyController } from "./copy-controller.js";
import { installNavigationController } from "./navigation-controller.js";
import { installLifecycleController } from "./lifecycle-controller.js";
import { installSpeechController } from "./speech-controller.js";
import { installShortcutsController } from "./shortcuts-controller.js";
import { installStudyTimeController } from "./study-time-controller.js";
import { installDashboardBridge } from "./dashboard-bridge.js";
import { DASHBOARD_BRIDGE_STATE_ATTRIBUTE } from "../../contracts/dashboard-bridge.mjs";

export async function startReader() {
  const app = {};
  "use strict";

  const READER_FRAME_READY_MESSAGE_TYPE = "exam-practice-reader:frame-ready";
  if (window.top !== window.self) {
    window.parent.postMessage(
      {
        href: location.href,
        type: READER_FRAME_READY_MESSAGE_TYPE,
      },
      location.origin,
    );
    return;
  }

  const BUILD_FINGERPRINT = "__EXAM_PRACTICE_READER_BUILD_FINGERPRINT__";
  const SCRIPT_HANDLER =
    typeof GM_info === "object" && GM_info !== null && typeof GM_info.scriptHandler === "string"
      ? GM_info.scriptHandler
      : "";
  const userAgent = navigator.userAgent;
  const isWindowsChrome =
    userAgent.includes("Windows NT") &&
    /\bChrome\/\d+(?:\.\d+)+/.test(userAgent) &&
    !userAgent.includes("Edg/");
  const isIPhoneSafari =
    userAgent.includes("iPhone") &&
    userAgent.includes("AppleWebKit/") &&
    /\bVersion\/\d+(?:\.\d+)+/.test(userAgent) &&
    /\bMobile\/\S+/.test(userAgent) &&
    /\bSafari\/\d+(?:\.\d+)+/.test(userAgent) &&
    !/(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
  const SYNC_API_URL = "https://exam-practice-sync.expgolemclone.workers.dev";
  const SYNC_TOKEN_KEY = "exam-practice-reader.sync-token";
  const LAUNCH_HANDOFF_KEY = "exam-practice-reader.v12.launch-handoff";
  const LAUNCH_HANDOFF_MAX_AGE_MS = 60000;
  const SYNC_TIMEOUT_MS = 15000;
  const isReaderBridge =
    location.origin === SYNC_API_URL &&
    location.pathname === "/open" &&
    location.hash === "";
  const isDashboardBridge = location.origin === SYNC_API_URL && location.pathname === "/";
  const NEXT_QUESTION_SITE_ID = isReaderBridge ? openSite(location.search) : DEFAULT_SITE;
  const source = sourceForURL(location.href);
  const site = siteModule(source);
  const READER_BRIDGE_TARGET_ATTRIBUTE = "data-exam-practice-reader-bridge-target";
  const READER_BRIDGE_ERROR_ATTRIBUTE = "data-exam-practice-reader-bridge-error";
  function failReaderBridge(code) {
    document.documentElement.setAttribute(READER_BRIDGE_ERROR_ATTRIBUTE, code);
    document.documentElement.dataset.examPracticeReaderBridgeState = "error";
  }
  const isNextQuestionLauncher = source !== null && location.href === siteStartURL(source.id);
  app.shouldLaunchNextQuestionAfterSync = isNextQuestionLauncher;

  class SyncRequestError extends Error {
    constructor(code, status = 0, responseBody = null) {
      super(code);
      this.name = "SyncRequestError";
      this.code = code;
      this.status = status;
      this.responseBody = responseBody;
    }
  }

  function gmXMLHttpRequest(details) {
    const requestTimeoutMs = details.timeout ?? SYNC_TIMEOUT_MS;
    const requestDetails = { ...details };
    delete requestDetails.timeout;
    let tampermonkeyRequest = null;
    let requestTimeout = null;
    let rejectRequest = () => false;
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const settleOnce = (callback) => {
        if (settled) {
          return false;
        }
        settled = true;
        if (requestTimeout !== null) {
          window.clearTimeout(requestTimeout);
          requestTimeout = null;
        }
        callback();
        return true;
      };
      const resolveOnce = (response) => settleOnce(() => resolve(response));
      const rejectOnce = (code) => settleOnce(() => reject(new SyncRequestError(code)));
      rejectRequest = rejectOnce;
      requestTimeout = window.setTimeout(() => {
        if (!rejectOnce("request_timeout")) {
          return;
        }
        try {
          tampermonkeyRequest?.abort();
        } catch {
          // timeout result is already final.
        }
      }, requestTimeoutMs);
      try {
        requestDetails.onload = resolveOnce;
        requestDetails.onerror = () => rejectOnce("network_error");
        requestDetails.onabort = () => rejectOnce("request_aborted");
        requestDetails.ontimeout = () => rejectOnce("request_timeout");
        tampermonkeyRequest = GM.xmlHttpRequest(requestDetails);
      } catch {
        rejectOnce("network_error");
      }
    });
    promise.abort = () => {
      if (!rejectRequest("request_aborted")) {
        return;
      }
      try {
        tampermonkeyRequest?.abort();
      } catch {
        // abort result is already final.
      }
    };
    return promise;
  }
  const requestSyncResponse = createSyncRequest({
    apiURL: SYNC_API_URL,
    gmXMLHttpRequest,
    SyncRequestError,
  });

  const isReaderBridgeNextResponse = (value) => isNextResponse(value, NEXT_QUESTION_SITE_ID);
  const hasDashboardBridgeRuntime =
    SCRIPT_HANDLER === "Tampermonkey" &&
    (isWindowsChrome || isIPhoneSafari) &&
    typeof GM === "object" &&
    GM !== null &&
    typeof GM.getValue === "function" &&
    typeof GM.listValues === "function" &&
    typeof GM.xmlHttpRequest === "function";
  if (isDashboardBridge) {
    if (!hasDashboardBridgeRuntime) {
      document.documentElement.setAttribute(DASHBOARD_BRIDGE_STATE_ATTRIBUTE, "error");
      return;
    }
    await migrateReaderStorage(GM);
    installDashboardBridge({
      gm: GM,
      requestSyncResponse,
      syncTokenKey: SYNC_TOKEN_KEY,
    });
    return;
  }
  if (
    SCRIPT_HANDLER !== "Tampermonkey" ||
    (!isWindowsChrome && !isIPhoneSafari) ||
    typeof GM !== "object" ||
    GM === null ||
    typeof GM.getValue !== "function" ||
    typeof GM.listValues !== "function" ||
    typeof GM.setValue !== "function" ||
    typeof GM.deleteValue !== "function" ||
    typeof GM.xmlHttpRequest !== "function" ||
    typeof GM.setClipboard !== "function"
  ) {
    if (isReaderBridge) {
      failReaderBridge("runtime_unavailable");
    }
    return;
  }
  await migrateReaderStorage(GM);
  if (isReaderBridge) {
    if (NEXT_QUESTION_SITE_ID === null) { failReaderBridge("invalid_source"); return; }
    let phase = "storage";
    try {
      const storedToken = await GM.getValue(SYNC_TOKEN_KEY, "");
      const token = typeof storedToken === "string" ? storedToken.trim() : "";
      const parameters = new URLSearchParams({ site: NEXT_QUESTION_SITE_ID });
      phase = "request";
      const result = await requestSyncResponse(
        "GET",
        `/v12/next?${parameters}`,
        token,
        isReaderBridgeNextResponse,
      );
      if (result.question === null) {
        document.documentElement.dataset.examPracticeReaderBridgeState = "empty";
        return;
      }
      phase = "storage";
      await GM.setValue(LAUNCH_HANDOFF_KEY, {
        createdAtMs: Date.now(),
        questionURL: result.question.url,
        launchURL: launchQuestionURL(result.question.url, NEXT_QUESTION_SITE_ID),
        state: result.state,
      });
      document.documentElement.setAttribute(READER_BRIDGE_TARGET_ATTRIBUTE,
        launchQuestionURL(result.question.url, NEXT_QUESTION_SITE_ID));
      document.documentElement.dataset.examPracticeReaderBridgeState = "ready";
    } catch (error) {
      if (phase === "request" && error?.code === "unauthorized") {
        document.documentElement.dataset.examPracticeReaderBridgeState = "unauthorized";
      } else {
        failReaderBridge(
          phase === "storage"
            ? "storage_unavailable"
            : typeof error?.code === "string" && /^[a-z][a-z0-9_]*$/.test(error.code)
              ? error.code
              : "request_failed",
        );
      }
    }
    return;
  }
  if (!source || !site || (!app.shouldLaunchNextQuestionAfterSync &&
      site.currentQuestionId(document, location.href, source.id) === null)) return;
  const SITE_ID = source.id;
  const PENDING_ATTEMPT_KEY = `exam-practice-reader.${SITE_ID}.v9.pending-attempt`;
  const PENDING_CELEBRATION_KEY = `exam-practice-reader.${SITE_ID}.v9.pending-celebration`;
  const CATALOG_TIMEOUT_MS = 15000;
  const CATALOG_FETCH_CONCURRENCY = 4;
  const SPEECH_TIMEOUT_MS = 30000;
  const FRAME_PROBLEM_SCROLL_DELAYS_MS = [0, 120, 600];
  const SHORTCUT_SEQUENCE_TIMEOUT_MS = 400;
  const TIME_LIMIT_MS = 5 * 60 * 1000;
  const FRAME_DARK_MODE_STYLE_ID = "exam-practice-reader-dark-mode";
  const FRAME_DARK_MODE_CSS = FRAME_THEME_CSS + site.frameStyles;
  const QUESTION_SPEECH_RATE = 2.0;
  const ANSWER_RESULT_SPEECH_RATE = 1.7;
  const SPEECH_TOKEN_RENEWAL_SKEW_MS = 60000;
  const AZURE_SPEECH_URL = "https://japaneast.tts.speech.microsoft.com/cognitiveservices/v1";
  const JAPANESE_SPEECH_LOCALE = "ja-JP";
  const JAPANESE_SPEECH_VOICE_NAME = "ja-JP-NanamiNeural";
  const AZURE_SPEECH_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
  const FEEDBACK_AUDIO_DATA_URLS = FEEDBACK_AUDIO_URLS;
  const SILENT_AUDIO_DATA_URL =
    "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  const SPEECH_GESTURE_STATUS = "画面をクリックまたはタップすると読み上げます";

  const speechAudio = typeof window.Audio === "function" ? new window.Audio() : null;
  const speechSupported =
    typeof speechAudio?.play === "function" &&
    typeof speechAudio?.pause === "function" &&
    typeof speechAudio?.canPlayType === "function" &&
    speechAudio.canPlayType("audio/mpeg") !== "" &&
    (isIPhoneSafari || isWindowsChrome);
  app.speechEnabled = false;
  app.speechPaused = false;
  app.speechInitializationInProgress = false;
  app.speechInitializationPromise = null;
  app.speechInitializationResolve = null;
  app.speechRunId = 0;
  const activeSpeechRequests = new Set();
  app.speechChunkSession = null;
  app.activeSpeechAudioURL = "";
  app.activeSpeechPlaybackCancel = null;
  app.azureSpeechToken = "";
  app.azureSpeechTokenExpiresAt = 0;
  app.azureSpeechTokenPromise = null;
  app.frameDocument = null;
  app.boundFrameDocument = null;
  app.currentPageReadPending = false;
  app.currentFrameURL = app.shouldLaunchNextQuestionAfterSync ? "about:blank" : location.href;
  app.requestedFrameURL = app.currentFrameURL;
  app.sessionRecoveryTarget = null;
  app.timeLimitPhase = null;
  app.timeLimitDeadline = 0;
  app.timeLimitTimeout = null;
  app.timeLimitInterval = null;
  app.timeLimitSourceDocument = null;
  app.frameProblemScrollTimers = [];
  app.frameMutationObserver = null;
  app.frameControlObserver = null;
  app.observedAnswerResult = null;
  app.observedCommentary = null;
  app.awaitingAnswerResultSpeech = false;
  app.navigationInProgress = false;
  app.nextQuestionOperationInProgress = false;
  app.syncToken = "";
  app.syncReady = false;
  app.syncInProgress = false;
  app.syncPromise = null;
  app.catalogReady = false;
  app.catalogInProgress = false;
  app.catalogPromise = null;
  app.currentSyncState = null;
  app.launcherSyncState = null;
  app.pendingAttempt = null;
  app.pendingAttemptTransitionPromise = null;
  app.pendingCelebration = null;
  app.answerCopyOperation = null;

  const correctFeedbackDocuments = new WeakSet();
  app.correctFeedbackPromise = null;
  app.correctFeedbackRemovalTimer = null;
  function waitForCorrectFeedbackKpi(questionId) {
    return waitForCorrectFeedbackKpiResult(questionId, app.pendingAttempt);
  }
  function extractQuestionText() {
    return site.extractQuestionTextFromDocument(app.frameDocument);
  }
  const { loadCompleteQuestionCatalog } = createCatalogLoader({
    fetchConcurrency: CATALOG_FETCH_CONCURRENCY,
    siteId: SITE_ID,
    site,
    SyncRequestError,
    timeoutMs: CATALOG_TIMEOUT_MS,
  });
  installReaderStyles();

  Object.assign(app, {
    loadCompleteQuestionCatalog,
    READER_FRAME_READY_MESSAGE_TYPE,
    BUILD_FINGERPRINT,
    SCRIPT_HANDLER,
    isIPhoneSafari,
    SYNC_TOKEN_KEY,
    LAUNCH_HANDOFF_KEY,
    LAUNCH_HANDOFF_MAX_AGE_MS,
    isNextQuestionLauncher,
    SyncRequestError,
    gmXMLHttpRequest,
    requestSyncResponse,
    SITE_ID,
    source,
    site,
    PENDING_ATTEMPT_KEY,
    PENDING_CELEBRATION_KEY,
    SPEECH_TIMEOUT_MS,
    FRAME_PROBLEM_SCROLL_DELAYS_MS,
    SHORTCUT_SEQUENCE_TIMEOUT_MS,
    TIME_LIMIT_MS,
    FRAME_DARK_MODE_STYLE_ID,
    FRAME_DARK_MODE_CSS,
    QUESTION_SPEECH_RATE,
    ANSWER_RESULT_SPEECH_RATE,
    SPEECH_TOKEN_RENEWAL_SKEW_MS,
    AZURE_SPEECH_URL,
    JAPANESE_SPEECH_LOCALE,
    JAPANESE_SPEECH_VOICE_NAME,
    AZURE_SPEECH_OUTPUT_FORMAT,
    FEEDBACK_AUDIO_DATA_URLS,
    SILENT_AUDIO_DATA_URL,
    SPEECH_GESTURE_STATUS,
    speechAudio,
    speechSupported,
    activeSpeechRequests,
    correctFeedbackDocuments,
    waitForCorrectFeedbackKpi,
    extractQuestionText,
    answerResultFromDocument: site.answerResultFromDocument,
    isVisibleElement,
    normalizeInlineText,
    splitText,
    CORRECT_FEEDBACK_LEAVE_DURATION_MS,
    CORRECT_FEEDBACK_MINIMUM_DURATION_MS,
    calculateKpiQuestionsRemaining,
    chooseCorrectFeedbackVariant,
    resolveCorrectFeedbackKpi,
    buildCopyMarkdown: (documentNode) => buildCopyMarkdown(documentNode, site),
    isSelectedAnswerChoice: site.isSelectedAnswerChoice,
  });
  installSyncController(app);
  installLauncherController(app);
  installViewController(app);
  installStudyTimeController(app);
  installCopyController(app);
  installNavigationController(app);
  installLifecycleController(app);
  installSpeechController(app);
  installShortcutsController(app);
}
