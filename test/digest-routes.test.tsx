import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestStatus, NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';

function entry(
  job: string,
  status: DigestStatus = 'ok',
  extra: Partial<{ at: string; owner: string | null; error: string }> = {},
) {
  return { at: '2026-10-28T08:00:00+02:00', job, status, owner: 'ops', ...extra };
}

// Inspect table semantics, not JSX nesting or the placement of warning classes.
function dataRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)]
    .map(([row]) => row)
    .filter((row) => /<td\b/i.test(row) && !/<t[dh]\b[^>]*\bcolspan\s*=/i.test(row));
}

function cellTexts(row: string) {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map(([, cell]) => cell.replace(/<[^>]*>/g, '').trim());
}

function jobRow(html: string, job: string) {
  const matches = dataRows(html).filter((row) => cellTexts(row).includes(job));
  expect(matches).toHaveLength(1);
  return matches[0];
}

const warningClass = /\bclass\s*=\s*["'](?:[^"']*\s)?warn(?:\s[^"']*)?["']/i;

describe('digest routes', () => {
  let runsDir: string;
  let config: RigConfig;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
    config = {
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    };
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(entries: ReturnType<typeof entry>[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), entries.map((row) => JSON.stringify(row)).join('\n'));
  }

  async function requestNight(requestedNight = night) {
    const app = createApp(config);
    const htmlResponse = await app.request(`/digest/${requestedNight}`);
    const jsonResponse = await app.request(`/api/digest/${requestedNight}`);
    return { htmlResponse, jsonResponse };
  }

  it('serves HTML and the same sorted JSON jobs, preserving offsets and a null owner', async () => {
    const firstAt = '2026-10-28T08:30:00+02:00';
    const lastAt = '2026-10-28T07:00:00+00:00';
    writeNight([
      entry('zulu'),
      // File order and lexical timestamp order both disagree with chronological order.
      entry('alpha', 'ok', { at: lastAt, owner: null }),
      entry('alpha', 'retry', { at: firstAt, error: 'temporary outage' }),
    ]);

    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest).toEqual({
      rows: [
        {
          job: 'alpha', owner: null, runs: 2, retries: 1, failures: 0,
          lastStatus: 'ok', lastError: 'temporary outage', firstAt, lastAt,
        },
        {
          job: 'zulu', owner: 'ops', runs: 1, retries: 0, failures: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T08:00:00+02:00', lastAt: '2026-10-28T08:00:00+02:00',
        },
      ],
      badLines: 0,
    } satisfies NightDigest);

    const html = await htmlResponse.text();
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain(night);
    const jobs = digest.rows.map((row) => row.job);
    const rows = dataRows(html);
    expect(rows).toHaveLength(jobs.length);
    expect(rows.flatMap((row) => cellTexts(row).filter((text) => jobs.includes(text)))).toEqual(jobs);
    const alpha = jobRow(html, 'alpha');
    expect(cellTexts(alpha)).toContain('—');
    expect(alpha).toContain(firstAt);
    expect(alpha).toContain(lastAt);
  });

  it('returns HTML and JSON 404 for a missing night', async () => {
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(404);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.status).toBe(404);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    await expect(jsonResponse.json()).resolves.toBeTypeOf('object');
  });

  it('renders an empty night as "nothing ran" and returns an empty digest', async () => {
    writeNight([]);
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toContain('nothing ran');
    expect(dataRows(html)).toHaveLength(0);
    expect(await jsonResponse.json()).toEqual({ rows: [], badLines: 0 });
  });

  it('counts a malformed line without dropping the valid rows on either route', async () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      JSON.stringify(entry('zulu')),
      '{not valid JSON',
      JSON.stringify(entry('alpha')),
    ].join('\n'));
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual(['alpha', 'zulu']);
    const rows = dataRows(await htmlResponse.text());
    expect(rows).toHaveLength(2);
    expect(rows.flatMap((row) => cellTexts(row).filter((text) => ['alpha', 'zulu'].includes(text))))
      .toEqual(digest.rows.map((row) => row.job));
  });

  it.each([2, 3, 4])('marks %i retries as a warning exactly when the count is at least three', async (retries) => {
    writeNight(Array.from({ length: retries }, () => entry('retry-job', 'retry')));
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows[0].retries).toBe(retries);
    const row = jobRow(await htmlResponse.text(), 'retry-job');
    expect(warningClass.test(row)).toBe(retries >= 3);
  });

  it.each([false, true])('marks a failure even after recovery: %s', async (recovered) => {
    const entries = [entry('failed-job', 'fail', { error: 'connection lost' })];
    if (recovered) {
      entries.push(entry('failed-job', 'ok', { at: '2026-10-28T09:00:00+02:00' }));
    }
    writeNight(entries);
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows[0]).toMatchObject({
      failures: 1, retries: 0, runs: recovered ? 2 : 1,
      lastStatus: recovered ? 'ok' : 'fail', lastError: 'connection lost',
    });
    const row = jobRow(await htmlResponse.text(), 'failed-job');
    expect(row).toMatch(warningClass);
    expect(row).toContain('connection lost');
  });

  it('escapes job, owner and error HTML without emitting executable scripts', async () => {
    const job = '<script>jobAttack()</script>';
    const owner = '<script>ownerAttack()</script>';
    const error = '<script>errorAttack()</script>';
    writeNight([entry(job, 'fail', { owner, error })]);
    const { htmlResponse, jsonResponse } = await requestNight();
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const digest = await jsonResponse.json() as NightDigest;
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
    const html = await htmlResponse.text();
    for (const field of ['jobAttack()', 'ownerAttack()', 'errorAttack()']) {
      expect(html).toContain(`&lt;script&gt;${field}&lt;/script&gt;`);
    }
    expect(html).not.toMatch(/<script\b/i);
  });

  it.each(['not-a-night', '%2e%2e%2f2026-10-28'])('rejects an invalid night/path: %s', async (invalidNight) => {
    writeNight([entry('valid-job')]);
    const { htmlResponse, jsonResponse } = await requestNight(invalidNight);
    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');
    await expect(jsonResponse.json()).resolves.toBeTypeOf('object');
  });
});
