import { isQuestionId, questionIdFromURL, sourceForSite, STUDYZ_BOKI3_SITE } from "../../../contracts/sites.mjs";
import { cloneVisibleElement, isVisibleElement, normalizeInlineText, normalizeText, visibleStructuredText } from "../content.js";

const selections = new WeakMap();
const snapshots = new WeakMap();
let sessionPreparation = null;

function currentQuestionControls(documentNode) {
  const options = documentNode?.querySelector("#question_options");
  const answerChoiceControls = Array.from(options?.querySelectorAll("li[data-selected]") ?? []);
  if (!options || answerChoiceControls.length < 2 || !isQuestionId(options.dataset.id) ||
      answerChoiceControls.some((control, index) => control.dataset.selected !== String(index + 1))) return null;
  return { problemElement: options.closest("section.question"), answerButton: null, answerChoiceControls };
}

function answerResultFromDocument(documentNode) {
  const answer = documentNode?.querySelector("#answer");
  const result = answer?.querySelector(".question_answer");
  if (!answer || !result || !isVisibleElement(answer)) return "unknown";
  const correct = result.classList.contains("correct");
  const wrong = result.classList.contains("wrong");
  return correct === wrong ? "unknown" : correct ? "correct" : "incorrect";
}

function selectChoice(controls, index) {
  const control = controls.answerChoiceControls[index];
  if (!control || !isVisibleElement(control) || answerResultFromDocument(control.ownerDocument) !== "unknown") return false;
  selections.set(control.ownerDocument, index);
  for (const option of controls.answerChoiceControls) {
    option.toggleAttribute("data-exam-practice-selected", option === control);
  }
  return true;
}

function visibleSnapshot(element) {
  if (!element || !isVisibleElement(element)) return null;
  return cloneVisibleElement(element);
}

function captureQuestion(documentNode) {
  const question = visibleSnapshot(documentNode.querySelector("#question-open .question_box_info > p"));
  const choices = visibleSnapshot(documentNode.querySelector("#question_choice_container"));
  const images = visibleSnapshot(documentNode.querySelector("#question-image-open"));
  const title = normalizeInlineText(documentNode.querySelector("#question-open .question_box_source")?.innerText ?? "");
  if (!question || !choices || !title) return false;
  snapshots.set(documentNode, { question, choices, images: images ? [images] : [], title });
  return true;
}

function prepareAnswerGesture(target, documentNode) {
  const control = target.closest("#question_options li[data-selected]");
  const controls = currentQuestionControls(documentNode);
  const index = controls?.answerChoiceControls.indexOf(control) ?? -1;
  return index >= 0 && selectChoice(controls, index) && captureQuestion(documentNode);
}

function copySource(documentNode) {
  if (answerResultFromDocument(documentNode) === "unknown") return { state: "locked" };
  const explanation = documentNode.querySelector("#questionExplanation");
  const lock = explanation?.querySelector(".question_explanation_locked");
  if (lock && isVisibleElement(lock)) return { state: "restricted" };
  const source = snapshots.get(documentNode);
  const selectedIndex = selections.get(documentNode);
  if (!source || !Number.isInteger(selectedIndex) || !explanation || !isVisibleElement(explanation)) {
    return { state: "unavailable" };
  }
  const selectedChoice = source.choices.querySelectorAll(".answer-list")[selectedIndex];
  if (!selectedChoice) return { state: "unavailable" };
  return { ...source, state: "ready", selectedIndex, selectedChoice,
    explanations: [{ number: "01", element: explanation }] };
}

