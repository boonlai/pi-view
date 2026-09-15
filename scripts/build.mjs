import { build } from "esbuild";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
async function buildPackage() {
  await Promise.all([
    ["src/index.ts", "dist/index.js"],
    ["src/image-worker.mjs", "dist/image-worker.mjs"],
  ].map(([entry, outfile]) => build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["@earendil-works/*", "sharp"],
    legalComments: "inline",
  })));
  console.log("Built pi-view");
}

await buildPackage();
if (process.argv.includes("--watch")) {
  let timer;
  let building = false;
  let pending = false;
  const rebuild = async () => {
    if (building) { pending = true; return; }
    building = true;
    do {
      pending = false;
      try { await buildPackage(); } catch (error) { console.error(error); }
    } while (pending);
    building = false;
  };
  const watcher = watch(new URL("../src/", import.meta.url), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void rebuild(); }, 100);
  });
  const close = () => { clearTimeout(timer); watcher.close(); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  console.log("Watching src/ for changes");
}
