import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { normalizeLemma } from "./util";

export type POS = "n" | "v" | "a" | "s" | "r";
type POSFile = "noun" | "verb" | "adj" | "adv";

const posToFile: Record<string, POSFile> = {
  n: "noun",
  v: "verb",
  a: "adj",
  s: "adj",
  r: "adv",
};

const POS_LABEL: Record<string, string> = {
  n: "noun",
  v: "verb",
  a: "adj.",
  s: "adj.",
  r: "adv.",
};

const POINTER_LABEL: Record<string, string> = {
  "!": "Antonym",
  "@": "Hypernym",
  "@i": "Instance Hypernym",
  "~": "Hyponym",
  "^": "Also see",
  "~i": "Instance Hyponym",
  "#m": "Member holonym",
  "#s": "Substance holonym",
  "#p": "Part holonym",
  "%m": "Member meronym",
  "%s": "Substance meronym",
  "%p": "Part meronym",
  "=": "Attribute",
  "*": "Entailment",
  "$": "Verb Group",
  "+": "Derivationally related form",
  ";c": "Domain - TOPIC",
  "-c": "Member of TOPIC",
  ";r": "Domain - REGION",
  "-r": "Member of REGION",
  ";u": "Domain - USAGE",
  "-u": "Member of USAGE",
  ">": "Cause",
  "&": "Similar to",
  "<": "Participle of verb",
  "\\": "Derived from adjective",
};

const VALID_POS = new Set<string>(["n", "v", "a", "s", "r"]);

function isPOS(value: string): value is POS {
  return VALID_POS.has(value);
}

export interface IndexEntry {
  pos: POS;
  offsets: number[];
  senseCount: number;
  tagSenseCount: number;
}
export interface Pointer {
  symbol: string;
  synsetOffset: number;
  pos: POS;
}
export interface Synset {
  offset: number;
  pos: POS;
  words: string[];
  gloss: string;
  pointers: Pointer[];
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let index = new Map<string, IndexEntry[]>();
let sortedKeys: string[] = [];
let dataDir = "";
let loaded = false;
let loadPromise: Promise<void> | null = null;
let deleteIndexPromise: Promise<void> | null = null;
let deleteIndexBuildGeneration = 0;

const synsetCache = new Map<string, Synset | null>();
const dataFds = new Map<POSFile, number>();
// First-gloss cache shared across all callers (lists, health command)
const glossCache = new Map<string, string>();
const fuzzyPrefixCache = new Map<string, string[]>();
const FUZZY_PREFIX_CACHE_LIMIT = 200;
const FUZZY_PREFIX_SCORE_CUTOFF = 180;
const DELETE_INDEX_BUILD_CHUNK_SIZE = 500;

// SymSpell-style delete index: delete-variant -> original lemmas
let deleteIndex = new Map<string, Set<string>>();
let deleteIndexBuilt = false;
// ---------------------------------------------------------------------------
// Public state API
// ---------------------------------------------------------------------------

export function isLoaded(): boolean {
  return loaded;
}

export interface WordNetStats {
  loaded: boolean;
  dataDir: string;
  lemmaCount: number;
  synsetCacheSize: number;
  glossCacheSize: number;
  fuzzyPrefixCacheSize: number;
  deleteIndexBuilt: boolean;
  deleteIndexSize: number;
  openFiles: number;
}

export function getWordNetStats(): WordNetStats {
  return {
    loaded,
    dataDir,
    lemmaCount: index.size,
    synsetCacheSize: synsetCache.size,
    glossCacheSize: glossCache.size,
    fuzzyPrefixCacheSize: fuzzyPrefixCache.size,
    deleteIndexBuilt,
    deleteIndexSize: deleteIndex.size,
    openFiles: dataFds.size,
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export async function loadIndex(dir: string): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Parse into a temporary map so partial-failure never leaves stale state.
    const nextIndex = new Map<string, IndexEntry[]>();

    try {
      dataDir = dir;
      const posFiles: [POS, POSFile][] = [
        ["n", "noun"],
        ["v", "verb"],
        ["a", "adj"],
        ["r", "adv"],
      ];
      await Promise.all(
        posFiles.map(([pos, file]) =>
          parseIndexFileInto(path.join(dir, `index.${file}`), pos, nextIndex)
        ),
      );

      // Atomic commit: only update global state if all files parsed successfully.
      index = nextIndex;
      sortedKeys = Array.from(index.keys()).sort();
      fuzzyPrefixCache.clear();
      deleteIndex.clear();
      deleteIndexBuilt = false;
      deleteIndexPromise = null;
      deleteIndexBuildGeneration++;
      loaded = true;
    } catch (err) {
      // Reset so a future call can retry cleanly.
      loadPromise = null;
      dataDir = "";
      index.clear();
      sortedKeys = [];
      fuzzyPrefixCache.clear();
      deleteIndex.clear();
      deleteIndexBuilt = false;
      deleteIndexPromise = null;
      deleteIndexBuildGeneration++;
      loaded = false;
      throw err;
    }
  })();

