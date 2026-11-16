import { canonicalQuestionIds, isQuestionId, questionIdFromURL, scheduledQuestionId, sourceForSite } from "../../../contracts/sites.mjs";
import { compactLine, isVisibleElement, normalizeInlineText, normalizeText, visibleStructuredText } from "../content.js";

const ANSWER_CHOICE_SELECTOR = "input[type='radio'], input[type='checkbox'], [role='radio']";
export const QUESTION_META_PATTERN = /(?:問\s*\d+|第\s*\d+)/;
export function findQuestionMetadataElement(documentNode) {
  const candidates = Array.from(documentNode.querySelectorAll(".problem_detail > .when")).filter(
    (element) => {
      const text = normalizeInlineText(element.innerText ?? "");
      const problemElement = element.closest(".problem_detail");
      const answerButton = findAnswerButtonAfter(element);
      return (
        text.length > 0 &&
        text.length <= 220 &&
        QUESTION_META_PATTERN.test(text) &&
        isVisibleElement(element) &&
        problemElement !== null &&
        answerButton !== null &&
        problemElement.contains(answerButton)
      );
    },
  );

  return candidates.length === 1 ? candidates[0] : null;
}

function isFollowingNode(referenceNode, candidateNode) {
  const NodeConstructor = referenceNode.ownerDocument.defaultView.Node;
  return Boolean(
    referenceNode.compareDocumentPosition(candidateNode) &
    NodeConstructor.DOCUMENT_POSITION_FOLLOWING,
  );
}

export function findAnswerButtonAfter(metadataElement) {
  const controls = metadataElement.ownerDocument.querySelectorAll(
    "a, button, input[type='button'], input[type='submit']",
  );

  for (const control of controls) {
    if (!isFollowingNode(metadataElement, control)) {
      continue;
    }

    const label = normalizeInlineText(
      control.innerText ||
        control.textContent ||
        control.value ||
        control.getAttribute("aria-label") ||
        "",
    ).replace(/\s+/g, "");

    if (label === "解答する") {
      return control;
    }
  }

  return null;
}

export function findAnswerChoiceControls(metadataElement, answerButton) {
  const controls = [];

  for (const control of metadataElement.ownerDocument.querySelectorAll(ANSWER_CHOICE_SELECTOR)) {
    if (isFollowingNode(metadataElement, control) && isFollowingNode(control, answerButton)) {
      controls.push(control);
    }
  }

  return controls;
}


export function findQuestionTextElement(problemElement) {
  return problemElement.querySelector(":scope > .question-writing-scroll > .ttl");
}

export function extractQuestionTextFromDocument(documentNode) {
  if (!documentNode?.body) {
    return "";
  }

  const metadataElement = findQuestionMetadataElement(documentNode);
  if (!metadataElement) {
    return "";
  }

  const answerButton = findAnswerButtonAfter(metadataElement);
  if (!answerButton) {
    return "";
  }

  const problemElement = metadataElement.closest(".problem_detail");
  if (!problemElement || !problemElement.contains(answerButton)) {
    return "";
  }

  const questionElement = findQuestionTextElement(problemElement);
  const choicesElement =
    Array.from(problemElement.children).find((child) => child.matches("ul.list")) ?? null;
  if (
    !questionElement ||
    !choicesElement ||
    !isFollowingNode(metadataElement, questionElement) ||
    !isFollowingNode(questionElement, choicesElement) ||
    !isFollowingNode(choicesElement, answerButton)
  ) {
    return "";
  }

  const choiceControls = findAnswerChoiceControls(metadataElement, answerButton);
  const choiceElements = Array.from(choicesElement.children).filter((child) => child.matches("li"));
  if (choiceElements.length < 2 || choiceElements.length !== choiceControls.length) {
    return "";
  }

  const text = normalizeText(visibleStructuredText(questionElement));
  if (!text) {
    return "";
  }

  return text;
}
// END QUESTION EXTRACTION

const EXPLANATION_LOCK_TEXT = "解説は問題に回答すると表示されます";

function normalizePageStateText(rawText) {
  return compactLine(rawText).replace(/[。．]+$/u, "");
}

