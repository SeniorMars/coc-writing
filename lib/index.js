"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(index_exports);
var import_coc4 = require("coc.nvim");

// src/wordnet.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var readline = __toESM(require("readline"));

// src/util.ts
function normalizeLemma(word) {
  return word.trim().toLowerCase().replace(/\s+/g, "_");
}
function getCapType(str) {
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
      ""
    );
    if (afterFirst === afterFirst.toLowerCase()) return "title case";
  }
  return "mixed case";
}
function applyCapType(str, cap) {
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
      return lower.slice(0, idx) + lower[idx].toUpperCase() + lower.slice(idx + 1);
    }
    default:
      return str;
  }
}
function getThesaurusSimilarityPointers(cfg) {
  const mode = cfg.get("thesaurus.mode", "custom");
  if (mode === "focused") return ["&", "^"];
  if (mode === "broad") return ["&", "^", "+"];
  return cfg.get("thesaurus.similarityPointers", ["&", "^", "+"]);
}
var PREVIEW_BUF_NAME = "__coc-writing-preview__";
async function openPreviewBuffer(nvim, lines) {
  const bufnr = await nvim.call("bufnr", [PREVIEW_BUF_NAME]);
  if (bufnr !== -1) {
    const winnr = await nvim.call("bufwinnr", [bufnr]);
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
  await buf.setOption("bufhidden", "hide");
  await buf.setOption("swapfile", false);
  await buf.setOption("buflisted", false);
  await buf.setOption("modifiable", true);
  await buf.setLines(lines, { start: 0, end: -1 });
  await buf.setOption("modifiable", false);
  await nvim.command("setlocal ft=markdown");
}

// src/wordnet.ts
var posToFile = {
  n: "noun",
  v: "verb",
  a: "adj",
  s: "adj",
  r: "adv"
};
var POS_LABEL = {
  n: "noun",
  v: "verb",
  a: "adj.",
  s: "adj.",
  r: "adv."
};
var POINTER_LABEL = {
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
  "\\": "Derived from adjective"
};
var VALID_POS = /* @__PURE__ */ new Set(["n", "v", "a", "s", "r"]);
function isPOS(value) {
  return VALID_POS.has(value);
}
var index = /* @__PURE__ */ new Map();
var sortedKeys = [];
var dataDir = "";
var loaded = false;
var loadPromise = null;
var deleteIndexPromise = null;
var deleteIndexBuildGeneration = 0;
var synsetCache = /* @__PURE__ */ new Map();
var dataFds = /* @__PURE__ */ new Map();
var glossCache = /* @__PURE__ */ new Map();
var fuzzyPrefixCache = /* @__PURE__ */ new Map();
var FUZZY_PREFIX_CACHE_LIMIT = 200;
var FUZZY_PREFIX_SCORE_CUTOFF = 180;
var DELETE_INDEX_BUILD_CHUNK_SIZE = 500;
var deleteIndex = /* @__PURE__ */ new Map();
var deleteIndexBuilt = false;
function isLoaded() {
  return loaded;
}
function getWordNetStats() {
  return {
    loaded,
    dataDir,
    lemmaCount: index.size,
    synsetCacheSize: synsetCache.size,
    glossCacheSize: glossCache.size,
    fuzzyPrefixCacheSize: fuzzyPrefixCache.size,
    deleteIndexBuilt,
    deleteIndexSize: deleteIndex.size,
    openFiles: dataFds.size
  };
}
async function loadIndex(dir) {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const nextIndex = /* @__PURE__ */ new Map();
    try {
      dataDir = dir;
      const posFiles = [
        ["n", "noun"],
        ["v", "verb"],
        ["a", "adj"],
        ["r", "adv"]
      ];
      await Promise.all(
        posFiles.map(
          ([pos, file]) => parseIndexFileInto(path.join(dir, `index.${file}`), pos, nextIndex)
        )
      );
      index = nextIndex;
      sortedKeys = Array.from(index.keys()).sort();
      fuzzyPrefixCache.clear();
      deleteIndex.clear();
      deleteIndexBuilt = false;
      deleteIndexPromise = null;
      deleteIndexBuildGeneration++;
      loaded = true;
    } catch (err) {
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
function closeWordNet() {
  for (const fd of dataFds.values()) {
    try {
      fs.closeSync(fd);
    } catch {
    }
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
async function parseIndexFileInto(filePath, pos, target) {
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
      10
    );
    const offsetStart = tagSenseCountIdx + 1;
    const offsets = parts.slice(offsetStart, offsetStart + synsetCnt).map(Number).filter((n) => !Number.isNaN(n));
    if (offsets.length === 0) continue;
    const entry = {
      pos,
      offsets,
      senseCount: Number.isNaN(senseCount) ? offsets.length : senseCount,
      tagSenseCount: Number.isNaN(tagSenseCount) ? 0 : tagSenseCount
    };
    const existing = target.get(lemma);
    if (existing) existing.push(entry);
    else target.set(lemma, [entry]);
  }
}
function getDataFd(file) {
  const cached = dataFds.get(file);
  if (cached !== void 0) return cached;
  try {
    const fd = fs.openSync(path.join(dataDir, `data.${file}`), "r");
    dataFds.set(file, fd);
    return fd;
  } catch {
    return null;
  }
}
function readLineAt(file, offset) {
  const fd = getDataFd(file);
  if (fd === null) return null;
  const chunks = [];
  let position = offset;
  try {
    while (true) {
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, position);
      if (bytesRead === 0) break;
      const nl = buf.indexOf(10);
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
function lookupWord(word) {
  return index.get(normalizeLemma(word)) ?? [];
}
function getWordsWithPrefix(prefix, limit) {
  const lower = normalizeLemma(prefix);
  let lo = 0;
  let hi = sortedKeys.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (sortedKeys[mid] < lower) lo = mid + 1;
    else hi = mid;
  }
  const results = [];
  for (let i = lo; i < sortedKeys.length && results.length < limit; i++) {
    if (!sortedKeys[i].startsWith(lower)) break;
    results.push(sortedKeys[i]);
  }
  return results;
}
function edits1(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    out.push(word.slice(0, i) + word.slice(i + 1));
  }
  return out;
}
function editsDeletes(word, maxDistance) {
  let frontier = /* @__PURE__ */ new Set([word]);
  const deletes = /* @__PURE__ */ new Set();
  for (let d = 0; d < maxDistance; d++) {
    const next = /* @__PURE__ */ new Set();
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
function waitForNextTurn() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
function addDeleteIndexLemma(target, lemma, maxDistance) {
  if (lemma.length < 4) return;
  if (lemma.length > 24) return;
  if (lemma.includes("_")) return;
  if (!/^[a-z'-]+$/.test(lemma)) return;
  for (const del of editsDeletes(lemma, maxDistance)) {
    const existing = target.get(del) ?? /* @__PURE__ */ new Set();
    existing.add(lemma);
    target.set(del, existing);
  }
}
async function buildDeleteIndex(maxDistance, generation) {
  const tmp = /* @__PURE__ */ new Map();
  for (let i = 0; i < sortedKeys.length; i++) {
    if (generation !== deleteIndexBuildGeneration) return null;
    addDeleteIndexLemma(tmp, sortedKeys[i], maxDistance);
    if ((i + 1) % DELETE_INDEX_BUILD_CHUNK_SIZE === 0) {
      await waitForNextTurn();
    }
  }
  return generation === deleteIndexBuildGeneration ? tmp : null;
}
function warmSpellingIndex() {
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
    }
  );
  return promise;
}
function damerauLevenshtein(a, b, maxDistance) {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Array(b.length + 1).fill(0)
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
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
  }
  return dp[a.length][b.length];
}
function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
function lowerBoundKey(key) {
  let lo = 0;
  let hi = sortedKeys.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (sortedKeys[mid] < key) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function lemmaFrequencyBonus(lemma) {
  const entries = lookupWord(lemma);
  let tagSenseCount = 0;
  let senseCount = 0;
  for (const entry of entries) {
    tagSenseCount += entry.tagSenseCount;
    senseCount += entry.senseCount;
  }
  return Math.min(
    Math.log1p(tagSenseCount) * 8 + Math.log1p(senseCount) * 2,
    25
  );
}
function getCachedFuzzyPrefix(cacheKey, limit) {
  const cached = fuzzyPrefixCache.get(cacheKey);
  return cached ? cached.slice(0, limit) : null;
}
function setCachedFuzzyPrefix(cacheKey, words) {
  if (fuzzyPrefixCache.size >= FUZZY_PREFIX_CACHE_LIMIT) {
    const oldest = fuzzyPrefixCache.keys().next().value;
    if (oldest !== void 0) fuzzyPrefixCache.delete(oldest);
  }
  fuzzyPrefixCache.set(cacheKey, words);
}
function getSpellingSuggestions(input, limit, maxDistance = 2) {
  const query = normalizeLemma(input);
  if (query.length < 4) return [];
  if (!deleteIndexBuilt) {
    warmSpellingIndex().catch(() => {
    });
    return [];
  }
  const effectiveMaxDistance = query.length <= 5 ? 1 : maxDistance;
  const candidateSet = /* @__PURE__ */ new Set();
  function addHit(hit) {
    if (hit[0] !== query[0]) return;
    candidateSet.add(hit);
  }
  for (const del of editsDeletes(query, effectiveMaxDistance)) {
    const hits = deleteIndex.get(del);
    if (hits) {
      for (const hit of hits) addHit(hit);
    }
  }
  const directHits = deleteIndex.get(query);
  if (directHits) {
    for (const hit of directHits) addHit(hit);
  }
  const scored = [];
  for (const lemma of candidateSet) {
    const distance = damerauLevenshtein(query, lemma, effectiveMaxDistance);
    if (distance > effectiveMaxDistance) continue;
    const prefixBonus = commonPrefixLength(query, lemma);
    const lengthPenalty = Math.abs(lemma.length - query.length);
    const punctuationPenalty = /[-']/.test(lemma) ? 3 : 0;
    const frequencyBonus = lemmaFrequencyBonus(lemma);
    const score = distance * 100 - prefixBonus * 5 + lengthPenalty * 2 + punctuationPenalty - frequencyBonus;
    scored.push({ lemma, score });
  }
  scored.sort(
    (a, b) => a.score !== b.score ? a.score - b.score : a.lemma.localeCompare(b.lemma)
  );
  return scored.slice(0, limit).map((x) => x.lemma);
}
function scoreFuzzyPrefix(query, lemma, maxDistance, allowFirstLetterMismatch) {
  if (!allowFirstLetterMismatch && lemma[0] !== query[0]) return null;
  const minPrefixLength = Math.max(1, query.length - maxDistance);
  const maxPrefixLength = Math.min(lemma.length, query.length + maxDistance);
  let bestScore = null;
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
    const score = distance * 100 - prefixBonus * 6 + lengthPenalty * 5 + tailPenalty * 4 + punctuationPenalty + firstLetterPenalty - frequencyBonus;
    if (bestScore === null || score < bestScore) bestScore = score;
  }
  return bestScore;
}
function getFuzzyPrefixSuggestions(input, limit, maxDistance = 2) {
  const query = normalizeLemma(input);
  if (query.length < 4 || !/^[a-z]/.test(query)) return [];
  const cacheKey = `${query}|${limit}|${maxDistance}`;
  const cached = getCachedFuzzyPrefix(cacheKey, limit);
  if (cached) return cached;
  const effectiveMaxDistance = query.length <= 5 ? 1 : maxDistance;
  const allowFirstLetterMismatch = query.length >= 7;
  const first = query[0];
  const start = allowFirstLetterMismatch ? 0 : lowerBoundKey(first);
  const end = allowFirstLetterMismatch ? sortedKeys.length : lowerBoundKey(String.fromCharCode(first.charCodeAt(0) + 1));
  const scored = [];
  for (let i = start; i < end; i++) {
    const lemma = sortedKeys[i];
    if (lemma.length < query.length - effectiveMaxDistance) continue;
    if (lemma.includes("_")) continue;
    if (!/^[a-z'-]+$/.test(lemma)) continue;
    const score = scoreFuzzyPrefix(
      query,
      lemma,
      effectiveMaxDistance,
      allowFirstLetterMismatch
    );
    if (score !== null) scored.push({ lemma, score });
  }
  scored.sort(
    (a, b) => a.score !== b.score ? a.score - b.score : a.lemma.localeCompare(b.lemma)
  );
  const bestScore = scored[0]?.score;
  const words = bestScore === void 0 ? [] : scored.filter(
    (x) => x.score <= FUZZY_PREFIX_SCORE_CUTOFF && x.score <= bestScore + 80
  ).slice(0, limit).map((x) => x.lemma);
  setCachedFuzzyPrefix(cacheKey, words);
  return words;
}
function getWordsWithFuzzyPrefix(input, limit) {
  const exact = getWordsWithPrefix(input, limit);
  if (exact.length > 0) return { words: exact, fuzzy: false };
  const fuzzyPrefix = getFuzzyPrefixSuggestions(input, limit, 2);
  if (fuzzyPrefix.length > 0) return { words: fuzzyPrefix, fuzzy: true };
  const spelling = getSpellingSuggestions(input, limit, 2);
  if (spelling.length > 0) return { words: spelling, fuzzy: true };
  return { words: [], fuzzy: false };
}
function readSynset(pos, offset) {
  const file = posToFile[pos];
  if (!file) return null;
  const cacheKey = `${file}:${offset}`;
  if (synsetCache.has(cacheKey)) return synsetCache.get(cacheKey) ?? null;
  const line = readLineAt(file, offset);
  const synset = line ? parseSynsetLine(line, pos, offset) : null;
  synsetCache.set(cacheKey, synset);
  return synset;
}
function parseSynsetLine(line, pos, offset) {
  const pipeIdx = line.indexOf("|");
  const gloss = pipeIdx >= 0 ? line.slice(pipeIdx + 2).trim() : "";
  const dataPart = pipeIdx >= 0 ? line.slice(0, pipeIdx) : line;
  const parts = dataPart.trim().split(/\s+/);
  let i = 0;
  i++;
  i++;
  const rawType = parts[i++] ?? pos;
  const ssType = isPOS(rawType) ? rawType : pos;
  const wCnt = Number.parseInt(parts[i++], 16);
  if (Number.isNaN(wCnt)) return null;
  const words = [];
  for (let w = 0; w < wCnt; w++) {
    if (i >= parts.length) break;
    words.push(parts[i++].replace(/_/g, " "));
    i++;
  }
  const pCnt = Number.parseInt(parts[i++], 10);
  if (Number.isNaN(pCnt)) {
    return { offset, pos: ssType, words, gloss, pointers: [] };
  }
  const pointers = [];
  for (let p = 0; p < pCnt; p++) {
    if (i + 3 > parts.length) break;
    const symbol = parts[i++];
    const synsetOffset = Number.parseInt(parts[i++], 10);
    const rawPos = parts[i++];
    i++;
    if (Number.isNaN(synsetOffset)) continue;
    const pPos = isPOS(rawPos) ? rawPos : ssType;
    pointers.push({ symbol, synsetOffset, pos: pPos });
  }
  return { offset, pos: ssType, words, gloss, pointers };
}
function formatWordForDisplay(raw) {
  return raw.replace(/\(.*?\)/g, "").replace(/_/g, " ").trim();
}
function getLemmaPos(lemma) {
  const pos = lookupWord(lemma)[0]?.pos;
  return pos ? POS_LABEL[pos] ?? "" : "";
}
function getFirstGloss(lemma) {
  const cached = glossCache.get(lemma);
  if (cached !== void 0) return cached;
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
function buildDefinitionText(lemma, definitionPointers = ["!", "&", "^"], maxSynsets = 8) {
  const entries = lookupWord(lemma);
  if (entries.length === 0) return "";
  const blocks = [`## ${formatWordForDisplay(lemma)}`];
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
        const wordList = synset.words.map((w) => `**${formatWordForDisplay(w)}**`).join(", ");
        const posLabel = POS_LABEL[synset.pos] ?? synset.pos;
        const ptrGroups = /* @__PURE__ */ new Map();
        for (const ptr of synset.pointers) {
          if (!definitionPointers.includes(ptr.symbol)) continue;
          const rel = readSynset(ptr.pos, ptr.synsetOffset);
          if (!rel) continue;
          const existing = ptrGroups.get(ptr.symbol) ?? /* @__PURE__ */ new Set();
          for (const w of rel.words) existing.add(formatWordForDisplay(w));
          ptrGroups.set(ptr.symbol, existing);
        }
        let block = `${n}. **[${posLabel}]** ${wordList}

${synset.gloss}`;
        for (const [sym, words] of ptrGroups) {
          const label = POINTER_LABEL[sym] ?? sym;
          block += `

- **${label}:** ${Array.from(words).slice(0, 8).join(", ")}`;
        }
        blocks.push(block);
      }
    }
  if (truncated) {
    blocks.push(`_Showing first ${maxSynsets} senses only._`);
  }
  return blocks.join("\n\n---\n\n");
}
function collectSynonymsForWord(word, simPointers, depth, limit) {
  const queryKey = normalizeLemma(word);
  const entries = lookupWord(word);
  const result = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  function traverse(synset, remaining) {
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
function getDataFileStatus() {
  const files = [
    "data.adj",
    "data.adv",
    "data.noun",
    "data.verb",
    "index.adj",
    "index.adv",
    "index.noun",
    "index.verb",
    "index.sense"
  ];
  const result = {};
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

// src/dictionary.ts
var import_coc = require("coc.nvim");
function createDictionarySource(filetypes) {
  const config = import_coc.workspace.getConfiguration("coc-writing");
  const priority = config.get("dictionary.priority", 20);
  return {
    name: "writing-dictionary",
    shortcut: "dict",
    triggerCharacters: [],
    priority,
    filetypes,
    doComplete: async function(opt) {
      if (!isLoaded()) return null;
      const cfg = import_coc.workspace.getConfiguration("coc-writing");
      if (!cfg.get("dictionary.enable", true)) return null;
      const input = opt.input;
      if (!input || !/^[A-Za-z]{2,}$/.test(input)) return null;
      const minLen = cfg.get("dictionary.minInputLength", 3);
      if (input.length < minLen) return null;
      const maxItems = cfg.get("dictionary.maxItems", 50);
      const fuzzyEnabled = cfg.get("dictionary.fuzzy.enable", true);
      const fuzzyMinLen = cfg.get("dictionary.fuzzy.minInputLength", 5);
      const { words: lemmas, fuzzy } = fuzzyEnabled && input.length >= fuzzyMinLen ? getWordsWithFuzzyPrefix(input, maxItems) : { words: getWordsWithPrefix(input, maxItems), fuzzy: false };
      if (lemmas.length === 0) return null;
      const cap = getCapType(input);
      const includeMultiword = cfg.get(
        "dictionary.includeMultiword",
        false
      );
      const lowerInput = input.toLowerCase();
      function sortKey(lemma) {
        const d = formatWordForDisplay(lemma);
        if (d === lowerInput) return "0";
        if (!d.includes(" ") && !d.includes("-")) return "1";
        if (!d.includes(" ")) return "2";
        return "3";
      }
      const items = lemmas.filter((lemma) => {
        if (includeMultiword) return true;
        return !formatWordForDisplay(lemma).includes(" ");
      }).sort((a, b) => sortKey(a).localeCompare(sortKey(b))).map((lemma, i) => {
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
          data: { lemma }
        };
      });
      return { items, isIncomplete: fuzzy };
    },
    onCompleteResolve: async function(item) {
      const lemma = item.data?.lemma ?? item.word.toLowerCase().replace(/ /g, "_");
      const cfg = import_coc.workspace.getConfiguration("coc-writing");
      const defPointers = cfg.get("definitionPointers", [
        "!",
        "&",
        "^"
      ]);
      const maxSynsets = cfg.get("definitionMaxSynsets", 8);
      try {
        const definition = buildDefinitionText(lemma, defPointers, maxSynsets);
        item.info = definition;
        item.documentation = [{ filetype: "markdown", content: definition }];
      } catch (err) {
        const message = `coc-writing: failed to resolve dictionary docs: ${err}`;
        item.info = message;
        item.documentation = [{ filetype: "markdown", content: message }];
      }
    }
  };
}

// src/thesaurus.ts
var import_coc2 = require("coc.nvim");
function createThesaurusSource(filetypes) {
  const config = import_coc2.workspace.getConfiguration("coc-writing");
  const priority = config.get("thesaurus.priority", 30);
  return {
    name: "writing-thesaurus",
    shortcut: "thes",
    triggerCharacters: [],
    priority,
    filetypes,
    doComplete: async function(opt) {
      if (!isLoaded()) return null;
      const cfg = import_coc2.workspace.getConfiguration("coc-writing");
      if (!cfg.get("thesaurus.enable", false)) return null;
      const input = opt.input;
      if (!input || !/^[A-Za-z]{2,}$/.test(input)) return null;
      const minLen = cfg.get("thesaurus.minInputLength", 4);
      if (input.length < minLen) return null;
      const simPointers = getThesaurusSimilarityPointers(cfg);
      const depth = cfg.get("thesaurus.similarityDepth", 2);
      const maxItems = cfg.get("thesaurus.maxItems", 50);
      if (lookupWord(input).length === 0) return null;
      const cap = getCapType(input);
      const synonymMap = collectSynonymsForWord(
        input,
        simPointers,
        depth,
        maxItems
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
          kind: "Thesaurus",
          info: "",
          data: { lemma: lemmaKey, query: normalizeLemma(input) }
        };
      });
      return { items, isIncomplete: false };
    },
    onCompleteResolve: async function(item) {
      const data = item.data;
      const lemma = data?.lemma ?? normalizeLemma(item.word);
      const query = data?.query ?? lemma;
      const cfg = import_coc2.workspace.getConfiguration("coc-writing");
      const defPointers = cfg.get("definitionPointers", [
        "!",
        "&",
        "^"
      ]);
      const maxSynsets = cfg.get("definitionMaxSynsets", 8);
      try {
        const synonymDef = buildDefinitionText(lemma, defPointers, maxSynsets);
        const queryDef = query !== lemma ? buildDefinitionText(query, defPointers, maxSynsets) : "";
        const definition = synonymDef + (queryDef ? `

---

## Your word: ${formatWordForDisplay(query)}

${queryDef}` : "");
        item.info = definition;
        item.documentation = [{ filetype: "markdown", content: definition }];
      } catch (err) {
        const message = `coc-writing: failed to resolve thesaurus docs: ${err}`;
        item.info = message;
        item.documentation = [{ filetype: "markdown", content: message }];
      }
    }
  };
}

// src/lists.ts
var import_coc3 = require("coc.nvim");
async function previewDefinition(nvim, lemma) {
  const cfg = import_coc3.workspace.getConfiguration("coc-writing");
  const defPointers = cfg.get("definitionPointers", ["!", "&", "^"]);
  const maxSynsets = cfg.get("definitionMaxSynsets", 8);
  const definition = buildDefinitionText(lemma, defPointers, maxSynsets);
  if (!definition) return;
  await openPreviewBuffer(nvim, definition.split("\n"));
}
function wordRangeAt(line, col) {
  const re = /[A-Za-z][A-Za-z'_-]*/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (col >= start && col <= end) return [start, end];
  }
  return null;
}
async function replaceWordUnderCursor(nvim, word) {
  const pos = await nvim.call("getpos", ["."]);
  const line = await nvim.call("getline", ["."]);
  const col = pos[2] - 1;
  const range = wordRangeAt(line, col);
  if (!range) return;
  const [start, end] = range;
  const newLine = line.slice(0, start) + word + line.slice(end);
  await nvim.call("setline", [".", newLine]);
  await nvim.call("cursor", [pos[1], start + word.length + 1]);
}
function needsLeftSpace(line, col) {
  return col > 0 && /\S/.test(line[col - 1]) && !/[\s([{'"\u2018\u201c]/.test(line[col - 1]);
}
function needsRightSpace(line, col) {
  return col < line.length && /\S/.test(line[col]) && !/[\s.,;:!?)\]}'"\u2019\u201d]/.test(line[col]);
}
async function insertWord(nvim, word) {
  const pos = await nvim.call("getpos", ["."]);
  const line = await nvim.call("getline", ["."]);
  const col = pos[2] - 1;
  const text = (needsLeftSpace(line, col) ? " " : "") + word + (needsRightSpace(line, col) ? " " : "");
  const newLine = line.slice(0, col) + text + line.slice(col);
  await nvim.call("setline", [".", newLine]);
  await nvim.call("cursor", [pos[1], col + text.length + 1]);
}
var DictionaryList = class extends import_coc3.BasicList {
  constructor(nvim) {
    super();
    this.name = "writingDictionary";
    this.description = "Search the WordNet dictionary";
    this.defaultAction = "replace";
    this.interactive = true;
    this.actions = [];
    this.addAction("replace", async (item) => {
      await replaceWordUnderCursor(nvim, item.data.word);
    });
    this.addAction("insert", async (item) => {
      await insertWord(nvim, item.data.word);
    });
    this.addAction("preview", async (item) => {
      await previewDefinition(nvim, item.data.lemma);
    });
  }
  async loadItems(context) {
    if (!isLoaded()) return [];
    const argQuery = context.args?.join(" ").trim() ?? "";
    const query = context.input?.trim() || argQuery;
    if (query.length < 2) return [];
    const cfg = import_coc3.workspace.getConfiguration("coc-writing");
    const maxItems = cfg.get("dictionary.maxItems", 50);
    const showGlosses = cfg.get("dictionary.list.showGlosses", true);
    const { words: lemmas, fuzzy } = getWordsWithFuzzyPrefix(
      query,
      maxItems * 4
    );
    return lemmas.map((lemma) => {
      const display = formatWordForDisplay(lemma);
      const gloss = showGlosses ? getFirstGloss(lemma) : "";
      const label = fuzzy ? gloss ? `~${display} | ${gloss}` : `~${display}` : gloss ? `${display} | ${gloss}` : display;
      return {
        label,
        filterText: fuzzy ? query : display,
        data: { lemma, word: display }
      };
    });
  }
};
var ThesaurusList = class extends import_coc3.BasicList {
  constructor(nvim) {
    super();
    this.name = "writingThesaurus";
    this.description = "Find synonyms using the WordNet thesaurus";
    this.defaultAction = "replace";
    this.actions = [];
    this.addAction("replace", async (item) => {
      await replaceWordUnderCursor(nvim, item.data.word);
    });
    this.addAction("insert", async (item) => {
      await insertWord(nvim, item.data.word);
    });
    this.addAction("preview", async (item) => {
      await previewDefinition(nvim, item.data.lemma);
    });
  }
  async loadItems(context) {
    if (!isLoaded()) return [];
    const argQuery = context.args?.[0]?.trim() ?? "";
    const query = (argQuery || context.input?.trim() || "").trim().toLowerCase();
    if (query.length < 2) return [];
    if (lookupWord(query).length === 0) return [];
    const cfg = import_coc3.workspace.getConfiguration("coc-writing");
    const simPointers = getThesaurusSimilarityPointers(cfg);
    const depth = cfg.get("thesaurus.similarityDepth", 2);
    const maxItems = cfg.get("thesaurus.maxItems", 50);
    const synonymMap = collectSynonymsForWord(
      query,
      simPointers,
      depth,
      maxItems
    );
    return Array.from(synonymMap.entries()).map(([lemmaKey, gloss]) => {
      const display = formatWordForDisplay(lemmaKey);
      return {
        label: gloss ? `${display} | ${gloss}` : display,
        filterText: display,
        data: { lemma: lemmaKey, word: display }
      };
    });
  }
};

// src/index.ts
async function activate(context) {
  const config = import_coc4.workspace.getConfiguration("coc-writing");
  if (!config.get("enable", true)) return;
  const defaultFiletypes = config.get("filetypes", [
    "markdown",
    "text",
    "tex",
    "plaintex",
    "gitcommit"
  ]);
  const dictionaryFiletypes = config.get(
    "dictionary.filetypes",
    []
  );
  const thesaurusFiletypes = config.get("thesaurus.filetypes", []);
  const dataDir2 = context.asAbsolutePath("data");
  const nvim = import_coc4.workspace.nvim;
  loadIndex(dataDir2).then(() => {
    if (config.get("debug", false)) {
      import_coc4.window.showInformationMessage("coc-writing: WordNet loaded");
    }
    if (config.get("dictionary.fuzzy.warmSpellingIndex", true)) {
      const delay = config.get(
        "dictionary.fuzzy.warmSpellingDelay",
        1e3
      );
      setTimeout(() => {
        warmSpellingIndex().catch((err) => {
          if (config.get("debug", false)) {
            import_coc4.window.showWarningMessage(
              `coc-writing: failed to warm spelling index: ${err}`
            );
          }
        });
      }, Math.max(0, delay));
    }
  }).catch((err) => {
    import_coc4.window.showErrorMessage(
      `coc-writing: failed to load WordNet data: ${err}`
    );
  });
  context.subscriptions.push(
    import_coc4.sources.createSource(
      createDictionarySource(
        dictionaryFiletypes.length > 0 ? dictionaryFiletypes : defaultFiletypes
      )
    ),
    import_coc4.sources.createSource(
      createThesaurusSource(
        thesaurusFiletypes.length > 0 ? thesaurusFiletypes : defaultFiletypes
      )
    ),
    import_coc4.listManager.registerList(new DictionaryList(nvim)),
    import_coc4.listManager.registerList(new ThesaurusList(nvim)),
    import_coc4.commands.registerCommand("coc-writing.searchDictionary", async () => {
      if (!isLoaded()) {
        import_coc4.window.showWarningMessage(
          "coc-writing: WordNet index is still loading"
        );
        return;
      }
      const pos = await nvim.call("getpos", ["."]);
      const cursorLine = await nvim.call("getline", ["."]);
      const cursorWord = await nvim.call("expand", ["<cword>"]);
      const searchTerm = await nvim.call("input", [
        "Dictionary search: ",
        cursorWord
      ]);
      if (!searchTerm || searchTerm.trim().length < 2) return;
      const { words: lemmas, fuzzy } = getWordsWithFuzzyPrefix(
        searchTerm.trim(),
        50
      );
      if (lemmas.length === 0) {
        import_coc4.window.showWarningMessage(
          `coc-writing: no words found for "${searchTerm}"`
        );
        return;
      }
      const labels = lemmas.map((lemma) => {
        const display = formatWordForDisplay(lemma);
        const gloss = getFirstGloss(lemma);
        const prefix = fuzzy ? "~" : "";
        return gloss ? `${prefix}${display} \u2014 ${gloss.slice(0, 70)}` : `${prefix}${display}`;
      });
      const idx = await import_coc4.window.showQuickpick(
        labels,
        `Dictionary: "${searchTerm.trim()}"`
      );
      if (idx < 0) return;
      const replacement = formatWordForDisplay(lemmas[idx]);
      const col = pos[2] - 1;
      const re = /[A-Za-z][A-Za-z'_-]*/g;
      let start = -1, end = -1;
      let match;
      while ((match = re.exec(cursorLine)) !== null) {
        if (col >= match.index && col <= match.index + match[0].length) {
          start = match.index;
          end = match.index + match[0].length;
          break;
        }
      }
      if (start >= 0) {
        const newLine = cursorLine.slice(0, start) + replacement + cursorLine.slice(end);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], start + replacement.length + 1]);
      } else {
        const newLine = cursorLine.slice(0, col) + replacement + cursorLine.slice(col);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], col + replacement.length + 1]);
      }
    }),
    // Thesaurus uses showQuickpick — avoids CocList arg-passing issues entirely.
    // Same approach as the definition command: do the work directly, show a UI.
    import_coc4.commands.registerCommand("coc-writing.searchThesaurus", async () => {
      if (!isLoaded()) {
        import_coc4.window.showWarningMessage(
          "coc-writing: WordNet index is still loading"
        );
        return;
      }
      const word = await nvim.call("expand", ["<cword>"]);
      if (!word) {
        import_coc4.window.showWarningMessage("coc-writing: cursor is not on a word");
        return;
      }
      if (lookupWord(word).length === 0) {
        import_coc4.window.showWarningMessage(
          `coc-writing: "${word}" not found in WordNet`
        );
        return;
      }
      const cfg = import_coc4.workspace.getConfiguration("coc-writing");
      const simPointers = getThesaurusSimilarityPointers(cfg);
      const depth = cfg.get("thesaurus.similarityDepth", 2);
      const synonymMap = collectSynonymsForWord(word, simPointers, depth, 100);
      if (synonymMap.size === 0) {
        import_coc4.window.showWarningMessage(
          `coc-writing: no synonyms found for "${word}" \u2014 try adding "@" or "~" to thesaurus.similarityPointers`
        );
        return;
      }
      const pos = await nvim.call("getpos", ["."]);
      const line = await nvim.call("getline", ["."]);
      const col = pos[2] - 1;
      const lemmaKeys = Array.from(synonymMap.keys());
      const labels = lemmaKeys.map((lemmaKey) => {
        const display = formatWordForDisplay(lemmaKey);
        const gloss = synonymMap.get(lemmaKey) ?? "";
        return gloss ? `${display} \u2014 ${gloss.slice(0, 70)}` : display;
      });
      const idx = await import_coc4.window.showQuickpick(labels, `Synonyms for "${word}"`);
      if (idx < 0) return;
      const replacement = formatWordForDisplay(lemmaKeys[idx]);
      const re = /[A-Za-z][A-Za-z'_-]*/g;
      let start = -1, end = -1;
      let match;
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
        const newLine = line.slice(0, col) + replacement + line.slice(col);
        await nvim.call("setline", [pos[1], newLine]);
        await nvim.call("cursor", [pos[1], col + replacement.length + 1]);
      }
    }),
    import_coc4.commands.registerCommand("coc-writing.definition", async () => {
      if (!isLoaded()) {
        import_coc4.window.showWarningMessage(
          "coc-writing: WordNet index is still loading"
        );
        return;
      }
      const word = await nvim.call("expand", ["<cword>"]);
      if (!word) return;
      const cfg = import_coc4.workspace.getConfiguration("coc-writing");
      const defPointers = cfg.get("definitionPointers", [
        "!",
        "&",
        "^"
      ]);
      const maxSynsets = cfg.get("definitionMaxSynsets", 8);
      const definition = buildDefinitionText(word, defPointers, maxSynsets);
      if (!definition) {
        import_coc4.window.showWarningMessage(
          `coc-writing: no definition found for "${formatWordForDisplay(word)}"`
        );
        return;
      }
      await openPreviewBuffer(nvim, definition.split("\n"));
    }),
    import_coc4.commands.registerCommand("coc-writing.health", async () => {
      const cfg = import_coc4.workspace.getConfiguration("coc-writing");
      const stats = getWordNetStats();
      const fileStatus = stats.loaded ? getDataFileStatus() : {};
      const fileLines = Object.entries(fileStatus).map(
        ([f, ok]) => `  ${ok ? "\u2713" : "\u2717"} ${f}`
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
        ...stats.loaded ? fileLines : ["  (not yet loaded)"],
        "",
        "## Sources",
        `dictionary:       ${cfg.get("dictionary.enable", true) ? "enabled" : "disabled"}`,
        `thesaurus:        ${cfg.get("thesaurus.enable", false) ? "enabled" : "disabled (default)"}`,
        "",
        "## Config",
        `filetypes:        ${cfg.get("filetypes", []).join(", ")}`,
        `dict filetypes:   ${cfg.get("dictionary.filetypes", []).join(", ") || "(inherit)"}`,
        `thes filetypes:   ${cfg.get("thesaurus.filetypes", []).join(", ") || "(inherit)"}`,
        `minInputLength:   ${cfg.get("dictionary.minInputLength", 3)}`,
        `maxItems:         dict=${cfg.get("dictionary.maxItems", 50)}, thes=${cfg.get("thesaurus.maxItems", 50)}`,
        `priority:         dict=${cfg.get("dictionary.priority", 20)}, thes=${cfg.get("thesaurus.priority", 30)}`,
        `definitionPointers: ${cfg.get("definitionPointers", ["!", "&", "^"]).join(" ")}`,
        `definitionMaxSynsets: ${cfg.get("definitionMaxSynsets", 8)}`,
        `thesaurusMode:    ${cfg.get("thesaurus.mode", "custom")}`,
        `similarityPointers: ${getThesaurusSimilarityPointers(cfg).join(" ")}`
      ];
      await openPreviewBuffer(nvim, lines);
    }),
    import_coc4.commands.registerCommand("coc-writing.warmSpellingIndex", async () => {
      if (!isLoaded()) {
        import_coc4.window.showWarningMessage(
          "coc-writing: WordNet index is still loading"
        );
        return;
      }
      await warmSpellingIndex();
      import_coc4.window.showInformationMessage("coc-writing: spelling index warmed");
    })
  );
}
function deactivate() {
  closeWordNet();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