  return loadPromise;
}

/** Close fds and clear all cached state. Safe to call from deactivate(). */
export function closeWordNet(): void {
  for (const fd of dataFds.values()) {
    try {
      fs.closeSync(fd);
    } catch { /* ignore */ }
  }
  dataFds.clear();
  synsetCache.clear();
  glossCache.clear();
  fuzzyPrefixCache.clear();
  deleteIndex.clear();
  deleteIndexBuilt = false;
  deleteIndexPromise = null;
  deleteIndexBuildGeneration++;
  index.clear();
  sortedKeys = [];
  dataDir = "";
  loaded = false;
  loadPromise = null;
}

// ---------------------------------------------------------------------------
// Index parsing
// ---------------------------------------------------------------------------

async function parseIndexFileInto(
  filePath: string,
  pos: POS,
  target: Map<string, IndexEntry[]>,
): Promise<void> {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (line.startsWith("  ") || line.trim() === "") continue;

    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const lemma = parts[0];
    const synsetCnt = Number.parseInt(parts[2], 10);
    const pCnt = Number.parseInt(parts[3], 10);

    if (Number.isNaN(synsetCnt) || Number.isNaN(pCnt)) continue;

    const senseCountIdx = 4 + pCnt;
    const tagSenseCountIdx = senseCountIdx + 1;
    const senseCount = Number.parseInt(parts[senseCountIdx] ?? "0", 10);
    const tagSenseCount = Number.parseInt(
      parts[tagSenseCountIdx] ?? "0",
      10,
    );
    const offsetStart = tagSenseCountIdx + 1;
    const offsets = parts
      .slice(offsetStart, offsetStart + synsetCnt)
      .map(Number)
      .filter((n) => !Number.isNaN(n));

    if (offsets.length === 0) continue;

    const entry: IndexEntry = {
      pos,
      offsets,
      senseCount: Number.isNaN(senseCount) ? offsets.length : senseCount,
      tagSenseCount: Number.isNaN(tagSenseCount) ? 0 : tagSenseCount,
    };
    const existing = target.get(lemma);
    if (existing) existing.push(entry);
    else target.set(lemma, [entry]);
  }
}

// ---------------------------------------------------------------------------
// Data file access
// ---------------------------------------------------------------------------

function getDataFd(file: POSFile): number | null {
  const cached = dataFds.get(file);
  if (cached !== undefined) return cached;
  try {
    const fd = fs.openSync(path.join(dataDir, `data.${file}`), "r");
    dataFds.set(file, fd);
    return fd;
  } catch {
    return null;
  }
}

/**
 * Read one synset line starting at `offset`.
 * Reads in chunks until newline so lines of any length are handled.
 */