export function hasVisibleExplanationLock(documentNode) {
  for (const lock of documentNode.querySelectorAll("#js-commentary-wrap > .item > .none_text")) {
    const text = normalizePageStateText(lock.textContent ?? "");
    if (text === EXPLANATION_LOCK_TEXT && isVisibleElement(lock)) {
      return true;
    }
  }
  return false;
}


export function answerResultFromDocument(documentNode) {
  const resultBox = documentNode?.querySelector("#js-answer-result-box");
  if (resultBox === null || resultBox === undefined) return "unknown";
  const correctResult = resultBox.classList.contains("is-correct");
  const incorrectResult = resultBox.classList.contains("is-wrong");
  if (correctResult === incorrectResult) return "unknown";
  return correctResult ? "correct" : "incorrect";
}

async function loadCatalog(siteId, loadCatalogDocument, { fetchConcurrency, SyncRequestError }) {
  async function mapCatalogConcurrently(items, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(fetchConcurrency, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  function strictSameOriginURL(href, baseURL) {
    try {
      const url = new URL(href, baseURL);
      return url.origin === `https://${siteId}` ? url : null;
    } catch {
      return null;
    }
  }

  function collectQuestionIds(documentNode, pageURL) {
    const ids = new Set();
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      const id = url ? scheduledQuestionId(url.href, siteId) : null;
      if (id !== null) {
        if (ids.has(id)) throw new SyncRequestError("catalog_error");
        ids.add(id);
      }
    }
    return ids;
  }

  function catalogPagePosition(documentNode) {
    const bodyText = documentNode.body?.textContent ?? "";
    const bodyMatch = bodyText.match(/全(\d+)ページ中(\d+)ページ目です[。.]/);
    const titleMatch = documentNode.title.match(/[（(](\d+)\/(\d+)[）)]/);
    let currentPage = null;
    let totalPages = null;

    if (bodyMatch !== null) {
      totalPages = Number(bodyMatch[1]);
      currentPage = Number(bodyMatch[2]);
    }
    if (titleMatch !== null) {
      const titleCurrentPage = Number(titleMatch[1]);
      const titleTotalPages = Number(titleMatch[2]);
      if (
        currentPage !== null &&
        (currentPage !== titleCurrentPage || totalPages !== titleTotalPages)
      ) {
        throw new SyncRequestError("catalog_error");
      }
      currentPage = titleCurrentPage;
      totalPages = titleTotalPages;
    }
    if (
      !Number.isSafeInteger(currentPage) ||
      !Number.isSafeInteger(totalPages) ||
      currentPage < 1 ||
      totalPages < 1 ||
      currentPage > totalPages ||
      totalPages > 1000
    ) {
      throw new SyncRequestError("catalog_error");
    }
    return { currentPage, totalPages };
  }

  function collectCatalogListURLs(documentNode, pageURL, listURLs) {
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      if (url && /^\/list1\/\d+$/.test(url.pathname)) {
        url.search = "";
        url.hash = "";
        listURLs.set(url.pathname, url.href);
      }
    }
  }

  function findCatalogIndexURL(documentNode, pageURL) {
    for (const link of documentNode.querySelectorAll("a[href]")) {
      const url = strictSameOriginURL(link.getAttribute("href"), pageURL);
      if (url?.pathname === "/list" && url.search === "" && url.hash === "") {
        return url.href;
      }
    }
    return null;
  }

  async function loadCatalogListSnapshot(listURL, loadCatalogDocument) {
    const questionIds = new Set();
    let totalPages = null;
    let fullPageSize = null;

    const loadPage = async (page) => {
      const pageURL = new URL(listURL);
      pageURL.searchParams.set("page", String(page));
      return {
        page,
        pageURL: pageURL.href,
        pageDocument: await loadCatalogDocument(pageURL.href),
      };
    };

    const consumePage = ({ page, pageURL, pageDocument }) => {
      const position = catalogPagePosition(pageDocument);
      if (position.currentPage !== page) {
        throw new SyncRequestError("catalog_error");
      }
      if (totalPages === null) {
        totalPages = position.totalPages;
      } else if (position.totalPages !== totalPages) {
        throw new SyncRequestError("catalog_error");
      }

      const pageIds = collectQuestionIds(pageDocument, pageURL);
      if (pageIds.size === 0) {
        throw new SyncRequestError("catalog_error");
      }
      if (page === 1 && totalPages > 1) {
        fullPageSize = pageIds.size;
      } else if (page < totalPages && pageIds.size !== fullPageSize) {
        throw new SyncRequestError("catalog_error");
      } else if (page === totalPages && fullPageSize !== null && pageIds.size > fullPageSize) {
        throw new SyncRequestError("catalog_error");
      }
      for (const id of pageIds) {
        if (questionIds.has(id)) {
          throw new SyncRequestError("catalog_error");
        }
        questionIds.add(id);
      }
    };

    consumePage(await loadPage(1));
    for (let firstPage = 2; firstPage <= totalPages; firstPage += fetchConcurrency) {
      const lastPage = Math.min(totalPages, firstPage + fetchConcurrency - 1);
      const pages = [];
      for (let page = firstPage; page <= lastPage; page += 1) {
        pages.push(page);
      }
      const pageResults = await Promise.all(pages.map(loadPage));
      for (const pageResult of pageResults) {
        consumePage(pageResult);
      }
    }

    return {
      totalPages,
      questionIds: canonicalQuestionIds([...questionIds]),
    };
  }

  async function loadCatalogLists(loadCatalogDocument) {
    const source = sourceForSite(siteId);
    const createURL = source.origin + source.startPath;
    const createDocument = await loadCatalogDocument(createURL);
    const catalogIndexURL = findCatalogIndexURL(createDocument, createURL);
    if (catalogIndexURL === null) {
      throw new SyncRequestError("catalog_error");
    }

    const listURLs = new Map();
    collectCatalogListURLs(createDocument, createURL, listURLs);
    const catalogIndexDocument = await loadCatalogDocument(catalogIndexURL);
    collectCatalogListURLs(catalogIndexDocument, catalogIndexURL, listURLs);
    if (listURLs.size === 0) {
      throw new SyncRequestError("catalog_error");
    }

    return [...listURLs.entries()].sort(([left], [right]) => left.localeCompare(right));
  }

  async function loadQuestionCatalogSnapshot(loadCatalogDocument) {
    const sortedLists = await loadCatalogLists(loadCatalogDocument);
    const snapshots = await mapCatalogConcurrently(sortedLists, async ([listPath, listURL]) => [
      listPath,
      await loadCatalogListSnapshot(listURL, loadCatalogDocument),
    ]);
    return new Map(snapshots);
  }


  const snapshot = await loadQuestionCatalogSnapshot(loadCatalogDocument);
  const ids = new Set();
  for (const { questionIds } of snapshot.values()) for (const id of questionIds) ids.add(id);
  if (!ids.size) throw new SyncRequestError("catalog_error");
  return canonicalQuestionIds([...ids]);
}

