import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { cloneVisibleElement, normalizeInlineText } from "./content.js";

const service = new TurndownService({
  headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced",
});
service.use(gfm);
service.keep(["sup", "sub"]);

function markdownState(defaultImageLabel, seenImageURLs) {
  return { defaultImageLabel, imageNumber: 0, seenImageURLs };
}

function renderContent(element, state, childrenOnly = false) {
  const clone = cloneVisibleElement(element, (original, copy) => {
    for (const attribute of ["href", "src"]) {
      const raw = original.getAttribute(attribute);
      if (!raw) continue;
      let url;
      try { url = new URL(raw, original.ownerDocument.baseURI); } catch {}
      if (url?.protocol === "https:") copy.setAttribute(attribute, url.href);
      else copy.removeAttribute(attribute);
    }
    if (original.tagName === "IMG") {
      const url = copy.getAttribute("src");
      if (!url || state.seenImageURLs.has(url)) {
        copy.remove();
        return;
      }
      state.seenImageURLs.add(url);
      if (!normalizeInlineText(copy.getAttribute("alt") ?? "")) {
        state.imageNumber += 1;
        copy.setAttribute("alt", `${state.defaultImageLabel} ${state.imageNumber}`);
      }
    }
    if (copy.tagName === "A") {
      const images = original.querySelectorAll("img");
      if (!copy.hasAttribute("href") ||
          (images.length === 1 && !copy.textContent.trim() && original.href === images[0].src)) {
        copy.replaceWith(...copy.childNodes);
      }
    }
  });
  if (clone === null) return "";
  const input = childrenOnly ? clone.innerHTML : clone.outerHTML;
  return service.turndown(input).trim();
}


export function buildCopyMarkdown(documentNode, site) {
  if (!documentNode?.body || !documentNode.defaultView) return { state: "unavailable", markdown: "" };
  const source = site.copySource(documentNode);
  if (source.state !== "ready") return { state: source.state, markdown: "" };
  const seenImageURLs = new Set();
  const questionState = markdownState("問題文の画像", seenImageURLs);
  const questionMarkdown = renderContent(source.question, questionState);
  const imagesMarkdown = source.images.map(element => renderContent(element, questionState)).filter(Boolean).join("\n\n");
  const choicesMarkdown = renderContent(source.choices, questionState);
  const selectedMarkdown = renderContent(source.selectedChoice, markdownState("回答の画像", new Set()), true);
  const explanationState = markdownState("解説画像", seenImageURLs);
  const explanations = source.explanations.map(({ number, element }) => {
    const text = renderContent(element, explanationState, true);
    return text ? "### 解説 " + number + "\n\n" + text : "";
  });
  if (!questionMarkdown || !choicesMarkdown || !selectedMarkdown || explanations.some(text => !text)) {
    return { state: "unavailable", markdown: "" };
  }
  return { state: "ready", markdown: [
    "# " + service.escape(source.title), "## 問題文", questionMarkdown, imagesMarkdown,
    "### 選択肢", choicesMarkdown, "### 自分の回答",
    "選択肢" + (source.selectedIndex + 1) + ": " + selectedMarkdown,
    "## 解説", ...explanations,
  ].filter(Boolean).join("\n\n") };
}