function readLineAt(file: POSFile, offset: number): string | null {
  const fd = getDataFd(file);
  if (fd === null) return null;

  const chunks: Buffer[] = [];
  let position = offset;

  try {
    while (true) {
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, position);
      if (bytesRead === 0) break;

      const nl = buf.indexOf(0x0a);
      if (nl >= 0 && nl < bytesRead) {
        chunks.push(buf.subarray(0, nl));
        break;
      }

      chunks.push(buf.subarray(0, bytesRead));
      position += bytesRead;
    }
  } catch {
    return null;
  }

  return chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : null;
}

// ---------------------------------------------------------------------------
// Public lookup API
// ---------------------------------------------------------------------------

export function lookupWord(word: string): IndexEntry[] {
  return index.get(normalizeLemma(word)) ?? [];
}

export function getWordsWithPrefix(prefix: string, limit: number): string[] {
  const lower = normalizeLemma(prefix);
  let lo = 0;
  let hi = sortedKeys.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid] < lower) lo = mid + 1;
    else hi = mid;
  }

  const results: string[] = [];
  for (let i = lo; i < sortedKeys.length && results.length < limit; i++) {
    if (!sortedKeys[i].startsWith(lower)) break;
    results.push(sortedKeys[i]);
  }
  return results;
}

// ---------------------------------------------------------------------------
// SymSpell delete-index helpers
// ---------------------------------------------------------------------------

/** All strings obtained by deleting exactly one character from word. */
function edits1(word: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < word.length; i++) {
    out.push(word.slice(0, i) + word.slice(i + 1));
  }
  return out;
}

/**
 * All strings obtained by deleting up to maxDistance characters (BFS).
 * Does not include the original word.
 */
function editsDeletes(word: string, maxDistance: number): Set<string> {
  let frontier = new Set<string>([word]);
  const deletes = new Set<string>();
  for (let d = 0; d < maxDistance; d++) {
    const next = new Set<string>();
    for (const item of frontier) {
      for (const deleted of edits1(item)) {
        if (!deletes.has(deleted)) {
          deletes.add(deleted);
          next.add(deleted);
        }
      }
    }
    frontier = next;
  }
  return deletes;
}

/**
 * Build the SymSpell delete index once after the word list is loaded.
 * Maps every delete-variant of every lemma to the set of original lemmas.
 * maxDistance = 2 handles typos up to 2 edits away.
 */
function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function addDeleteIndexLemma(
  target: Map<string, Set<string>>,
  lemma: string,
  maxDistance: number,
): void {
  if (lemma.length < 4) return;
  if (lemma.length > 24) return;
  if (lemma.includes("_")) return;
  if (!/^[a-z'-]+$/.test(lemma)) return;

  for (const del of editsDeletes(lemma, maxDistance)) {
    const existing = target.get(del) ?? new Set<string>();
    existing.add(lemma);
    target.set(del, existing);
  }
}

async function buildDeleteIndex(
  maxDistance: number,
  generation: number,
): Promise<Map<string, Set<string>> | null> {
  const tmp = new Map<string, Set<string>>();

  for (let i = 0; i < sortedKeys.length; i++) {
    if (generation !== deleteIndexBuildGeneration) return null;
    addDeleteIndexLemma(tmp, sortedKeys[i], maxDistance);

    if ((i + 1) % DELETE_INDEX_BUILD_CHUNK_SIZE === 0) {
      await waitForNextTurn();
    }
  }

  return generation === deleteIndexBuildGeneration ? tmp : null;
}

export function warmSpellingIndex(): Promise<void> {
  if (deleteIndexBuilt) return Promise.resolve();
  if (deleteIndexPromise) return deleteIndexPromise;

  const generation = deleteIndexBuildGeneration;
  const promise = (async () => {
    const built = await buildDeleteIndex(2, generation);
    if (!built) return;
    if (generation !== deleteIndexBuildGeneration) return;
    deleteIndex = built;
    deleteIndexBuilt = true;
  })();

  deleteIndexPromise = promise;
  promise.then(
    () => {
      if (deleteIndexPromise === promise) deleteIndexPromise = null;
    },
    () => {
      if (deleteIndexPromise === promise) deleteIndexPromise = null;
    },
  );

  return promise;
}

// ---------------------------------------------------------------------------
// Damerau-Levenshtein distance (transpositions count as one edit)
// ---------------------------------------------------------------------------

function damerauLevenshtein(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = maxDistance + 1;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, dp[i - 2][j - 2] + 1); // transposition
      }
      dp[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }
  return dp[a.length][b.length];
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function lowerBoundKey(key: string): number {
  let lo = 0;
  let hi = sortedKeys.length;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid] < key) lo = mid + 1;
    else hi = mid;
  }

  return lo;
}