const FRAME_STYLES = `    #js-answer-result-box.is-correct::before {
      border-top-color: var(--exam-practice-frame-correct);
    }

    #js-answer-result-box.is-wrong::before {
      background-color: var(--exam-practice-frame-incorrect);
    }
  
    header.l-header {
      display: none !important;
    }

    .p-post > .fixed_btn,
    .p-post > .fixed_btn_menu,
    .l-footer > .pagetop {
      display: none !important;
    }
  
    html,
    body,
    .l-header,
    .l-main,
    .l-footer,
    .p-post,
    .inner,
    #js-img-zoom-area,
    .sect_problem,
    .sect_commentary,
    #js-commentary-section {
      background-color: var(--exam-practice-frame-canvas) !important;
      color: var(--exam-practice-frame-text) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
  
    .problem_detail,
    #js-commentary-wrap,
    #js-expound-head,
    #calculator {
      background-color: var(--exam-practice-frame-surface) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
  
    .problem_detail,
    .problem_detail > .when,
    .problem_detail > .question-writing-scroll > .ttl,
    .problem_detail > .zoomin,
    .problem_detail > ul.list,
    .problem_detail > ul.list > li,
    .problem_detail > ul.list > li > div,
    .problem_detail > ul.check,
    .problem_detail > ul.check > li,
    .problem_detail > ul.check > li > label,
    #js-commentary-wrap,
    #js-commentary-wrap > .item,
    #js-commentary-wrap > .item > .none_text,
    #js-commentary-wrap > .item > .num,
    #js-commentary-wrap > .item > .text,
    #js-commentary-wrap > .item > .reference {
      color: var(--exam-practice-frame-text) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
  
    .problem_detail > ul.list > li,
    .problem_detail > ul.list > li > div,
    .problem_detail > ul.check > li,
    .problem_detail > ul.check > li > label,
    #js-commentary-wrap > .item > .text,
    #js-commentary-wrap > .item > .reference {
      background-color: var(--exam-practice-frame-raised) !important;
    }
  
    :root[data-exam-practice-reader-phase="question"] .answer-right,
    :root[data-exam-practice-reader-phase="question"] .answer-mistake,
    :root[data-exam-practice-reader-phase="question"] #explst,
    :root[data-exam-practice-reader-phase="question"] .sect_commentary {
      display: none !important;
    }
  
    .problem_detail > ul.list > li.is-active > div,
    #js-commentary-wrap > .item > .none_text,
    #js-commentary-wrap > .item > .num {
      color: var(--exam-practice-frame-muted) !important;
    }
  
    .problem_detail > ul.list > li::before,
    .problem_detail > ul.check > li > label > span::before {
      color: var(--exam-practice-frame-text) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
  
    .problem_detail a,
    #js-commentary-wrap a {
      color: var(--exam-practice-frame-link) !important;
    }
  
    .problem_detail input,
    .problem_detail select,
    .problem_detail textarea,
    #calculator input,
    #calculator select,
    #calculator textarea {
      background-color: var(--exam-practice-frame-canvas) !important;
      color: var(--exam-practice-frame-text) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
  
    .problem_detail .next_ques_btn .button_entity {
      background-color: var(--exam-practice-frame-surface) !important;
    }
  
    .problem_detail .next_ques_btn,
    .problem_detail .next_ques_btn .button_entity {
      display: none !important;
    }
  
    .problem_detail > .zoomin img,
    .problem_detail > ul.list img,
    #js-commentary-wrap > .item .text img {
      filter: invert(100%) hue-rotate(180deg) !important;
    }
  
  `;

