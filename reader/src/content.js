export function normalizeText(rawText) {
  return rawText
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("。")
    .replace(/。{2,}/g, "。")
    .trim();
}

export function compactLine(line) {
  return line.replace(/\s+/g, "").trim();
}

export function normalizeInlineText(rawText) {
  return rawText
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const BLOCK_TAG_NAMES = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIELDSET",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "FORM",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LEGEND",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TBODY",
  "TD",
  "TFOOT",
  "TH",
  "THEAD",
  "TR",
  "UL",
]);
const CONTROL_BREAK_TAG_NAMES = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

export function isVisibleElement(element) {
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);

  if (style?.display === "none" || style?.visibility === "hidden") {
    return false;
  }

  return element.getClientRects().length > 0;
}

const NON_READABLE_SELECTOR =
  "script, style, noscript, template, [hidden], [aria-hidden='true'], [inert]";

export function isHiddenFromRendering(element) {
  if (element.matches(NON_READABLE_SELECTOR)) {
    return true;
  }

  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (!style) {
    return false;
  }

  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse" ||
    style.contentVisibility === "hidden" ||
    style.opacity === "0"
  );
}

function isRenderedTextNode(textNode) {
  if (!normalizeInlineText(textNode.nodeValue ?? "")) {
    return false;
  }

  const range = textNode.ownerDocument.createRange();
  range.selectNodeContents(textNode);
  const isRendered = range.getClientRects().length > 0;
  range.detach?.();
  return isRendered;
}

export function visibleStructuredText(rootNode) {
  const parts = [];
  const documentNode =
    rootNode.nodeType === rootNode.DOCUMENT_NODE ? rootNode : rootNode.ownerDocument;
  const NodeConstructor = documentNode.defaultView.Node;

  function appendBreak() {
    if (parts.length > 0 && parts.at(-1) !== "\n") {
      parts.push("\n");
    }
  }

  function visit(node) {
    if (node.nodeType === NodeConstructor.TEXT_NODE) {
      if (isRenderedTextNode(node)) {
        parts.push(node.nodeValue ?? "");
      }
      return;
    }

    if (node.nodeType !== NodeConstructor.ELEMENT_NODE) {
      for (const child of node.childNodes) {
        visit(child);
      }
      return;
    }

    if (isHiddenFromRendering(node)) {
      return;
    }

    if (node.tagName === "BR") {
      appendBreak();
      return;
    }

    const createsBreak =
      BLOCK_TAG_NAMES.has(node.tagName) || CONTROL_BREAK_TAG_NAMES.has(node.tagName);
    if (createsBreak) {
      appendBreak();
    }

    for (const child of node.childNodes) {
      visit(child);
    }

    if (createsBreak) {
      appendBreak();
    }
  }

  visit(rootNode);
  return parts.join("");
}

export function cloneVisibleElement(element, prepare = null) {
  if (isHiddenFromRendering(element)) return null;
  const clone = element.cloneNode(true);
  function visit(original, copy) {
    if (original.nodeType !== 1) return;
    if (isHiddenFromRendering(original)) { copy.remove(); return; }
    const children = Array.from(copy.childNodes);
    for (let index = 0; index < original.childNodes.length; index++) {
      visit(original.childNodes[index], children[index]);
    }
    prepare?.(original, copy);
  }
  visit(element, clone);
  return clone;
}

export function splitText(text, maxChunkLength = 1500) {
  const sentences = text.match(/[^。！？!?]+[。！？!?]?/g) ?? [];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxChunkLength) {
      current += sentence;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = "";
    }

    if (sentence.length <= maxChunkLength) {
      current = sentence;
      continue;
    }

    for (let offset = 0; offset < sentence.length; offset += maxChunkLength) {
      chunks.push(sentence.slice(offset, offset + maxChunkLength));
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

