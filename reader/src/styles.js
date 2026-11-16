import mantineStyles from "@mantine/core/styles.css?inline";

export const FRAME_THEME_CSS = `
    :root {
      color-scheme: dark;
      --exam-practice-frame-canvas: #0b0d10;
      --exam-practice-frame-surface: #15191e;
      --exam-practice-frame-raised: #1d232b;
      --exam-practice-frame-text: #f3f4f6;
      --exam-practice-frame-muted: #a8b0bb;
      --exam-practice-frame-border: #343b45;
      --exam-practice-frame-link: #8ab4f8;
      --exam-practice-frame-correct: #52e1b6;
      --exam-practice-frame-incorrect: #e89292;
    }

`;


export function installReaderStyles() {
  const style = document.createElement("style");
  style.textContent = mantineStyles + `
    html { font-size: 100% !important; }
    html, body { width: 100% !important; height: 100svh !important; margin: 0 !important;
      padding: 0 !important; overflow: hidden !important; background: #0b0d10 !important; }
    body[data-exam-practice-reader-ui="true"] { display: block !important; }
    #exam-practice-reader-shell { position: relative; width: 100%; height: 100%; overflow: hidden; }
    #exam-practice-reader-frame { display: block; width: 100%; height: 100%; border: 0; }
    #exam-practice-reader-time-limit { position: absolute; z-index: 3; inset: 0 0 auto; height: 4px; }
    #exam-practice-reader-study-time { position: absolute; z-index: 4;
      top: max(.5rem, env(safe-area-inset-top)); right: max(.5rem, env(safe-area-inset-right));
      width: clamp(1.45rem, 4.5vw, 1.7rem); height: clamp(1.45rem, 4.5vw, 1.7rem);
      padding: 0; border-radius: 50%; background: oklch(0.08 0 0 / 0.94); color: oklch(0.62 0 0);
      font-size: clamp(.46rem, 1.55vw, .56rem); pointer-events: none; }
    #exam-practice-reader-feedback { position: absolute; z-index: 5; top: 1rem; left: 50%;
      transform: translateX(-50%); width: min(672px, calc(100% - 32px)); pointer-events: none; }
    #exam-practice-next-question-launcher { min-height: 100svh; padding:
      max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); }
    #exam-practice-next-question-panel { width: min(420px, 100%); }
  `;
  document.documentElement.appendChild(style);
}
