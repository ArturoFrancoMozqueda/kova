import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installProject } from './install.mjs';
import { loadManifest, sha256, verifyProject } from './picomatch.mjs';

test('dependency lifecycle runs only after a successful complete patch verification', () => {
  const calls = [];
  installProject('/project', {
    runNpm: args => calls.push(args), verify: (_, options) => { calls.push(options); return {}; },
  });
  assert.deepEqual(calls, [['ci', '--ignore-scripts'], { apply: true },
    ['rebuild', '--ignore-scripts=false', '--foreground-scripts'], { probe: true }]);
  for (const failure of [0, 1, 2, 3]) {
    let count = 0;
    const operation = () => { if (count++ === failure) throw new Error('blocked'); return {}; };
    assert.throws(() => installProject('/project', { runNpm: operation, verify: operation }), /blocked/);
    assert.equal(count, failure + 1);
  }
});

function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'kova-security-test-'));
  try {
    const source = join(root, 'source'); mkdirSync(source);
    const info = JSON.stringify({ name: 'picomatch', version: '4.0.7' });
    const original = 'module.exports = "original";';
    const patched = 'module.exports = "patched";';
    const manifest = {
      advisory: 'GHSA-fc5q-39xc-vjpf',
      review: { status: 'verified', owner: 'test', evidence: 'test', reviewedAt: '2026-11-17T00:00:00Z', expiresAt: '2026-11-24T00:00:00Z' },
      releases: { '4.0.7': { integrity: 'sha512-test', tarball: 'https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz',
        replacement: 'replacement.txt', files: { 'package.json': { before: sha256(info), after: sha256(info) },
          'lib/parse.js': { before: sha256(original), after: sha256(patched) } } } },
    };
    writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(source, 'replacement.txt'), patched);
    const copy = join(root, 'node_modules/picomatch'); mkdirSync(join(copy, 'lib'), { recursive: true });
    writeFileSync(join(copy, 'package.json'), info); writeFileSync(join(copy, 'lib/parse.js'), original);
    const lock = { lockfileVersion: 3, packages: { '': {}, 'node_modules/picomatch': {
      version: '4.0.7', integrity: 'sha512-test', resolved: manifest.releases['4.0.7'].tarball,
    } } };
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock));
    const review = loadManifest(source, Date.parse('2026-11-18T00:00:00Z'));
    action({ root, source, copy, manifest, lock, review, original, patched });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('exact patch applies once and preserves package identity', () => fixture(({ root, copy, review, patched }) => {
  assert.throws(() => verifyProject(root, { review }), /Unverified/);
  verifyProject(root, { apply: true, review });
  verifyProject(root, { apply: true, review });
  assert.equal(verifyProject(root, { review }).copies.length, 1);
  assert.equal(readFileSync(join(copy, 'lib/parse.js'), 'utf8'), patched);
  assert.equal(JSON.parse(readFileSync(join(copy, 'package.json'))).version, '4.0.7');
}));

test('tampering, extra executable files, identities and lock sources fail closed', () => {
  for (const mutate of [
    ({ copy }) => writeFileSync(join(copy, 'lib/parse.js'), 'tampered'),
    ({ copy }) => writeFileSync(join(copy, 'extra.cjs'), 'extra'),
    ({ copy }) => writeFileSync(join(copy, 'package.json'), JSON.stringify({ name: 'picomatch', version: '9.9.9' })),
    ({ root, lock }) => { lock.packages['node_modules/picomatch'].integrity = 'other'; writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock)); },
    ({ root }) => { mkdirSync(join(root, 'node_modules/other/node_modules/picomatch'), { recursive: true }); },
    ({ copy }) => { rmSync(copy, { recursive: true }); symlinkSync('/tmp', copy); },
  ]) fixture(data => { mutate(data); assert.throws(() => verifyProject(data.root, { apply: true, review: data.review })); });
});

test('review expiry, future review, missing evidence and overlong period fail closed', () => {
  for (const change of [
    { expiresAt: '2026-11-18T00:00:00Z' }, { reviewedAt: '2026-11-17T00:00:00' }, { reviewedAt: '2026-11-19T00:00:00Z' },
    { expiresAt: '2026-12-01T00:00:00Z' }, { evidence: '' }, { status: 'draft' },
  ]) fixture(({ source, manifest }) => {
    Object.assign(manifest.review, change);
    writeFileSync(join(source, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => loadManifest(source, Date.parse('2026-11-18T00:00:00Z')));
  });
});
