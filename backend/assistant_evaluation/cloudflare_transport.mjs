// Evaluation only: cf has no raw-request command. Reuse its authenticated client
// without reading, returning, or serializing credentials. Pin the tested version;
// use the same chat endpoint as Kova, with an explicit deadline and no retries.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [packageRoot, account, inputPath] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(account ?? '')) process.exit(2);
const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
if (metadata.version !== '1.0.0-beta.18') process.exit(2);
const dist = path.join(packageRoot, 'dist');
const { n: authenticatedClient } = await import(
  pathToFileURL(path.join(dist, 'auth-Db1KT0vm.mjs')).href
);
if (typeof authenticatedClient !== 'function') process.exit(2);
if (inputPath === '--preflight') {
  process.stdout.write(JSON.stringify({ preflight: true }));
  process.exit(0);
}
try {
  const client = await authenticatedClient({ local: false });
  if (client.baseUrl !== 'https://api.cloudflare.com/client/v4') process.exit(2);
  const body = JSON.parse(await readFile(inputPath, 'utf8'));
  const result = await client.send({
    method: 'POST', path: () => `/accounts/${account}/ai/v1/chat/completions`,
    pathParams: [], body: 'json',
  }, { body }, { maxRetries: 0, timeoutInSeconds: 9 });
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  // Never print exception text, HTTP headers or response bodies.
  const status = Number.isInteger(error.statusCode) ? error.statusCode : null;
  const codes = Array.isArray(error.body?.errors)
    ? error.body.errors.map(item => item.code).filter(Number.isInteger) : [];
  // This harness sends synthetic inputs only. Keep a bounded diagnostic unless
  // it mentions authentication; never emit keys, URLs, headers or long strings.
  const messages = (error.body?.errors ?? []).map(item => String(item.message ?? ''));
  const detail = messages.some(message => /authorization|bearer|secret|cookie|token/i.test(message))
    ? 'provider_error_detail_redacted'
    : messages.join(' ').replace(/https?:\/\/\S+/g, '[url]')
      .replace(/[A-Za-z0-9_=-]{25,}/g, '[redacted]').slice(0, 400);
  process.stdout.write(JSON.stringify({ transport_error: true, status, codes, detail }));
  process.exitCode = 1;
}