function currentQuestionControls(documentNode) {
  if (!documentNode?.body || !documentNode.defaultView) return null;
  const metadata = findQuestionMetadataElement(documentNode);
  if (!metadata) return null;
  const problemElement = metadata.closest(".problem_detail");
  const answerButton = findAnswerButtonAfter(metadata);
  if (!problemElement || !answerButton || !problemElement.contains(answerButton)) return null;
  return { problemElement, answerButton, answerChoiceControls: findAnswerChoiceControls(metadata, answerButton) };
}

function isSelectedAnswerChoice(control) {
  return control.matches("input[type='radio'], input[type='checkbox']")
    ? control.checked === true : control.matches("[role='radio'][aria-checked='true']");
}

function copySource(documentNode) {
  if (answerResultFromDocument(documentNode) === "unknown" || hasVisibleExplanationLock(documentNode)) {
    return { state: "locked" };
  }
  const problemElement = documentNode.querySelector(".problem_detail");
  const explanationElement = documentNode.querySelector("#js-commentary-wrap");
  const metadata = problemElement && directChild(problemElement, ".when");
  const question = problemElement && findQuestionTextElement(problemElement);
  const choices = problemElement && directChild(problemElement, "ul.list");
  if (!metadata || !question || !choices || !explanationElement) return { state: "unavailable" };
  const title = normalizeInlineText(Array.from(metadata.childNodes)
    .filter(node => node.nodeType === documentNode.defaultView.Node.TEXT_NODE)
    .map(node => node.nodeValue ?? "").join(" "));
  const controls = currentQuestionControls(documentNode);
  const choiceElements = Array.from(choices.children).filter(child => child.matches("li"));
  const selected = controls?.answerChoiceControls.flatMap((control, index) =>
    isSelectedAnswerChoice(control) ? [index] : []) ?? [];
  if (!QUESTION_META_PATTERN.test(title) || selected.length !== 1 ||
      choiceElements.length !== controls.answerChoiceControls.length) return { state: "unavailable" };
  const items = Array.from(explanationElement.children).filter(item => item.matches(".item"));
  const explanations = items.map(item => ({
    number: normalizeInlineText(directChild(item, ".num")?.innerText ?? ""),
    element: directChild(item, ".text"),
  }));
  if (!explanations.length || explanations.some(item => !/^\d{2}$/.test(item.number) || !item.element)) {
    return { state: "unavailable" };
  }
  return { state: "ready", title, question,
    images: Array.from(problemElement.children).filter(child => child.matches(".zoomin")),
    choices, selectedIndex: selected[0], selectedChoice: choiceElements[selected[0]], explanations };
}

