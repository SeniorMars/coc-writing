import {
  BasicList,
  ListAction,
  ListContext,
  ListItem,
  Neovim,
  workspace,
} from "coc.nvim";
import {
  buildDefinitionText,
  collectSynonymsForWord,
  formatWordForDisplay,
  getFirstGloss,
  getWordsWithFuzzyPrefix,
  isLoaded,
  lookupWord,
} from "./wordnet";
import { getThesaurusSimilarityPointers, openPreviewBuffer } from "./util";

// ---------------------------------------------------------------------------
// Module-level pending queries
//
// Using module-level variables rather than instance fields guarantees that
// the command handler and the list's loadItems see the same value, regardless
// of how coc.nvim stores list references internally.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared preview helper
// ---------------------------------------------------------------------------

async function previewDefinition(nvim: Neovim, lemma: string): Promise<void> {
  const cfg = workspace.getConfiguration("coc-writing");
  const defPointers: string[] = cfg.get("definitionPointers", ["!", "&", "^"]);
  const maxSynsets: number = cfg.get("definitionMaxSynsets", 8);
  const definition = buildDefinitionText(lemma, defPointers, maxSynsets);
  if (!definition) return;
  await openPreviewBuffer(nvim, definition.split("\n"));
}

// ---------------------------------------------------------------------------
// Word replacement and insertion
// ---------------------------------------------------------------------------

function wordRangeAt(line: string, col: number): [number, number] | null {
  const re = /[A-Za-z][A-Za-z'_-]*/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (col >= start && col <= end) return [start, end];
  }

  return null;
}

async function replaceWordUnderCursor(
  nvim: Neovim,
  word: string,
): Promise<void> {
  const pos = await nvim.call("getpos", ["."]) as number[];
  const line = await nvim.call("getline", ["."]) as string;
  const col = pos[2] - 1;

  const range = wordRangeAt(line, col);
  if (!range) return;

  const [start, end] = range;
  const newLine = line.slice(0, start) + word + line.slice(end);

  await nvim.call("setline", [".", newLine]);
  await nvim.call("cursor", [pos[1], start + word.length + 1]);
}

function needsLeftSpace(line: string, col: number): boolean {
  return col > 0 && /\S/.test(line[col - 1]) &&
    !/[\s([{'"\u2018\u201c]/.test(line[col - 1]);
}

function needsRightSpace(line: string, col: number): boolean {
  return col < line.length && /\S/.test(line[col]) &&
    !/[\s.,;:!?)\]}'"\u2019\u201d]/.test(line[col]);
}

async function insertWord(nvim: Neovim, word: string): Promise<void> {
  const pos = await nvim.call("getpos", ["."]) as number[];
  const line = await nvim.call("getline", ["."]) as string;
  const col = pos[2] - 1;

  const text = (needsLeftSpace(line, col) ? " " : "") +
    word +
    (needsRightSpace(line, col) ? " " : "");

  const newLine = line.slice(0, col) + text + line.slice(col);

  await nvim.call("setline", [".", newLine]);
  await nvim.call("cursor", [pos[1], col + text.length + 1]);
}

// ---------------------------------------------------------------------------
// Dictionary list — interactive prefix search
// ---------------------------------------------------------------------------

export class DictionaryList extends BasicList {
  public readonly name = "writingDictionary";
  public readonly description = "Search the WordNet dictionary";
  public readonly defaultAction = "replace";
  public readonly interactive = true;
  public actions: ListAction[] = [];

  constructor(nvim: Neovim) {
    super();

    this.addAction("replace", async (item: ListItem) => {
      await replaceWordUnderCursor(nvim, item.data.word);
    });

    this.addAction("insert", async (item: ListItem) => {
      await insertWord(nvim, item.data.word);
    });

    this.addAction("preview", async (item: ListItem) => {
      await previewDefinition(nvim, item.data.lemma);
    });
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    if (!isLoaded()) return [];

    // Interactive: context.input is the live-typed search term.
    // Falls back to CocList args if somehow passed.
    const argQuery = context.args?.join(" ").trim() ?? "";
    const query = context.input?.trim() || argQuery;

    if (query.length < 2) return [];

    const cfg = workspace.getConfiguration("coc-writing");
    const maxItems = cfg.get<number>("dictionary.maxItems", 50);
    const showGlosses = cfg.get<boolean>("dictionary.list.showGlosses", true);

    const { words: lemmas, fuzzy } = getWordsWithFuzzyPrefix(
      query,
      maxItems * 4,
    );

    return lemmas.map((lemma) => {
      const display = formatWordForDisplay(lemma);
      const gloss = showGlosses ? getFirstGloss(lemma) : "";
      const label = fuzzy
        ? (gloss ? `~${display} | ${gloss}` : `~${display}`)
        : (gloss ? `${display} | ${gloss}` : display);
      return {
        label,
        filterText: fuzzy ? query : display,
        data: { lemma, word: display },
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Thesaurus list — fixed query, filterable results
// ---------------------------------------------------------------------------

export class ThesaurusList extends BasicList {
  public readonly name = "writingThesaurus";
  public readonly description = "Find synonyms using the WordNet thesaurus";
  public readonly defaultAction = "replace";
  public actions: ListAction[] = [];

  constructor(nvim: Neovim) {
    super();

    this.addAction("replace", async (item: ListItem) => {
      await replaceWordUnderCursor(nvim, item.data.word);
    });

    this.addAction("insert", async (item: ListItem) => {
      await insertWord(nvim, item.data.word);
    });

    this.addAction("preview", async (item: ListItem) => {
      await previewDefinition(nvim, item.data.lemma);
    });
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    if (!isLoaded()) return [];

    // Word is passed as context.args[0] from the CocList command string.
    // This matches the coc.nvim BasicList args convention used by coc-git
    // and other well-known extensions (e.g. CocList gfiles <sha>).
    const argQuery = context.args?.[0]?.trim() ?? "";
    const query = (argQuery || context.input?.trim() || "").trim()
      .toLowerCase();

    if (query.length < 2) return [];

    if (lookupWord(query).length === 0) return [];

    const cfg = workspace.getConfiguration("coc-writing");
    const simPointers = getThesaurusSimilarityPointers(cfg);
    const depth: number = cfg.get("thesaurus.similarityDepth", 2);
    const maxItems = cfg.get<number>("thesaurus.maxItems", 50);

    const synonymMap = collectSynonymsForWord(
      query,
      simPointers,
      depth,
      maxItems,
    );

    return Array.from(synonymMap.entries()).map(([lemmaKey, gloss]) => {
      const display = formatWordForDisplay(lemmaKey);
      return {
        label: gloss ? `${display} | ${gloss}` : display,
        filterText: display,
        data: { lemma: lemmaKey, word: display },
      };
    });
  }
}
