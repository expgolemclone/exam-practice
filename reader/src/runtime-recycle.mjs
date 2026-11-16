import { questionIdFromURL, sourceForSite, sourceForURL } from "../../contracts/sites.mjs";

export const IPHONE_RUNTIME_RECYCLE_AFTER_TRANSITIONS = 25;

export function createReaderRuntimeRecycleTracker(
  siteId,
  transitionLimit = IPHONE_RUNTIME_RECYCLE_AFTER_TRANSITIONS,
) {
  if (!Number.isSafeInteger(transitionLimit) || transitionLimit < 1) {
    throw new TypeError("transitionLimit must be a positive safe integer");
  }

  const source = sourceForSite(siteId);
  if (!source) throw new TypeError("Invalid question source");
  let completedTransitions = 0;
  let lastQuestionURL = "";

  return Object.freeze({
    record(urlValue) {
      let url;
      try {
        url = new URL(urlValue, source.origin);
      } catch {
        return false;
      }
      if (questionIdFromURL(url.href, siteId) === null) {
        return false;
      }
      if (url.href === lastQuestionURL) {
        return false;
      }
      if (lastQuestionURL === "") {
        lastQuestionURL = url.href;
        return false;
      }

      lastQuestionURL = url.href;
      completedTransitions += 1;
      return completedTransitions >= transitionLimit;
    },
  });
}

export function installIPhoneRuntimeRecycleGuard() {
  if (window.top !== window.self || !navigator.userAgent.includes("iPhone")) {
    return;
  }

  const source = sourceForURL(location.href);
  if (!source) return;
  const tracker = createReaderRuntimeRecycleTracker(source.id);
  let frame = null;
  let frameLoadHandler = null;
  let frameObserver = null;
  let observerTimeout = null;
  let recycleScheduled = false;

  const disconnectFrameObserver = () => {
    frameObserver?.disconnect();
    frameObserver = null;
    if (observerTimeout !== null) {
      window.clearTimeout(observerTimeout);
      observerTimeout = null;
    }
  };

  const recordFrameQuestion = () => {
    if (recycleScheduled || frame === null) {
      return;
    }
    let frameURL;
    try {
      frameURL = frame.contentWindow?.location.href ?? "";
    } catch {
      return;
    }
    if (!tracker.record(frameURL)) {
      return;
    }

    recycleScheduled = true;
    if (frameLoadHandler !== null) {
      frame.removeEventListener("load", frameLoadHandler);
    }
    disconnectFrameObserver();
    window.location.reload();
  };

  const attachToReaderFrame = () => {
    const candidate = document.getElementById("exam-practice-reader-frame");
    if (candidate?.tagName !== "IFRAME") {
      return false;
    }
    frame = candidate;
    frameLoadHandler = recordFrameQuestion;
    frame.addEventListener("load", frameLoadHandler);
    recordFrameQuestion();
    return true;
  };

  if (attachToReaderFrame()) {
    return;
  }

  frameObserver = new MutationObserver(() => {
    if (attachToReaderFrame()) {
      disconnectFrameObserver();
    }
  });
  frameObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  observerTimeout = window.setTimeout(disconnectFrameObserver, 30000);
}
