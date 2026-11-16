import { build } from "vite";

export async function buildSiteBundle() {
  const result = await build({ configFile: false, logLevel: "silent", build: {
    write: false, minify: false,
    lib: { entry: "reader/tests/support/site-api.mjs", name: "SiteTest", formats: ["iife"] },
  } });
  return (Array.isArray(result) ? result[0] : result).output.find(item => item.type === "chunk").code;
}