async function prepareSession() {
  if (sessionPreparation) return sessionPreparation;
  sessionPreparation = (async () => {
    const response = await fetch("https://1studyz.com/boki3/random", {
      credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || questionIdFromURL(response.url, STUDYZ_BOKI3_SITE) === null) {
      throw new Error("The site's normal session initialization did not open a question.");
    }
    await response.text();
  })().finally(() => { sessionPreparation = null; });
  return sessionPreparation;
}

async function loadCatalog(siteId, loadDocument, { SyncRequestError }) {
  const { origin, pathPrefix } = sourceForSite(siteId);
  const indexURL = origin + pathPrefix + "wp-sitemap.xml";
  const index = await loadDocument(indexURL);
  const urls = Array.from(index.querySelectorAll("sitemap > loc"), node => node.textContent.trim());
  const questionMaps = urls.filter(value => {
    try {
      const url = new URL(value);
      return url.origin === origin && /^\/boki3\/wp-sitemap-posts-questions-\d+\.xml$/.test(url.pathname) &&
        !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
  });
  if (!questionMaps.length || questionMaps.length > 100) throw new SyncRequestError("catalog_error");
  const ids = new Set();
  for (const url of questionMaps) {
    const documentNode = await loadDocument(url);
    const locations = Array.from(documentNode.querySelectorAll("url > loc"), node => node.textContent.trim());
    if (!locations.length) throw new SyncRequestError("catalog_error");
    for (const location of locations) {
      const id = questionIdFromURL(location, siteId);
      if (id === null || ids.has(id)) throw new SyncRequestError("catalog_error");
      ids.add(id);
    }
  }
  return [...ids];
}

export const studyzBoki3 = Object.freeze({
  currentQuestionControls, answerResultFromDocument, copySource, selectChoice, prepareAnswerGesture,
  prepareSession, loadCatalog,
  isSessionSetupURL(value) {
    return value === "https://1studyz.com/boki3/test/";
  },
  extractQuestionTextFromDocument(documentNode) {
    const question = documentNode?.querySelector("#question-open .question_box_info > p");
    return question && isVisibleElement(question) ? normalizeText(visibleStructuredText(question)) : "";
  },
  currentQuestionId(documentNode, url, siteId) { return questionIdFromURL(url, siteId); },
  isSelectedAnswerChoice(control) { return control.hasAttribute("data-exam-practice-selected"); },
  submitAnswer(controls) {
    const documentNode = controls.answerChoiceControls[0].ownerDocument;
    const selectedIndex = selections.get(documentNode);
    const control = controls.answerChoiceControls[selectedIndex];
    if (!control || !isVisibleElement(control) || !captureQuestion(documentNode)) return false;
    control.click();
    return true;
  },
  toggleChoice(controls, index) {
    const documentNode = controls.answerChoiceControls[0].ownerDocument;
    const choice = documentNode.querySelectorAll("#question_choice_container .answer-list dl")[index];
    if (!choice || !isVisibleElement(choice)) return false;
    choice.click();
    return true;
  },
  observationTargets(documentNode) {
    return [documentNode.querySelector("#answer"), documentNode.querySelector("#questionExplanation")];
  },
  nextQuestionURL(link, siteId, currentURL) {
    return link.matches("a.test_next") && questionIdFromURL(link.href, siteId) !== null && link.href !== currentURL
      ? link.href : null;
  },
  nextControl(candidate) { return candidate.matches("a.test_next") ? candidate : null; },
  problemHeading(documentNode) { return documentNode.querySelector("#question-open"); },
  frameStyles: `
    html, body, main, .main, .contents, .question_box, section.question, .question_choice_box,
    .question_answer, #question_options, #question_options li, .answer-list dl {
      background: var(--exam-practice-frame-canvas) !important;
      color: var(--exam-practice-frame-text) !important;
      border-color: var(--exam-practice-frame-border) !important;
    }
    header, footer, .bottom-menu, .breadcrumb, .page_head, .test_next { display: none !important; }
    #question_options li[data-exam-practice-selected] { outline: 3px solid var(--exam-practice-frame-link); }
    .answer-list dl.clicked { text-decoration: line-through; }
    .question_img img { filter: invert(100%) hue-rotate(180deg); }
  `,
});
