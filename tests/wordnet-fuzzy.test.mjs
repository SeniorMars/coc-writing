import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);
const bundlePath = path.join(os.tmpdir(), "coc-writing-wordnet-test.cjs");

await esbuild.build({
  entryPoints: ["src/wordnet.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
});

const wordnet = require(bundlePath);

function makeTempWordNetIndex(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coc-writing-wordnet-"));
  fs.writeFileSync(path.join(dir, "index.noun"), entries.join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "index.verb"), "");
  fs.writeFileSync(path.join(dir, "index.adj"), "");
  fs.writeFileSync(path.join(dir, "index.adv"), "");
  return dir;
}

function assertTop(query, expected) {
  const result = wordnet.getWordsWithFuzzyPrefix(query, 10);
  assert.equal(result.fuzzy, true, `${query} should use fuzzy fallback`);
  assert.equal(result.words[0], expected, `${query} should rank ${expected} first`);
}

const syntheticDir = makeTempWordNetIndex([
  "fooble n 1 0 1 0 00000001",
  "foobly n 1 0 1 6 00000002",
]);

try {
  await wordnet.loadIndex(syntheticDir);
  assertTop("foobla", "foobly");
  assert.equal(wordnet.lookupWord("foobly")[0].tagSenseCount, 6);
} finally {
  wordnet.closeWordNet();
  fs.rmSync(syntheticDir, { recursive: true, force: true });
}

await wordnet.loadIndex("data");
let stats = wordnet.getWordNetStats();
assert.equal(stats.deleteIndexBuilt, false);
assert.equal(stats.deleteIndexSize, 0);
assert.deepEqual(wordnet.getSpellingSuggestions("definately", 10), []);
assert.equal(wordnet.getWordNetStats().deleteIndexBuilt, false);

await wordnet.warmSpellingIndex();
stats = wordnet.getWordNetStats();
assert.equal(stats.deleteIndexBuilt, true);
assert.ok(stats.deleteIndexSize > 0);

assertTop("definately", "definitely");
assertTop("recieve", "receive");
assertTop("accomod", "accommodate");

const sincers = wordnet.getWordsWithFuzzyPrefix("sincers", 10);
assert.equal(sincers.fuzzy, true);
assert.equal(sincers.words[0], "sincere");
assert.ok(sincers.words.slice(0, 3).includes("sincerely"));

const sincerl = wordnet.getWordsWithFuzzyPrefix("sincerl", 10);
assert.equal(sincerl.fuzzy, true);
assert.equal(sincerl.words[0], "sincere");
assert.ok(!sincerl.words.includes("sinclair"));

const firstLetterTypo = wordnet.getWordsWithFuzzyPrefix("xincere", 10);
assert.equal(firstLetterTypo.fuzzy, true);
assert.equal(firstLetterTypo.words[0], "sincere");

const shortFirstLetterTypo = wordnet.getWordsWithFuzzyPrefix("xinc", 10);
assert.ok(!shortFirstLetterTypo.words.includes("sincere"));

const exact = wordnet.getWordsWithFuzzyPrefix("sincer", 10);
assert.equal(exact.fuzzy, false);
assert.deepEqual(exact.words.slice(0, 2), ["sincere", "sincerely"]);

const cacheBefore = wordnet.getWordNetStats().fuzzyPrefixCacheSize;
wordnet.getFuzzyPrefixSuggestions("sincerl", 10);
const cacheAfterFirst = wordnet.getWordNetStats().fuzzyPrefixCacheSize;
wordnet.getFuzzyPrefixSuggestions("sincerl", 10);
const cacheAfterSecond = wordnet.getWordNetStats().fuzzyPrefixCacheSize;
assert.equal(cacheAfterFirst, cacheBefore);
assert.equal(cacheAfterSecond, cacheAfterFirst);

const definition = wordnet.buildDefinitionText("sincere", ["!", "&", "^"], 2);
assert.ok(definition.startsWith("## sincere"));
assert.match(definition, /\*\*\[adj\.\]\*\*/);
assert.match(definition, /- \*\*Antonym:\*\*/);

wordnet.closeWordNet();
