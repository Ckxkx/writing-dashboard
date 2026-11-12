import { context } from "esbuild";

const watch = process.argv.includes("--watch");
const build = await context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian"],
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});
if (watch) await build.watch();
else {
  try { await build.rebuild(); }
  finally { await build.dispose(); }
}
