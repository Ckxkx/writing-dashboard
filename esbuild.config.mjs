import { context } from "esbuild";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const licenseText = ["LICENSE", "THIRD-PARTY-NOTICES.txt"]
  .map(name => readFileSync(new URL(name, import.meta.url), "utf8").replace(/\r\n?/g, "\n").trimEnd())
  .join("\n\n")
  .replace(/\*\//g, "* /");
const build = await context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian"],
  banner: { js: "/*! Writing Dashboard — Apache-2.0\nCopyright 2026 Writing Dashboard contributors\n\n" +
    licenseText + "\n*/" },
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});
if (watch) await build.watch();
else {
  try { await build.rebuild(); }
  finally { await build.dispose(); }
}
