import { CompletionItemKind, VimCompleteItem, workspace } from "coc.nvim";
import {
  buildDefinitionText,
  collectSynonymsForWord,
  formatWordForDisplay,
  getLemmaPos,
  isLoaded,
  lookupWord,
} from "./wordnet";
import { applyCapType, getCapType, normalizeLemma } from "./util";

// '&' = Similar to (adjective clusters), '^' = Also see, '+' = Derivationally related
const DEFAULT_SIM_POINTERS = ["&", "^", "+"];

export function createThesaurusSource(filetypes: string[]) {
  const config = workspace.getConfiguration("coc-writing");
  const priority = config.get<number>("thesaurus.priority", 30);

  return {
    name: "writing-thesaurus",
    shortcut: "thes",
    triggerCharacters: [] as string[],
    priority,
    filetypes,

    doComplete: async function (opt: { input: string }) {
      if (!isLoaded()) return null;

      const cfg = workspace.getConfiguration("coc-writing");
      if (!cfg.get<boolean>("thesaurus.enable", false)) return null;

      const input = opt.input;
      if (!input || !/^[A-Za-z]{2,}$/.test(input)) return null;

      const minLen = cfg.get<number>("thesaurus.minInputLength", 4);
      if (input.length < minLen) return null;

      const simPointers: string[] = cfg.get(
        "thesaurus.similarityPointers",
        DEFAULT_SIM_POINTERS,
      );
      const depth: number = cfg.get("thesaurus.similarityDepth", 2);
      const maxItems = cfg.get<number>("thesaurus.maxItems", 50);

      if (lookupWord(input).length === 0) return null;

      const cap = getCapType(input);
      const synonymMap = collectSynonymsForWord(
        input,
        simPointers,
        depth,
        maxItems,
      );
      if (synonymMap.size === 0) return null;

      const items = Array.from(synonymMap.entries()).map(([lemmaKey], i) => {
        const display = applyCapType(formatWordForDisplay(lemmaKey), cap);
        const posLabel = getLemmaPos(lemmaKey);
        return {
          word: display,
          abbr: display,
          // filterText must be `input` (not the synonym word) so coc doesn't
          // filter out "glad" when the user has typed "important".
          filterText: input,
          menu: posLabel ? `[${posLabel}~]` : "[thes]",
          sortText: String(i).padStart(5, "0"),
          kind: CompletionItemKind.Text,
          info: "",
          data: { lemma: lemmaKey, query: normalizeLemma(input) },
        } as VimCompleteItem & { data: { lemma: string; query: string } };
      });

      return { items, isIncomplete: false };
    },

    onCompleteResolve: async function (item: VimCompleteItem): Promise<void> {
      const data =
        (item as VimCompleteItem & {
          data?: { lemma?: string; query?: string };
        }).data;
      const lemma = data?.lemma ?? normalizeLemma(item.word);
      const query = data?.query ?? lemma;

      const cfg = workspace.getConfiguration("coc-writing");
      const defPointers: string[] = cfg.get("definitionPointers", [
        "!",
        "&",
        "^",
      ]);
      const maxSynsets: number = cfg.get("definitionMaxSynsets", 8);

      const synonymDef = buildDefinitionText(lemma, defPointers, maxSynsets);
      const queryDef = query !== lemma
        ? buildDefinitionText(query, defPointers, maxSynsets)
        : "";

      item.info = synonymDef +
        (queryDef
          ? `\n\n─── (your word: ${
            formatWordForDisplay(query)
          }) ───\n\n${queryDef}`
          : "");
    },
  };
}
