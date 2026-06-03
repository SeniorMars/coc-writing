# coc-writing

WordNet-powered dictionary, definition, and thesaurus tools for
[coc.nvim](https://github.com/neoclide/coc.nvim).

`coc-writing` is built for writing-heavy buffers: Markdown, plain text, TeX,
and commit messages. It provides dictionary completion with definitions,
intentional dictionary/thesaurus search commands, and optional inline thesaurus
completion.

## Features

- Dictionary completion from WordNet lemmas.
- Markdown documentation in Coc's completion detail window.
- Definition preview for the word under the cursor.
- Intentional dictionary and thesaurus pickers.
- Fuzzy prefix correction for common typos such as `sincers` -> `sincere`.
- Background warming for the heavier spelling correction index.
- Configurable thesaurus breadth.

## Install

From npm:

```vim
:CocInstall coc-writing
```

From a local checkout:

```bash
npm install
npm run build
npm pack --cache /private/tmp/coc-writing-npm-cache
```

Then install the generated tarball in Neovim:

```vim
:CocInstall /Users/charlie/Projects/coc-writing/coc-writing-0.2.0.tgz
:CocRestart
```

## Commands

```vim
:CocCommand coc-writing.definition
:CocCommand coc-writing.searchDictionary
:CocCommand coc-writing.searchThesaurus
:CocCommand coc-writing.health
:CocCommand coc-writing.warmSpellingIndex
```

## Lists

```vim
:CocList writingDictionary
:CocList writingThesaurus sincere
```

List rows use this shape:

```text
word | gloss
~fuzzy match | gloss
```

## Completion Sources

Dictionary completion is enabled by default.

Thesaurus inline completion is disabled by default because synonym replacement
is usually more intentional than ordinary word completion. Use
`coc-writing.searchThesaurus` or `:CocList writingThesaurus <word>` unless you
want thesaurus suggestions while typing.

Example:

```json
{
  "coc-writing.dictionary.filetypes": ["text", "markdown", "gitcommit"],
  "coc-writing.thesaurus.enable": true,
  "coc-writing.thesaurus.filetypes": ["markdown"],
  "coc-writing.thesaurus.mode": "focused"
}
```

## Performance

Startup loads only the WordNet index files first. The larger spelling
correction index is warmed in the background after startup, so the extension is
usable quickly while whole-word spelling fallback becomes ready shortly after.

Relevant settings:

```json
{
  "coc-writing.dictionary.fuzzy.warmSpellingIndex": true,
  "coc-writing.dictionary.fuzzy.warmSpellingDelay": 1000
}
```

Use `:CocCommand coc-writing.health` to inspect runtime state:

```text
loaded:           true
lemmas indexed:   147,306
fuzzy cached:     0
spelling built:   true
spelling keys:    3,254,113
```

Run `:CocCommand coc-writing.warmSpellingIndex` to build the spelling index
manually.

## Thesaurus Modes

```json
{
  "coc-writing.thesaurus.mode": "focused"
}
```

- `focused`: `&`, `^` relations only. Usually less noisy.
- `broad`: `&`, `^`, `+` relations. Adds derivationally related forms.
- `custom`: use `coc-writing.thesaurus.similarityPointers`.

`custom` defaults to:

```json
{
  "coc-writing.thesaurus.similarityPointers": ["&", "^", "+"]
}
```

## Pointer Symbols

Definition previews can show selected WordNet relations with
`coc-writing.definitionPointers`.

Default:

```json
{
  "coc-writing.definitionPointers": ["!", "&", "^"]
}
```

Common symbols:

| Symbol | Meaning |
| --- | --- |
| `!` | Antonym |
| `&` | Similar to |
| `^` | Also see |
| `@` | Hypernym |
| `~` | Hyponym |
| `+` | Derivationally related form |

## Configuration Reference

| Setting | Default | Purpose |
| --- | --- | --- |
| `coc-writing.enable` | `true` | Enable the extension. |
| `coc-writing.filetypes` | `["markdown", "text", "tex", "plaintex", "gitcommit"]` | Shared source filetypes. |
| `coc-writing.dictionary.enable` | `true` | Enable dictionary completion. |
| `coc-writing.dictionary.filetypes` | `[]` | Override dictionary filetypes; empty inherits shared filetypes. |
| `coc-writing.dictionary.minInputLength` | `3` | Minimum typed length for dictionary completion. |
| `coc-writing.dictionary.maxItems` | `50` | Maximum dictionary completion items. |
| `coc-writing.dictionary.fuzzy.enable` | `true` | Enable fuzzy prefix and spelling fallback. |
| `coc-writing.dictionary.fuzzy.minInputLength` | `5` | Minimum typed length for fuzzy fallback. |
| `coc-writing.dictionary.includeMultiword` | `false` | Include space-separated WordNet phrases in completion. |
| `coc-writing.thesaurus.enable` | `false` | Enable inline thesaurus completion. |
| `coc-writing.thesaurus.filetypes` | `[]` | Override thesaurus filetypes; empty inherits shared filetypes. |
| `coc-writing.thesaurus.mode` | `"custom"` | Use focused, broad, or custom relation sets. |
| `coc-writing.thesaurus.maxItems` | `50` | Maximum thesaurus items. |
| `coc-writing.thesaurus.similarityDepth` | `2` | Relation traversal depth. |
| `coc-writing.definitionMaxSynsets` | `8` | Maximum senses shown in docs/previews. |

## Development

```bash
npm install
npm test
npm run build
./node_modules/.bin/tsc --noEmit
npm pack --dry-run --json --cache /private/tmp/coc-writing-npm-cache
```

## Acknowledgements

This extension uses the WordNet 3.0 database from Princeton University.

The completion design is inspired by
[blink-cmp-words](https://github.com/archie-judd/blink-cmp-words).

## License

MIT
