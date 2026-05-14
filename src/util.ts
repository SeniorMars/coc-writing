import { Neovim } from "coc.nvim";

// ---------------------------------------------------------------------------
// Lemma normalization
// ---------------------------------------------------------------------------

/**
 * Canonical internal key: trimmed, lowercase, any whitespace → underscore.
 * Handles multiple spaces and leading/trailing whitespace from list/command input.
 */
export function normalizeLemma(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "_");
}

// ---------------------------------------------------------------------------
// Capitalization — ported from blink-cmp-words source.lua
// ---------------------------------------------------------------------------

export type CapType =
  | "empty"
  | "no letters"
  | "upper case"
  | "lower case"
  | "title case"
  | "mixed case";

export function getCapType(str: string): CapType {
  if (!str) return "empty";
  const letters = str.replace(/[^a-zA-Z]/g, "");
  if (!letters) return "no letters";
  const uppers = letters.replace(/[^A-Z]/g, "");
  const lowers = letters.replace(/[^a-z]/g, "");
  if (uppers.length === letters.length) return "upper case";
  if (lowers.length === letters.length) return "lower case";
  const firstAlpha = str.match(/[a-zA-Z]/);
  if (firstAlpha && firstAlpha[0] === firstAlpha[0].toUpperCase()) {
    const afterFirst = str.slice(str.indexOf(firstAlpha[0]) + 1).replace(
      /[^a-zA-Z]/g,
      "",
    );
    if (afterFirst === afterFirst.toLowerCase()) return "title case";
  }
  return "mixed case";
}

export function applyCapType(str: string, cap: CapType): string {
  if (!str) return str;
  switch (cap) {
    case "upper case":
      return str.toUpperCase();
    case "lower case":
      return str.toLowerCase();
    case "title case": {
      const lower = str.toLowerCase();
      const idx = lower.search(/[a-z]/);
      if (idx < 0) return lower;
      return lower.slice(0, idx) + lower[idx].toUpperCase() +
        lower.slice(idx + 1);
    }
    default:
      return str;
  }
}

// ---------------------------------------------------------------------------
// Ex command argument escaping
// ---------------------------------------------------------------------------

/**
 * Escape a string for use as a Vim Ex command argument using Vim's own
 * `escape()` function. Handles spaces, backslashes, pipes, and quotes.
 * More correct than fnameescape() which is designed for filenames.
 */
export async function escapeExArg(nvim: Neovim, arg: string): Promise<string> {
  return await nvim.call("escape", [arg, " \\|\"'"]) as string;
}

// ---------------------------------------------------------------------------
// Preview buffer
// Reuses a single named buffer rather than opening a new split every time.
// ---------------------------------------------------------------------------

const PREVIEW_BUF_NAME = "__coc-writing-preview__";

export async function openPreviewBuffer(
  nvim: Neovim,
  lines: string[],
): Promise<void> {
  const bufnr = await nvim.call("bufnr", [PREVIEW_BUF_NAME]) as number;

  if (bufnr !== -1) {
    // Buffer exists — switch to its window or open it in a split
    const winnr = await nvim.call("bufwinnr", [bufnr]) as number;
    if (winnr !== -1) {
      await nvim.command(`${winnr}wincmd w`);
    } else {
      await nvim.command(`botright sbuffer ${bufnr}`);
    }
  } else {
    await nvim.command("botright new");
    await nvim.command(`silent! file ${PREVIEW_BUF_NAME}`);
  }

  const buf = await nvim.buffer;
  await buf.setOption("buftype", "nofile");
  // hide (not wipe) so the buffer survives closing the window and can be reused
  await buf.setOption("bufhidden", "hide");
  await buf.setOption("swapfile", false);
  await buf.setOption("buflisted", false);
  await buf.setOption("modifiable", true);
  await buf.setLines(lines, { start: 0, end: -1 });
  await buf.setOption("modifiable", false);
  await nvim.command("setlocal ft=markdown");
}
