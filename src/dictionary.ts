import { VimCompleteItem, workspace } from "coc.nvim";
import {
  buildDefinitionText,
  formatWordForDisplay,
  getLemmaPos,
  getWordsWithFuzzyPrefix,
  getWordsWithPrefix,
  isLoaded,
} from "./wordnet";
import { applyCapType, getCapType } from "./util";

export function createDictionarySource(filetypes: string[]) {
  const config = workspace.getConfiguration("coc-writing");
  const priority = config.get<number>("dictionary.priority", 20);

  return {
    name: "writing-dictionary",
    shortcut: "dict",
    triggerCharacters: [] as string[],
    priority,
    filetypes,

    doComplete: async function (opt: { input: string }) {
      if (!isLoaded()) return null;

      const cfg = workspace.getConfiguration("coc-writing");
      if (!cfg.get<boolean>("dictionary.enable", true)) return null;

      const input = opt.input;
      if (!input || !/^[A-Za-z]{2,}$/.test(input)) return null;

      const minLen = cfg.get<number>("dictionary.minInputLength", 3);
      if (input.length < minLen) return null;

      const maxItems = cfg.get<number>("dictionary.maxItems", 50);
      const fuzzyEnabled = cfg.get<boolean>("dictionary.fuzzy.enable", true);
      const fuzzyMinLen = cfg.get<number>("dictionary.fuzzy.minInputLength", 5);

      const { words: lemmas, fuzzy } =
        fuzzyEnabled && input.length >= fuzzyMinLen
          ? getWordsWithFuzzyPrefix(input, maxItems)
          : { words: getWordsWithPrefix(input, maxItems), fuzzy: false };

      if (lemmas.length === 0) return null;

      const cap = getCapType(input);
      const includeMultiword = cfg.get<boolean>(
        "dictionary.includeMultiword",
        false,
      );
      const lowerInput = input.toLowerCase();

      // Sort priority: exact match → simple word → hyphenated → multi-word
      function sortKey(lemma: string): string {
        const d = formatWordForDisplay(lemma);
        if (d === lowerInput) return "0";
        if (!d.includes(" ") && !d.includes("-")) return "1";
        if (!d.includes(" ")) return "2";
        return "3";
      }

      const items = lemmas
        .filter((lemma) => {
          if (includeMultiword) return true;
          // Exclude multi-word expressions (spaces) unless the user typed one
          return !formatWordForDisplay(lemma).includes(" ");
        })
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
        .map((lemma, i) => {
          const display = applyCapType(formatWordForDisplay(lemma), cap);
          const posLabel = getLemmaPos(lemma);
          return {
            word: display,
            abbr: display,
            filterText: fuzzy ? input : display,
            menu: fuzzy ? "[spell]" : posLabel ? `[${posLabel}]` : "[dict]",
            sortText: String(i).padStart(5, "0"),
            kind: "Dictionary",
            info: "",
            data: { lemma },
          } as VimCompleteItem & { data: { lemma: string } };
        });

      return { items, isIncomplete: fuzzy };
    },

    onCompleteResolve: async function (item: VimCompleteItem): Promise<void> {
      const lemma =
        (item as VimCompleteItem & { data?: { lemma?: string } }).data?.lemma ??
          item.word.toLowerCase().replace(/ /g, "_");

      const cfg = workspace.getConfiguration("coc-writing");
      const defPointers: string[] = cfg.get("definitionPointers", [
        "!",
        "&",
        "^",
      ]);
      const maxSynsets: number = cfg.get("definitionMaxSynsets", 8);
      try {
        const definition = buildDefinitionText(lemma, defPointers, maxSynsets);
        item.info = definition;
        item.documentation = [{ filetype: "markdown", content: definition }];
      } catch (err) {
        const message = `coc-writing: failed to resolve dictionary docs: ${err}`;
        item.info = message;
        item.documentation = [{ filetype: "markdown", content: message }];
      }
    },
  };
}
