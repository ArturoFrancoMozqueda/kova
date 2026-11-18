# Private picomatch security backport — review evidence

This is a locally reviewed, private backport for GHSA-fc5q-39xc-vjpf / CVE-2026-112366. It is **not an upstream release, an upstream-approved fix, or advisory-database clearance**. Package names and versions are unchanged. The raw advisory continues to apply to those published versions; any remediation report must separately describe the verified backport rather than rewriting that result.

## Immutable provenance

Original packages were downloaded from the official npm registry and their tarball SHA-512 integrity values verified. The recipe lists every executable JavaScript file and package.json from each original package, with before/after SHA-256 digests. Only lib/parse.js changes. package.json, package names, versions, entry points, constants, other runtime files and MIT notices remain unchanged.

| npm version | Official npm metadata gitHead | Upstream tests passed / total |
|---|---|---|
| 2.3.2 | 81cba8d4b767cab3cb29d26eb4f691eed75b73b2 | 1970 / 1972 |
| 4.0.4 | e5474fc1a4d7991870058170407dda8a42be5334 | 1973 / 1975 |
| 4.0.7 | 6bb40679c218cefba5d4e9662408c5fdf699a8bb | 1981 / 1983 |

Security code was adapted from public, **unmerged** proposals, not taken as an assurance of correctness:

- [PR 262](https://github.com/micromatch/picomatch/pull/262), immutable commit `3222059ac27492d9c0147fee5c65f751bbd851ab`: parser-token classification and restricted wildcard normalizations. Unrelated unreleased globstar and bracket behavior changes were excluded.
- [PR 263](https://github.com/micromatch/picomatch/pull/263), immutable commit `9ca61909ab0ec680953e21bac80a6e825e1ede81`: corresponding v2 proposal, used for comparison and provenance.
- [PR 261](https://github.com/micromatch/picomatch/pull/261), immutable commit `b911986d9fb69c39ac203a1d08b7436057508058`: bounded ambiguity checker and the single-character alternative rewrite. The checker is embedded in parse.js, so no new runtime import is introduced.

The complete original MIT LICENSE is included separately for each version. The proposals belong to the same MIT-licensed repository; their original notices are retained. Review the corresponding vVERSION.patch files for the exact derivative changes.

## Security changes and compatibility decisions

1. Repeated wildcard bodies are classified from actual parser tokens, including bracket/options interactions. Restricted ordinary single-star bodies absorb redundant outer repetition; the tested alternative and two-star forms use restricted safe normalizations.
2. The ambiguity check runs on **every** remaining repeated body. It is not conditional on the raw syntax having a parenthesis or multiple branches. This closes brace-generated alternatives such as `+({a,aa})z`.
3. Neither `maxExtglobRecursion:false` nor a positive recursion allowance bypasses this check. Configured simple literal nesting can instead be normalized without nested unbounded quantifiers, preserving its positive matches.
4. Single-character alternatives become one character class. Repetition around a sole bounded literal-negation body is redundant and removed. A fully quoted, escape-free body is one fixed literal word; it is handled as such because quote token metadata differs from the final renderer.
5. A final check handles raw, counted and unescaped quantifiers applied around an already validated extglob. Unproven contexts are literalized, with leading negation flags reset to retain that narrow literal fallback.
6. In v2, text-token merging is corrected to retain the initial text prefix in the generated token output. This is the corresponding behavior already present in official v4.0.4 and is necessary for the security analysis to inspect the actual rendered source.

The bounded checker has explicit source, position and operation budgets. Unsupported or unproven shapes fail closed using the existing literalization mechanism. Its character model conservatively covers case folding, including Unicode long s and Kelvin-sign collisions.

These are finite executable checks and bounded conservative analysis, **not a formal proof for every possible JavaScript regular expression**. Arbitrary raw RegExp APIs and expressions without a repeated extglob are outside this advisory-specific backport. Unsupported complex/capture forms can be literalized; exact capture-array equivalence is not promised for rewritten unsafe shapes. Application build/tests and independent review remain necessary before deployment.

## Exact upstream exceptions — tests were not edited

The release tests were fetched at the gitHeads above. No original assertion, fixture, expected regex or test file was modified, skipped or removed. Each full upstream suite exits with exactly two failures:

- `options.maxExtglobRecursion should allow limited nested repeated extglobs when configured`
- `options.maxExtglobRecursion should disable the safeguard when maxExtglobRecursion is false`

Both live in `test/options.maxExtglobRecursion.js`. They explicitly require nested/ambiguous regex sources that the backport must no longer emit. Targeted independent positive tests verify configured simple nested repetition still matches correctly using safe output. We do **not** report these upstream suites as entirely green.

SHA-256 of that immutable upstream test file:

- v2.3.2 and v4.0.4: `e19d89d71069b11cf838518fa98c3245a06eb35d59b9f19c179f2e504cc80a9d`
- v4.0.7: `5f327500924b9c6563b1ddf3b48b17f65632ee14abdab9a49c29d80b77b1db2a`

Full counts, exception IDs, source commits, hashes and regression results are in upstream-evidence.json.

## Independent regression CLI and controls

`node frontend/scripts/security/picomatch-regressions.mjs /absolute/path/to/picomatch/package`

The CLI uses only Node standard libraries. Each matcher invocation runs in a separate subprocess with an empty environment, its own 128 MiB V8 old-space limit, a 2-second deadline, SIGKILL on timeout and bounded output. A failure returns exit 1 and a minimal JSON diagnostic without dumping environment data, credentials, authentication headers or application data.

Final results:

| Source | Result | Cases |
|---|---|---|
| Backported 2.3.2 | passed | 81 |
| Backported 4.0.4 | passed | 82 |
| Backported 4.0.7 | passed | 82 |
| Original npm 2.3.2 | failed as expected: leading-star / ETIMEDOUT | first attack control |
| Original npm 4.0.4 | failed as expected: leading-star / ETIMEDOUT | first attack control |
| Original npm 4.0.7 | failed as expected: leading-star / ETIMEDOUT | first attack control |

Cases include direct and nested repeated stars; overlapping multiword and @ alternatives; brace encodings; Unicode ignore-case collisions; `capture`, `bash`, `windows`, `dot`, `nocase`, explicit flags and `contains`; disabled recursion safeguards; raw/counting/unescaped outer quantifiers; matcher, makeRe, parse/compileRe, array and v4 posix entry points; ordinary file-extension patterns; restricted safe alternation; quoted/escaped stars; negation; and positive configured nesting.

The more restrictive alternative without the public bounded checker was also tested separately: it passed 1892/1983 v4.0.7 upstream cases and broke ordinary patterns including `foo/bar/**/*.+(js|jsx)` and numeric ranges. It was rejected as a material compatibility regression; it is not the recipe in this directory.

The replacement files are stored as `.js.txt` source assets and copied only after their hashes are verified. They are not imported by the application or scanned as repository-owned JavaScript. The root manifest adds the local review, expiry and regression-runner hash to the artifact recipe. Kova validation and installation integration are recorded in `docs/audits/PICOMATCH-2026-11-17.md`.
