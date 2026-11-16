import { kakomonn } from "./kakomonn.js";
import { studyzBoki3 } from "./studyz-boki3.js";

export function siteModule(source) {
  if (source?.kind === "kakomonn") return kakomonn;
  if (source?.kind === "studyz-boki3") return studyzBoki3;
  return null;
}