function lemmaFrequencyBonus(lemma: string): number {
  const entries = lookupWord(lemma);
  let tagSenseCount = 0;
  let senseCount = 0;

  for (const entry of entries) {
    tagSenseCount += entry.tagSenseCount;
    senseCount += entry.senseCount;
  }

  // `tagSenseCount` is corpus evidence; `senseCount` is a weaker fallback.
  // Keep the bonus bounded so frequency only breaks close fuzzy matches.
  return Math.min(
    Math.log1p(tagSenseCount) * 8 + Math.log1p(senseCount) * 2,
    25,
  );
}

function getCachedFuzzyPrefix(cacheKey: string, limit: number): string[] | null {
  const cached = fuzzyPrefixCache.get(cacheKey);
  return cached ? cached.slice(0, limit) : null;
}

function setCachedFuzzyPrefix(cacheKey: string, words: string[]): void {
  if (fuzzyPrefixCache.size >= FUZZY_PREFIX_CACHE_LIMIT) {
    const oldest = fuzzyPrefixCache.keys().next().value;
    if (oldest !== undefined) fuzzyPrefixCache.delete(oldest);
  }
  fuzzyPrefixCache.set(cacheKey, words);
}

// ---------------------------------------------------------------------------
// Spelling suggestions + fuzzy prefix search
// ---------------------------------------------------------------------------

/**
 * Find spelling corrections for `input` using the precomputed delete index.
 *
 * SymSpell-style pipeline:
 *   1. Generate delete-variants of the query.
 *   2. Look each variant up in the delete index → candidate original lemmas.
 *   3. Score by Damerau-Levenshtein + common prefix + length proximity.
 *   4. Return best-ranked suggestions.
 *
 * "sincersly" → "sincerely", "sincere", "sincerity" (not every sinc* word).
 */
export function getSpellingSuggestions(
  input: string,
  limit: number,
  maxDistance = 2,
): string[] {
  const query = normalizeLemma(input);
  if (query.length < 4) return [];

  if (!deleteIndexBuilt) {
    warmSpellingIndex().catch(() => {});
    return [];
  }

  // Use tighter distance for short words — edit distance 2 is too permissive on 4-5 letter words.
  const effectiveMaxDistance = query.length <= 5 ? 1 : maxDistance;

  const candidateSet = new Set<string>();

  // First-letter filter: most typos preserve the first character.
  // This dramatically reduces false positives without hurting recall.
  function addHit(hit: string): void {
    if (hit[0] !== query[0]) return;
    candidateSet.add(hit);
  }

  for (const del of editsDeletes(query, effectiveMaxDistance)) {
    const hits = deleteIndex.get(del);
    if (hits) { for (const hit of hits) addHit(hit); }
  }
  const directHits = deleteIndex.get(query);
  if (directHits) { for (const hit of directHits) addHit(hit); }

  const scored: Array<{ lemma: string; score: number }> = [];
  for (const lemma of candidateSet) {
    const distance = damerauLevenshtein(query, lemma, effectiveMaxDistance);
    if (distance > effectiveMaxDistance) continue;
    const prefixBonus = commonPrefixLength(query, lemma);
    const lengthPenalty = Math.abs(lemma.length - query.length);
    // Prefer plain words over hyphenated/apostrophe forms
    const punctuationPenalty = /[-']/.test(lemma) ? 3 : 0;
    const frequencyBonus = lemmaFrequencyBonus(lemma);
    const score = distance * 100 - prefixBonus * 5 + lengthPenalty * 2 +
      punctuationPenalty - frequencyBonus;
    scored.push({ lemma, score });
  }

  scored.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.lemma.localeCompare(b.lemma)
  );
  return scored.slice(0, limit).map((x) => x.lemma);
}

