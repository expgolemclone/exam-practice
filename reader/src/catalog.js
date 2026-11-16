import { canonicalQuestionIds } from "../../contracts/api.mjs";

export function createCatalogLoader({ fetchConcurrency, siteId, site, SyncRequestError, timeoutMs }) {
  async function fetchCatalogDocument(url, signal) {
    let response;
    let text;
    try {
      response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        throw new SyncRequestError("catalog_error", response.status);
      }
      text = await response.text();
    } catch (error) {
      if (signal.aborted) {
        throw new SyncRequestError("catalog_timeout");
      }
      if (error instanceof SyncRequestError) {
        throw error;
      }
      throw new SyncRequestError("catalog_error");
    }
    const mimeType = response.headers.get("Content-Type")?.includes("xml") ? "application/xml" : "text/html";
    const documentNode = new DOMParser().parseFromString(text, mimeType);
    if (documentNode.querySelector("parsererror") !== null) {
      throw new SyncRequestError("catalog_error");
    }
    return documentNode;
  }

  function createCatalogDocumentLoader(signal) {
    let activeCount = 0;
    const queue = [];

    const startNext = () => {
      while (activeCount < fetchConcurrency && queue.length > 0) {
        const task = queue.shift();
        if (signal.aborted) {
          task.reject(new SyncRequestError("catalog_timeout"));
          continue;
        }
        activeCount += 1;
        void fetchCatalogDocument(task.url, signal)
          .then(task.resolve, task.reject)
          .finally(() => {
            activeCount -= 1;
            startNext();
          });
      }
    };

    return (url) =>
      new Promise((resolve, reject) => {
        queue.push({ url, resolve, reject });
        startNext();
      });
  }


  async function loadCompleteQuestionCatalog() {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const ids = await site.loadCatalog(siteId, createCatalogDocumentLoader(controller.signal),
        { fetchConcurrency, SyncRequestError });
      if (!ids.length || new Set(ids).size !== ids.length) throw new SyncRequestError("catalog_error");
      return canonicalQuestionIds(ids);
    } catch (error) {
      controller.abort();
      throw error;
    } finally { window.clearTimeout(timeout); }
  }
  return Object.freeze({ loadCompleteQuestionCatalog });
}
