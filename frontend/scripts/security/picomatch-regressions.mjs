import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The matcher executes only in a killable subprocess. No inherited secrets,
// PATH, NODE_OPTIONS, session data or network configuration reach that worker.
const child = String.raw`
'use strict';
const assert = require('node:assert/strict');
const [directory, encoded] = process.argv.slice(1);
const item = JSON.parse(encoded);
const pm = require(directory);
const subject = item.repeat ? item.unit.repeat(item.repeat) + item.tail : item.subject;
let result;
if (item.entry === 'makeRe') result = pm.makeRe(item.pattern, item.options).test(subject);
else if (item.entry === 'parse') result = pm.compileRe(pm.parse(item.pattern, item.options), item.options).test(subject);
else if (item.entry === 'posix') result = require(directory + '/posix.js')(item.pattern, item.options)(subject);
else if (item.entry === 'array') result = pm([item.pattern], item.options)(subject);
else result = pm(item.pattern, item.options)(subject);
assert.equal(typeof result, 'boolean');
if (item.expected !== null) assert.equal(result, item.expected);
`;
const cases = [];
const add = (id, pattern, subject, expected, options = {}, entry = 'matcher') =>
  cases.push({ id, pattern, subject, expected, options, entry });
const attack = (id, pattern, options = {}, unit = 'a', count = 60000, tail = '!', entry = 'matcher', expected = false) =>
  cases.push({ id, pattern, options, unit, repeat: count, tail, expected, entry });

for (const [id, pattern] of [
  ['leading-star', '+(*a)'], ['star-star', '*(*a)'], ['bare-star', '+(*)z'],
  ['trailing-star', '+(a*)z'], ['alternative-star', '+(*a|b)z'],
  ['nested-at-star', '+(@(*a))z'], ['nested-at-prefix', '+(@(*)a)z'],
  ['many-stars', '+(a*a*a*a*a*)z'], ['star-alternative', '*(a*|b)z'],
  ['trailing-alternative', '+(a*|b)z'], ['word-overlap', '+(ab|abab)z'],
  ['word-overlap-long', '+(abc|abcabc)z'], ['nested-overlap', '+(@(a|aa))z'],
  ['nested-repeat-tail', '+(*(ab)c)z'], ['nested-plus', '+(+(a))z'],
  ['negated-body', '*(!(foo))z'], ['positive-negated-body', '+(!(f))z'],
]) attack(id, pattern, {}, id.startsWith('word-overlap') ? (id.endsWith('long') ? 'abc' : 'ab') : 'a');

for (const options of [
  { maxExtglobRecursion: false }, { maxExtglobRecursion: 1 },
  { capture: true }, { bash: true }, { windows: true }, { dot: true },
  { nocase: true }, { flags: 'i' }, { flags: 'iu' }, { contains: true },
]) {
  attack('option-leading-' + JSON.stringify(options), '+(*a)z', options);
  attack('option-overlap-' + JSON.stringify(options), '+(@(a|aa))z', options);
}
attack('brace-alternation', '+({a,aa})z');
attack('nested-brace-alternation', '+(@({a,aa}))z');
attack('brace-optout', '+({a,aa})z', { maxExtglobRecursion: false });
add('safe-brace-positive', '+({a,b})', 'abba', true);
attack('unicode-long-s', '+(s|ſs)z', { flags: 'iu' }, 's');
attack('unicode-kelvin', '+(k|Kk)z', { flags: 'iu' }, 'k');
attack('unmatched-bracket', '+([*a)z', {}, '[a');
attack('literal-bracket-option', '+([*a])z', { nobracket: true }, '[a]');
attack('raw-outer-plus', '(+(*a))+z');
attack('raw-outer-star', '(+(*a))*z', { regex: true });
attack('raw-counted-outer', '(+(*a)){2,}z', { nobrace: true });
attack('unescaped-outer', '(+(*a))\\+z', { unescape: true });
for (const entry of ['makeRe', 'parse', 'array']) {
  attack('entry-' + entry, '+(*a)z', { maxExtglobRecursion: false }, 'a', 60000, '!', entry);
}

for (const [id, pattern, subject, expected] of [
  ['js-file', '**/*.js', 'src/main.js', true],
  ['nested-js-file', 'foo/bar/**/*.+(js|jsx)', 'foo/bar/baz.jsx', true],
  ['non-js-file', '**/*.js', 'src/main.css', false],
  ['fixed-repeat', '+(abc)', 'abcabc', true],
  ['fixed-alternatives', '*(foo|bar)', 'foobar', true],
  ['prefix-safe', '*(fo|foo)', 'fofoofoofofoo', true],
  ['wildcard-repeat', '+(*a)', 'aaa', true],
  ['anchored-star', '+(a*b)', 'abab', true],
  ['simple-alternation', '*(a*|b)', 'ax', true],
  ['simple-alternation-more', '+(a*|b)', 'bbab', true],
  ['trailing-alt', '+(ab*|c)', 'ccabcc', true],
  ['repeated-negate', '*(!(foo))', 'bar', true],
  ['repeated-negate-exclude', '*(!(foo))', 'foo', false],
  ['positive-negate', '+(!(f))', 'fff', true],
  ['two-stars', '*/*(W*, *)*', 'my/folder (Work, Accts)', true],
  ['bracket-literal', '+([*])', '***', true],
  ['quoted-star', '+("*")', '***', true],
  ['escaped-star', '+(\\*)', '***', true],
  ['nested-delimiter', '*(f*(o))', 'fofoofoo', true],
  ['nested-fixed-choice', '+(@(foo|bar))', 'foobar', true],
]) add(id, pattern, subject, expected);
add('nocase-positive', '+(*A)', 'aaa', true, { nocase: true });
add('flags-positive', '+(*A)', 'aaa', true, { flags: 'i' });
add('safe-optout-positive', '+(abc)', 'abcabc', true, { maxExtglobRecursion: false });
add('configured-nested-plus', '+(+(a))', 'aaa', true, { maxExtglobRecursion: 1 });
add('configured-nested-star', '*(+(ab))', 'abab', true, { maxExtglobRecursion: false });
add('configured-nested-positive', '+(*(a))', 'aaa', true, { maxExtglobRecursion: false });
add('capture-positive', '+(abc)', 'abcabc', true, { capture: true });
add('literalized-overlap', '+(a|aa)', '+(a|aa)', true, { maxExtglobRecursion: false });
add('unicode-literalized', '+(s|ſs)', '+(s|ſs)', true, { flags: 'iu' });

let packageVersion;
try {
  const directory = resolve(process.argv[2] || '');
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (pkg.name !== 'picomatch' || !['2.3.2', '4.0.4', '4.0.7'].includes(pkg.version)) throw new Error('unsupported_package');
  packageVersion = pkg.version;
  // posix.js is present only in v4 releases.
  if (packageVersion.startsWith('4.')) attack('entry-posix', '+(*a)z', {}, 'a', 60000, '!', 'posix');
  for (const item of cases) {
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', child, directory, JSON.stringify(item)], {
      encoding: 'utf8', env: {}, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 16384,
    });
    if (result.error || result.status !== 0) {
      console.log(JSON.stringify({ status: 'failed', packageVersion, cases: cases.length,
        case: item.id, reason: result.error?.code || 'assertion_failed' }));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ status: 'passed', packageVersion, cases: cases.length }));
} catch {
  console.log(JSON.stringify({ status: 'failed', packageVersion, reason: 'invalid_package_or_runner' }));
  process.exit(1);
}
