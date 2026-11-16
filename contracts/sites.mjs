const KAKOMONN_SITE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.kakomonn\.com$/;
const QUESTION_ID_PATTERN = /^\d+$/;
const QUESTION_ID_MAX = "9223372036854775807";

export const DEFAULT_SITE = "chushoks.kakomonn.com";
export const STUDYZ_BOKI3_SITE = "studyz-boki3";

export function sourceForSite(site) {
  if (typeof site !== "string") return null;
  if (KAKOMONN_SITE_PATTERN.test(site)) {
    return { id: site, kind: "kakomonn", origin: `https://${site}`, pathPrefix: "/", startPath: "/createques" };
  }
  if (site === STUDYZ_BOKI3_SITE) {
    return { id: site, kind: "studyz-boki3", origin: "https://1studyz.com", pathPrefix: "/boki3/", startPath: "/boki3/test/" };
  }
  return null;
}

export function isSite(site) { return sourceForSite(site) !== null; }

export function sourceForURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const site = url.hostname === "1studyz.com" && url.pathname.startsWith("/boki3/")
      ? STUDYZ_BOKI3_SITE : url.hostname;
    const source = sourceForSite(site);
    return source?.origin === url.origin && url.pathname.startsWith(source.pathPrefix) ? source : null;
  } catch { return null; }
}

export function isSourcePageURL(value, site) {
  return sourceForURL(value)?.id === site;
}

export function isQuestionId(value) {
  if (
    typeof value !== "string" ||
    value.length > QUESTION_ID_MAX.length ||
    !QUESTION_ID_PATTERN.test(value)
  ) {
    return false;
  }
  const normalized = normalizedQuestionNumber(value);
  return (
    normalized.length < QUESTION_ID_MAX.length ||
    (normalized.length === QUESTION_ID_MAX.length && normalized <= QUESTION_ID_MAX)
  );
}

function normalizedQuestionNumber(questionId) {
  const normalized = questionId.replace(/^0+/, "");
  return normalized === "" ? "0" : normalized;
}

function compareQuestionIds(left, right) {
  const leftNumber = normalizedQuestionNumber(left);
  const rightNumber = normalizedQuestionNumber(right);
  if (leftNumber.length !== rightNumber.length) {
    return leftNumber.length - rightNumber.length;
  }
  if (leftNumber !== rightNumber) {
    return leftNumber < rightNumber ? -1 : 1;
  }
  return left === right ? 0 : left < right ? -1 : 1;
}

export function canonicalQuestionIds(questionIds) {
  if (!Array.isArray(questionIds) || questionIds.some((id) => !isQuestionId(id))) {
    throw new TypeError("Question IDs are invalid.");
  }
  return [...questionIds].sort(compareQuestionIds);
}


export function questionURL(site, questionId) {
  const source = sourceForSite(site);
  if (!source || !isQuestionId(questionId)) throw new TypeError("Invalid question source or ID.");
  const path = source.kind === "kakomonn" ? `/questions/${questionId}` : `/boki3/test/${questionId}/`;
  return source.origin + path;
}

export function questionIdFromURL(value, site) {
  if (!isSourcePageURL(value, site)) return null;
  const url = new URL(value);
  if (url.search || url.hash) return null;
  const pattern = sourceForSite(site).kind === "kakomonn"
    ? /^\/questions\/(?:next\/)?(\d+)$/
    : /^\/boki3\/test\/(\d+)\/?$/;
  const id = url.pathname.match(pattern)?.[1];
  return isQuestionId(id) ? id : null;
}

export function scheduledQuestionId(value, site) {
  const id = questionIdFromURL(value, site);
  return id !== null && new URL(value).href === questionURL(site, id) ? id : null;
}

export function siteStartURL(site) {
  const source = sourceForSite(site);
  if (!source) throw new TypeError("Invalid source.");
  return source.origin + source.startPath + "#exam-practice-next";
}

export function launchQuestionURL(value, site) {
  if (scheduledQuestionId(value, site) === null) throw new TypeError("Invalid question URL.");
  return sourceForSite(site).kind === "studyz-boki3" ? siteStartURL(site) : value;
}

export function openSite(search) {
  const params = new URLSearchParams(search);
  if ([...params.keys()].some(key => key !== "site") || params.getAll("site").length > 1) return null;
  const site = params.has("site") ? params.get("site") : DEFAULT_SITE;
  return isSite(site) ? site : null;
}
