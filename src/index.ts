import {
  commands,
  ExtensionContext,
  listManager,
  sources,
  window,
  workspace,
} from "coc.nvim";
import {
  buildDefinitionText,
  closeWordNet,
  collectSynonymsForWord,
  formatWordForDisplay,
  getDataFileStatus,
  getFirstGloss,
  getWordNetStats,
  getWordsWithFuzzyPrefix,
  isLoaded,
  loadIndex,
  lookupWord,
  warmSpellingIndex,
} from "./wordnet";
import { createDictionarySource } from "./dictionary";
import { createThesaurusSource } from "./thesaurus";
import { DictionaryList, ThesaurusList } from "./lists";
import { getThesaurusSimilarityPointers, openPreviewBuffer } from "./util";

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration("coc-writing");
  if (!config.get<boolean>("enable", true)) return;

  const defaultFiletypes = config.get<string[]>("filetypes", [
    "markdown",
    "text",
    "tex",
    "plaintex",
    "gitcommit",
  ]);
  const dictionaryFiletypes = config.get<string[]>(
    "dictionary.filetypes",
    [],
  );
  const thesaurusFiletypes = config.get<string[]>("thesaurus.filetypes", []);

  const dataDir = context.asAbsolutePath("data");
  const nvim = workspace.nvim;

  loadIndex(dataDir)
    .then(() => {
      if (config.get<boolean>("debug", false)) {
        window.showInformationMessage("coc-writing: WordNet loaded");
      }
      if (config.get<boolean>("dictionary.fuzzy.warmSpellingIndex", true)) {
        const delay = config.get<number>(
          "dictionary.fuzzy.warmSpellingDelay",
          1000,
        );
        setTimeout(() => {
          warmSpellingIndex().catch((err) => {
            if (config.get<boolean>("debug", false)) {
              window.showWarningMessage(
                `coc-writing: failed to warm spelling index: ${err}`,
              );
            }
          });
        }, Math.max(0, delay));
      }
    })
    .catch((err) => {
      window.showErrorMessage(
        `coc-writing: failed to load WordNet data: ${err}`,
      );
    });

  context.subscriptions.push(
    sources.createSource(
      createDictionarySource(
        dictionaryFiletypes.length > 0 ? dictionaryFiletypes : defaultFiletypes,
      ),
    ),
    sources.createSource(
      createThesaurusSource(
        thesaurusFiletypes.length > 0 ? thesaurusFiletypes : defaultFiletypes,
      ),
    ),
    listManager.registerList(new DictionaryList(nvim)),
    listManager.registerList(new ThesaurusList(nvim)),
    commands.registerCommand("coc-writing.searchDictionary", async () => {
      if (!isLoaded()) {
        window.showWarningMessage(
          "coc-writing: WordNet index is still loading",
        );
        return;
      }

      // Save cursor position before the input prompt opens
      const pos = await nvim.call("getpos", ["."]) as number[];
      const cursorLine = await nvim.call("getline", ["."]) as string;
      const cursorWord = await nvim.call("expand", ["<cword>"]) as string;

      // Pre-fill the input with cursor word; user can edit before searching
      const searchTerm = await nvim.call("input", [
        "Dictionary search: ",
        cursorWord,
      ]) as string;
      if (!searchTerm || searchTerm.trim().length < 2) return;

      const { words: lemmas, fuzzy } = getWordsWithFuzzyPrefix(
        searchTerm.trim(),
        50,
      );
      if (lemmas.length === 0) {
        window.showWarningMessage(
          `coc-writing: no words found for "${searchTerm}"`,
        );
        return;
      }

      const labels = lemmas.map((lemma) => {
        const display = formatWordForDisplay(lemma);
        const gloss = getFirstGloss(lemma);
        const prefix = fuzzy ? "~" : "";
        return gloss
          ? `${prefix}${display} — ${gloss.slice(0, 70)}`
          : `${prefix}${display}`;
      });

      const idx = await window.showQuickpick(
        labels,
        `Dictionary: "${searchTerm.trim()}"`,
      );
      if (idx < 0) return;

      const replacement = formatWordForDisplay(lemmas[idx]);
      const col = pos[2] - 1;

      // Find word span at saved cursor position and replace, or insert if off a word
      const re = /[A-Za-z][A-Za-z'_-]*/g;
      let start = -1, end = -1;
      let match: RegExpExecArray | null;
      while ((match = re.exec(cursorLine)) !== null) {
        if (col >= match.index && col <= match.index + match[0].length) {
          start = match.index;
          end = match.index + match[0].length;
          break;
        }
      }

      if (start >= 0) {
        const newLine = cursorLine.slice(0, start) + replacement +
          cursorLine.slice(end);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], start + replacement.length + 1]);
      } else {
        // Not on a word — insert at saved cursor position
        const newLine = cursorLine.slice(0, col) + replacement +
          cursorLine.slice(col);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], col + replacement.length + 1]);
      }
    }),
    // Thesaurus uses showQuickpick — avoids CocList arg-passing issues entirely.
    // Same approach as the definition command: do the work directly, show a UI.
    commands.registerCommand("coc-writing.searchThesaurus", async () => {
      if (!isLoaded()) {
        window.showWarningMessage(
          "coc-writing: WordNet index is still loading",
        );
        return;
      }
      const word = await nvim.call("expand", ["<cword>"]) as string;
      if (!word) {
        window.showWarningMessage("coc-writing: cursor is not on a word");
        return;
      }
      if (lookupWord(word).length === 0) {
        window.showWarningMessage(
          `coc-writing: "${word}" not found in WordNet`,
        );
        return;
      }

      const cfg = workspace.getConfiguration("coc-writing");
      const simPointers = getThesaurusSimilarityPointers(cfg);
      const depth: number = cfg.get("thesaurus.similarityDepth", 2);

      const synonymMap = collectSynonymsForWord(word, simPointers, depth, 100);
      if (synonymMap.size === 0) {
        window.showWarningMessage(
          `coc-writing: no synonyms found for "${word}" — try adding "@" or "~" to thesaurus.similarityPointers`,
        );
        return;
      }

      // Save cursor position BEFORE the quickpick opens (cursor may move during selection)
      const pos = await nvim.call("getpos", ["."]) as number[];
      const line = await nvim.call("getline", ["."]) as string;
      const col = pos[2] - 1;

      const lemmaKeys = Array.from(synonymMap.keys());
      const labels = lemmaKeys.map((lemmaKey) => {
        const display = formatWordForDisplay(lemmaKey);
        const gloss = synonymMap.get(lemmaKey) ?? "";
        return gloss ? `${display} — ${gloss.slice(0, 70)}` : display;
      });

      const idx = await window.showQuickpick(labels, `Synonyms for "${word}"`);
      if (idx < 0) return;

      const replacement = formatWordForDisplay(lemmaKeys[idx]);

      const re = /[A-Za-z][A-Za-z'_-]*/g;
      let start = -1, end = -1;
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        if (col >= match.index && col <= match.index + match[0].length) {
          start = match.index;
          end = match.index + match[0].length;
          break;
        }
      }

      if (start >= 0) {
        const newLine = line.slice(0, start) + replacement + line.slice(end);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], start + replacement.length + 1]);
      } else {
        // Cursor moved off the word during quickpick — insert at cursor position
        const newLine = line.slice(0, col) + replacement + line.slice(col);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], col + replacement.length + 1]);
      }
    }),
    commands.registerCommand("coc-writing.definition", async () => {
      if (!isLoaded()) {
        window.showWarningMessage(
          "coc-writing: WordNet index is still loading",
        );
        return;
      }
      const word = await nvim.call("expand", ["<cword>"]) as string;
      if (!word) return;

      const cfg = workspace.getConfiguration("coc-writing");
      const defPointers: string[] = cfg.get("definitionPointers", [
        "!",
        "&",
        "^",
      ]);
      const maxSynsets: number = cfg.get("definitionMaxSynsets", 8);
      const definition = buildDefinitionText(word, defPointers, maxSynsets);

      if (!definition) {
        window.showWarningMessage(
          `coc-writing: no definition found for "${
            formatWordForDisplay(word)
          }"`,
        );
        return;
      }

      await openPreviewBuffer(nvim, definition.split("\n"));
    }),
    commands.registerCommand("coc-writing.health", async () => {
      const cfg = workspace.getConfiguration("coc-writing");
      const stats = getWordNetStats();
      const fileStatus = stats.loaded ? getDataFileStatus() : {};
      const fileLines = Object.entries(fileStatus).map(
        ([f, ok]) => `  ${ok ? "✓" : "✗"} ${f}`,
      );

      const lines = [
        "# coc-writing health",
        "",
        `loaded:           ${stats.loaded}`,
        `dataDir:          ${stats.dataDir || "(not set)"}`,
        `lemmas indexed:   ${stats.lemmaCount.toLocaleString()}`,
        `synsets cached:   ${stats.synsetCacheSize.toLocaleString()}`,
        `glosses cached:   ${stats.glossCacheSize.toLocaleString()}`,
        `fuzzy cached:     ${stats.fuzzyPrefixCacheSize.toLocaleString()}`,
        `spelling built:   ${stats.deleteIndexBuilt}`,
        `spelling keys:    ${stats.deleteIndexSize.toLocaleString()}`,
        `open data fds:    ${stats.openFiles}`,
        "",
        "## Data files",
        ...(stats.loaded ? fileLines : ["  (not yet loaded)"]),
        "",
        "## Sources",
        `dictionary:       ${
          cfg.get("dictionary.enable", true) ? "enabled" : "disabled"
        }`,
        `thesaurus:        ${
          cfg.get("thesaurus.enable", false) ? "enabled" : "disabled (default)"
        }`,
        "",
        "## Config",
        `filetypes:        ${(cfg.get<string[]>("filetypes", [])).join(", ")}`,
        `dict filetypes:   ${
          (cfg.get<string[]>("dictionary.filetypes", [])).join(", ") ||
          "(inherit)"
        }`,
        `thes filetypes:   ${
          (cfg.get<string[]>("thesaurus.filetypes", [])).join(", ") ||
          "(inherit)"
        }`,
        `minInputLength:   ${cfg.get("dictionary.minInputLength", 3)}`,
        `maxItems:         dict=${cfg.get("dictionary.maxItems", 50)}, thes=${
          cfg.get("thesaurus.maxItems", 50)
        }`,
        `priority:         dict=${cfg.get("dictionary.priority", 20)}, thes=${
          cfg.get("thesaurus.priority", 30)
        }`,
        `definitionPointers: ${
          (cfg.get<string[]>("definitionPointers", ["!", "&", "^"])).join(" ")
        }`,
        `definitionMaxSynsets: ${cfg.get("definitionMaxSynsets", 8)}`,
        `thesaurusMode:    ${cfg.get("thesaurus.mode", "custom")}`,
        `similarityPointers: ${getThesaurusSimilarityPointers(cfg).join(" ")}`,
      ];

      await openPreviewBuffer(nvim, lines);
    }),
    commands.registerCommand("coc-writing.warmSpellingIndex", async () => {
      if (!isLoaded()) {
        window.showWarningMessage(
          "coc-writing: WordNet index is still loading",
        );
        return;
      }

      await warmSpellingIndex();
      window.showInformationMessage("coc-writing: spelling index warmed");
    }),
  );
}

export function deactivate(): void {
  closeWordNet();
}