function scoreFuzzyPrefix(
  query: string,
  lemma: string,
  maxDistance: number,
  allowFirstLetterMismatch: boolean,
): number | null {
  if (!allowFirstLetterMismatch && lemma[0] !== query[0]) return null;

  const minPrefixLength = Math.max(1, query.length - maxDistance);
  const maxPrefixLength = Math.min(lemma.length, query.length + maxDistance);
  let bestScore: number | null = null;

  for (let len = minPrefixLength; len <= maxPrefixLength; len++) {
    const prefix = lemma.slice(0, len);
    const distance = damerauLevenshtein(query, prefix, maxDistance);
    if (distance > maxDistance) continue;

    const prefixBonus = commonPrefixLength(query, prefix);
    const lengthPenalty = Math.abs(prefix.length - query.length);
    const tailPenalty = Math.min(lemma.length - prefix.length, 8);
    const punctuationPenalty = /[-']/.test(lemma) ? 3 : 0;
    const frequencyBonus = lemmaFrequencyBonus(lemma);
    const firstLetterPenalty = lemma[0] === query[0] ? 0 : 45;
    const score = distance * 100 - prefixBonus * 6 + lengthPenalty * 5 +
      tailPenalty * 4 + punctuationPenalty + firstLetterPenalty -
      frequencyBonus;

    if (bestScore === null || score < bestScore) bestScore = score;
  }

  return bestScore;
}

/**
 * Fuzzy prefix completion for misspelled stems.
 *
 * Unlike `getSpellingSuggestions`, this compares the query to candidate word
 * prefixes, so a mistyped partial word can still complete to a longer lemma.
 */
export function getFuzzyPrefixSuggestions(
  input: string,
  limit: number,
  maxDistance = 2,
): string[] {
  const query = normalizeLemma(input);
  if (query.length < 4 || !/^[a-z]/.test(query)) return [];

  const cacheKey = `${query}|${limit}|${maxDistance}`;
  const cached = getCachedFuzzyPrefix(cacheKey, limit);
  if (cached) return cached;

  // Use tighter distance for short words — edit distance 2 is too permissive on 4-5 letter words.
  const effectiveMaxDistance = query.length <= 5 ? 1 : maxDistance;
  const allowFirstLetterMismatch = query.length >= 7;
  const first = query[0];
  const start = allowFirstLetterMismatch ? 0 : lowerBoundKey(first);
  const end = allowFirstLetterMismatch
    ? sortedKeys.length
    : lowerBoundKey(String.fromCharCode(first.charCodeAt(0) + 1));
  const scored: Array<{ lemma: string; score: number }> = [];

  for (let i = start; i < end; i++) {
    const lemma = sortedKeys[i];
    if (lemma.length < query.length - effectiveMaxDistance) continue;
    if (lemma.includes("_")) continue;
    if (!/^[a-z'-]+$/.test(lemma)) continue;

    const score = scoreFuzzyPrefix(
      query,
      lemma,
      effectiveMaxDistance,
      allowFirstLetterMismatch,
    );
    if (score !== null) scored.push({ lemma, score });
  }

  scored.sort((a, b) =>
    a.score !== b.score ? a.score - b.score : a.lemma.localeCompare(b.lemma)
  );

  const bestScore = scored[0]?.score;
  const words = bestScore === undefined
    ? []
    : scored
      .filter((x) =>
        x.score <= FUZZY_PREFIX_SCORE_CUTOFF && x.score <= bestScore + 80
      )
      .slice(0, limit)
      .map((x) => x.lemma);

  setCachedFuzzyPrefix(cacheKey, words);
  return words;
}

/**
 * Prefix search with SymSpell spell-correction fallback.
 * Returns exact prefix matches when any exist; otherwise spelling suggestions
 * ranked by fuzzy-prefix and Damerau-Levenshtein distance.
 */
export function getWordsWithFuzzyPrefix(
  input: string,
  limit: number,
): { words: string[]; fuzzy: boolean } {
  const exact = getWordsWithPrefix(input, limit);
  if (exact.length > 0) return { words: exact, fuzzy: false };

  const fuzzyPrefix = getFuzzyPrefixSuggestions(input, limit, 2);
  if (fuzzyPrefix.length > 0) return { words: fuzzyPrefix, fuzzy: true };

  const spelling = getSpellingSuggestions(input, limit, 2);
  if (spelling.length > 0) return { words: spelling, fuzzy: true };

  return { words: [], fuzzy: false };
}

export function readSynset(pos: POS, offset: number): Synset | null {
  const file = posToFile[pos];
  if (!file) return null;

  const cacheKey = `${file}:${offset}`;
  if (synsetCache.has(cacheKey)) return synsetCache.get(cacheKey) ?? null;

  const line = readLineAt(file, offset);
  const synset = line ? parseSynsetLine(line, pos, offset) : null;
  synsetCache.set(cacheKey, synset);
  return synset;
}

function parseSynsetLine(
  line: string,
  pos: POS,
  offset: number,
): Synset | null {
  const pipeIdx = line.indexOf("|");
  const gloss = pipeIdx >= 0 ? line.slice(pipeIdx + 2).trim() : "";
  const dataPart = pipeIdx >= 0 ? line.slice(0, pipeIdx) : line;

  const parts = dataPart.trim().split(/\s+/);
  let i = 0;

  i++; // synset_offset
  i++; // lex_filenum

  const rawType = parts[i++] ?? pos;
  const ssType: POS = isPOS(rawType) ? rawType : pos;

  const wCnt = Number.parseInt(parts[i++], 16);
  if (Number.isNaN(wCnt)) return null;

  const words: string[] = [];
  for (let w = 0; w < wCnt; w++) {
    if (i >= parts.length) break;
    words.push(parts[i++].replace(/_/g, " "));
    i++; // lex_id
  }

  const pCnt = Number.parseInt(parts[i++], 10);
  if (Number.isNaN(pCnt)) {
    return { offset, pos: ssType, words, gloss, pointers: [] };
  }

  const pointers: Pointer[] = [];
  for (let p = 0; p < pCnt; p++) {
    if (i + 3 > parts.length) break;
    const symbol = parts[i++];
    const synsetOffset = Number.parseInt(parts[i++], 10);
    const rawPos = parts[i++];
    i++; // source/target hex
    if (Number.isNaN(synsetOffset)) continue;
    const pPos: POS = isPOS(rawPos) ? rawPos : ssType;
    pointers.push({ symbol, synsetOffset, pos: pPos });
  }

  return { offset, pos: ssType, words, gloss, pointers };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatWordForDisplay(raw: string): string {
  return raw.replace(/\(.*?\)/g, "").replace(/_/g, " ").trim();
}

/** Primary part-of-speech label for a lemma (e.g. "noun", "verb", "adj."). */
export function getLemmaPos(lemma: string): string {
  const pos = lookupWord(lemma)[0]?.pos;
  return pos ? (POS_LABEL[pos] ?? "") : "";
}

/** First gloss for a lemma. Cached — safe to call in hot paths. */
export function getFirstGloss(lemma: string): string {
  const cached = glossCache.get(lemma);
  if (cached !== undefined) return cached;

  const entries = lookupWord(lemma);
  for (const entry of entries) {
    for (const offset of entry.offsets) {
      const synset = readSynset(entry.pos, offset);
      if (synset?.gloss) {
        glossCache.set(lemma, synset.gloss);
        return synset.gloss;
      }
    }
  }

  glossCache.set(lemma, "");
  return "";
}

// ---------------------------------------------------------------------------
// Definition builder
// ---------------------------------------------------------------------------

export function buildDefinitionText(
  lemma: string,
  definitionPointers: string[] = ["!", "&", "^"],
  maxSynsets = 8,
): string {
  const entries = lookupWord(lemma);
  if (entries.length === 0) return "";

  const blocks: string[] = [`## ${formatWordForDisplay(lemma)}`];
  let n = 0;
  let truncated = false;

  outer:
  for (const entry of entries) {
    for (const offset of entry.offsets) {
      if (n >= maxSynsets) {
        truncated = true;
        break outer;
      }

      const synset = readSynset(entry.pos, offset);
      if (!synset) continue;
      n++;

      const wordList = synset.words.map((w) => `**${formatWordForDisplay(w)}**`)
        .join(", ");
      const posLabel = POS_LABEL[synset.pos] ?? synset.pos;

      const ptrGroups = new Map<string, Set<string>>();
      for (const ptr of synset.pointers) {
        if (!definitionPointers.includes(ptr.symbol)) continue;
        const rel = readSynset(ptr.pos, ptr.synsetOffset);
        if (!rel) continue;
        const existing = ptrGroups.get(ptr.symbol) ?? new Set<string>();
        for (const w of rel.words) existing.add(formatWordForDisplay(w));
        ptrGroups.set(ptr.symbol, existing);
      }

      let block = `${n}. **[${posLabel}]** ${wordList}\n\n${synset.gloss}`;
      for (const [sym, words] of ptrGroups) {
        const label = POINTER_LABEL[sym] ?? sym;
        block += `\n\n- **${label}:** ${
          Array.from(words).slice(0, 8).join(", ")
        }`;
      }
      blocks.push(block);
    }
  }

  if (truncated) {
    blocks.push(`_Showing first ${maxSynsets} senses only._`);
  }

  return blocks.join("\n\n---\n\n");
}

// ---------------------------------------------------------------------------
// Synonym collection
// ---------------------------------------------------------------------------

export function collectSynonymsForWord(
  word: string,
  simPointers: string[],
  depth: number,
  limit: number,
): Map<string, string> {
  const queryKey = normalizeLemma(word);
  const entries = lookupWord(word);
  const result = new Map<string, string>();
  // Single visited set across all root synsets prevents redundant traversal.
  const visited = new Set<string>();

  function traverse(synset: Synset, remaining: number): void {
    if (remaining === 0 || result.size >= limit) return;
    const key = `${synset.pos}:${synset.offset}`;
    if (visited.has(key)) return;
    visited.add(key);

    for (const ptr of synset.pointers) {
      if (!simPointers.includes(ptr.symbol)) continue;
      const rel = readSynset(ptr.pos, ptr.synsetOffset);
      if (!rel) continue;
      for (const w of rel.words) {
        if (result.size >= limit) return;
        const wKey = normalizeLemma(w);
        if (wKey !== queryKey && !result.has(wKey)) result.set(wKey, rel.gloss);
      }
      if (remaining > 1) traverse(rel, remaining - 1);
    }
  }

  for (const entry of entries) {
    for (const offset of entry.offsets) {
      if (result.size >= limit) break;
      const synset = readSynset(entry.pos, offset);
      if (!synset) continue;

      for (const w of synset.words) {
        const wKey = normalizeLemma(w);
        if (wKey !== queryKey && !result.has(wKey)) {
          result.set(wKey, synset.gloss);
        }
      }

      traverse(synset, depth);
    }
  }

  return result;
}

/** Check whether each expected WordNet data file is present on disk. */
export function getDataFileStatus(): Record<string, boolean> {
  const files = [
    "data.adj",
    "data.adv",
    "data.noun",
    "data.verb",
    "index.adj",
    "index.adv",
    "index.noun",
    "index.verb",
    "index.sense",
  ];
  const result: Record<string, boolean> = {};
  for (const f of files) {
    try {
      fs.accessSync(path.join(dataDir, f));
      result[f] = true;
    } catch {
      result[f] = false;
    }
  }
  return result;
}