function directChild(element, selector) {
  return Array.from(element.children).find(child => child.matches(selector)) ?? null;
}

function nextQuestionURL(link, siteId, currentURL) {
  const label = normalizeInlineText(link.innerText || link.textContent || "").replace(/\s+/g, "");
  if (!(label === "次の問題へ" || /^次の問題[（(]問\d+[）)]へ$/.test(label)) ||
      link.getAttribute("aria-disabled") === "true" ||
      questionIdFromURL(link.href, siteId) === null || link.href === currentURL) return null;
  return link.href;
}

export const kakomonn = Object.freeze({
  extractQuestionTextFromDocument, answerResultFromDocument, currentQuestionControls,
  copySource, isSelectedAnswerChoice,
  currentQuestionId(documentNode, url, siteId) {
    const id = questionIdFromURL(url, siteId);
    if (id !== null) return id;
    if (url !== sourceForSite(siteId).origin + "/questions") return null;
    const randomId = documentNode?.querySelector('input[type="hidden"][name="StudyRandumId"]')?.value;
    return isQuestionId(randomId) ? randomId : null;
  },
  selectChoice(controls, index) {
    const label = controls.answerChoiceControls[index]?.closest("label");
    if (!label || !isVisibleElement(label) ||
        controls.answerChoiceControls[index].matches(":disabled, [aria-disabled='true']")) return false;
    label.click();
    return true;
  },
  submitAnswer(controls) {
    if (!isVisibleElement(controls.answerButton) ||
        controls.answerButton.matches(":disabled, [aria-disabled='true']")) return false;
    controls.answerButton.click();
    return true;
  },
  toggleChoice(controls, index) {
    const list = directChild(controls.problemElement, "ul.list");
    const choices = list ? Array.from(list.children).filter(child => child.matches("li")) : [];
    if (choices.length !== controls.answerChoiceControls.length ||
        !choices[index] || !isVisibleElement(choices[index])) return false;
    choices[index].click();
    return true;
  },
  prepareAnswerGesture(target, documentNode) {
    return target.closest("a, button, input[type='button'], input[type='submit']") ===
      currentQuestionControls(documentNode)?.answerButton;
  },
  observationTargets(documentNode) {
    return [documentNode.querySelector("#js-answer-result-box"), documentNode.querySelector("#js-commentary-wrap")];
  },
  nextQuestionURL,
  nextControl(candidate, siteId, currentURL) {
    const label = normalizeInlineText(candidate.innerText || candidate.textContent || candidate.value || "").replace(/\s+/g, "");
    const next = candidate.matches("a[href]") ? nextQuestionURL(candidate, siteId, currentURL) !== null :
      label === "次の問題へ" || /^次の問題[（(]問\d+[）)]へ$/.test(label);
    return next ? candidate.closest(".next_ques_btn") ?? candidate : null;
  },
  problemHeading(documentNode) {
    return Array.from(documentNode.querySelectorAll(".sect_problem > .ttl_box03 > h2.main"))
      .find(heading => normalizeInlineText(heading.textContent ?? "") === "問題") ?? null;
  },
  loadCatalog,
  frameStyles: FRAME_STYLES,
});
