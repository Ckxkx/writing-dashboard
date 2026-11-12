import MarkdownIt from "markdown-it";
import type { Settings } from "./model";

const md = new MarkdownIt({ html: true, linkify: false });
md.inline.ruler.before("link", "obsidian_wiki", (state, silent) => {
  const at = state.pos;
  const embed = state.src.startsWith("![[", at);
  if (!embed && !state.src.startsWith("[[", at)) return false;
  const start = at + (embed ? 3 : 2);
  // Bound this lookup, including for long malformed runs of opening brackets.
  const match = /^([^[\]\n]{1,2048})\]\]/.exec(state.src.slice(start, start + 2050));
  if (!match) return false;
  if (!silent) {
    const [target, ...alias] = match[1].split("|");
    const label = alias.length ? alias.join("|") : target.split("/").at(-1)!.replace(/\.md(?=#|$)/i, "").replace(/#/g, " ");
    state.push("text", "", 0).content = embed ? " " : label;
  }
  state.pos = start + match[0].length;
  return true;
});

const frontmatter = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;
export function readFrontmatter(text: string): RegExpExecArray | undefined {
  if (!/^(?:\uFEFF)?---[ \t]*\r?\n/.test(text)) return;
  const yaml = frontmatter.exec(text);
  if (yaml?.index === 0) return yaml;
}
const tokens = /\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{M}])+(?:['’](?:(?!\p{Script=Han})[\p{L}\p{M}])+)*|\p{Nd}+/gu;
export const MAX_SOURCE = 1_048_576;

export const sameText = (left: string, right: string) =>
  left === right || left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");

export function countable(text: string, options: Pick<Settings, "frontmatter" | "codeBlocks">): string[] | null {
  if (text.length > MAX_SOURCE) return null;
  const yaml = readFrontmatter(text);
  const parts: string[] = [];
  if (yaml) {
    if (options.frontmatter) parts.push(yaml[1], " ");
    text = text.slice(yaml[0].length);
  }
  for (const block of md.parse(text, {})) {
    if (block.type === "inline") {
      for (const token of block.children ?? []) {
        if (token.type === "text") parts.push(token.content);
        else if (["image", "code_inline", "softbreak", "hardbreak", "html_inline"].includes(token.type)) parts.push(" ");
      }
      parts.push(" ");
    } else if (options.codeBlocks && (block.type === "fence" || block.type === "code_block")) {
      parts.push(block.content, " ");
    }
  }
  return parts.join("").normalize("NFC").match(tokens) ?? [];
}

export interface Delta { added: number; removed: number; net: number }
const maxWork = 300_000;

// Myers edit distance after removing identical ends. The distance and length
// difference determine the insertion and deletion counts without a trace matrix.
export function difference(before: string[], after: string[]): Delta | null {
  let start = 0, a = before.length, b = after.length;
  const net = b - a;
  while (start < a && start < b && before[start] === after[start]) start++;
  while (a > start && b > start && before[a - 1] === after[b - 1]) { a--; b--; }
  const n = a - start, m = b - start;
  if (!n || !m) return { added: m, removed: n, net };
  const limit = Math.min(n + m, 700);
  if (Math.abs(net) > limit) return null;
  const origin = limit + 1;
  const furthest = new Int32Array(2 * limit + 3);
  let work = 0;
  const deadline = performance.now() + 18;
  for (let d = 0; d <= limit; d++) {
    if (performance.now() > deadline) return null;
    for (let k = -d; k <= d; k += 2) {
      if (++work > maxWork) return null;
      const index = origin + k;
      let x = k === -d || (k !== d && furthest[index - 1] < furthest[index + 1])
        ? furthest[index + 1] : furthest[index - 1] + 1;
      let y = x - k;
      while (x < n && y < m && before[start + x] === after[start + y]) {
        if (++work > maxWork) return null;
        x++; y++;
      }
      furthest[index] = x;
      if (x >= n && y >= m) return { added: (d + net) / 2, removed: (d - net) / 2, net };
    }
  }
  return null;
}
