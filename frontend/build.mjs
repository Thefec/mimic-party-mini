import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const r = (...p) => path.join(root, ...p);

async function buildSingleFile({ entry, template, css, outFiles }) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    minify: true,
    target: "es2022",
    legalComments: "none",
    write: false,
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const styles = (await Promise.all(css.map((f) => readFile(f, "utf8")))).join("\n");
  const html = (await readFile(template, "utf8"))
    .replace("<!--STYLE-->", () => `<style>${styles}</style>`)
    .replace("<!--SCRIPT-->", () => `<script>${js}</script>`);
  for (const out of outFiles) {
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, html);
  }
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`built ${outFiles.map((f) => path.relative(root, f)).join(", ")} (${kb} KB)`);
}

const target = process.argv[2] ?? "app";
if (target === "prototype" || target === "audio") {
  // Dev-only pages: prototype/index.html (3D scene) and prototype/audio.html (mic + scoring lab).
  const name = target === "prototype" ? "index" : "audio";
  await buildSingleFile({
    entry: r("prototype", target === "prototype" ? "prototype.js" : "audio.js"),
    template: r("prototype", `${name}.html`),
    css: [r("src", "styles.css")],
    outFiles: [r("prototype", "dist", `${name}.html`)],
  });
} else {
  await buildSingleFile({
    entry: r("src", "main.js"),
    template: r("src", "index.html"),
    css: [r("src", "styles.css")],
    outFiles: [r("dist", "index.html"), r("dist", "mimic-party-mini.html")],
  });
}
