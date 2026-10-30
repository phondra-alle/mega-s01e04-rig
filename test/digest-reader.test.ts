import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const valid = {
  at: '2026-10-28T23:00:00+01:00',
  job: 'job',
  status: 'ok',
  owner: 'rook',
};
const directories: string[] = [];

function fixture(content: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'digest-reader-'));
  directories.push(directory);
  writeFileSync(join(directory, `${night}.jsonl`), content);
  return directory;
}

function jsonl(entries: unknown[]): string {
  return entries.map(entry => JSON.stringify(entry)).join('\n');
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('readNight', () => {
  it('reads the real night without modifying it', () => {
    const digest = readNight('runs', night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows.map(row => [row.runs, row.retries, row.failures])).toEqual([
      [1, 0, 0], [4, 3, 0], [8, 1, 0], [1, 0, 1], [1, 0, 0],
    ]);
    expect(digest?.rows[0].owner).toBeNull();
    expect(digest?.rows[1]).toMatchObject({
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts malformed JSON and invalid fields without throwing', () => {
    const invalid: unknown[] = [
      null, [], true, 42, 'text', {},
      { ...valid, at: null },
      { ...valid, at: 'not-a-date' },
      { ...valid, at: '2026-02-30T12:00:00Z' },
      { ...valid, at: '2026-10-28' },
      { ...valid, job: 4 },
      { ...valid, job: ' ' },
      { ...valid, status: 'unknown' },
      { ...valid, owner: undefined },
      { ...valid, owner: 4 },
      { ...valid, error: null },
      { ...valid, error: {} },
    ];
    const directory = fixture(`${jsonl([...invalid, valid])}\n{broken\n`);
    expect(readNight(directory, night)).toMatchObject({
      badLines: invalid.length + 1,
      rows: [{ job: 'job', runs: 1 }],
    });
  });

  it('distinguishes missing, empty, terminal separators and blank records', () => {
    const directory = fixture('');
    expect(readNight(directory, '2026-10-29')).toBeNull();
    expect(readNight(directory, night)).toEqual({ rows: [], badLines: 0 });
    for (const ending of ['', '\n', '\r\n']) {
      writeFileSync(join(directory, `${night}.jsonl`), JSON.stringify(valid) + ending);
      expect(readNight(directory, night)).toMatchObject({ badLines: 0, rows: [{ runs: 1 }] });
    }
    writeFileSync(join(directory, `${night}.jsonl`), `${jsonl([valid])}\n\n`);
    expect(readNight(directory, night)?.badLines).toBe(1);
    writeFileSync(join(directory, `${night}.jsonl`), '\n');
    expect(readNight(directory, night)).toEqual({ rows: [], badLines: 1 });
  });

  it('uses instants for unsorted first/last/status/owner and preserves offsets', () => {
    const directory = fixture(jsonl([
      { ...valid, at: '2026-10-28T22:00:00Z', owner: null },
      { ...valid, at: '2026-10-28T23:30:00+02:00', status: 'fail', error: 'earlier' },
      { ...valid, at: '2026-10-28T19:00:00-02:00', status: 'retry', error: 'first' },
    ]));
    expect(readNight(directory, night)).toEqual({
      badLines: 0,
      rows: [{
        job: 'job', owner: null, runs: 3, retries: 1, failures: 1,
        lastStatus: 'ok', lastError: 'earlier',
        firstAt: '2026-10-28T19:00:00-02:00', lastAt: '2026-10-28T22:00:00Z',
      }],
    });
  });

  it('retains the chronologically last nonempty error after recovery', () => {
    const directory = fixture(jsonl([
      { ...valid, at: '2026-10-28T23:05:00+01:00' },
      { ...valid, at: '2026-10-28T23:02:00+01:00', status: 'retry', error: 'last error' },
      { ...valid, at: '2026-10-28T23:04:00+01:00', error: '  ' },
      { ...valid, at: '2026-10-28T23:01:00+01:00', status: 'fail', error: 'old error' },
      { ...valid, at: '2026-10-28T23:03:00+01:00', error: '' },
    ]));
    expect(readNight(directory, night)?.rows[0]).toMatchObject({
      runs: 5, retries: 1, failures: 1, lastStatus: 'ok', lastError: 'last error',
    });
  });

  it('rejects invalid night paths before reading a file', () => {
    const directory = fixture(jsonl([valid]));
    for (const invalid of [
      '../2026-10-28', `${directory}/${night}`, '2026-10-28/../2026-10-28',
      '2026-10-28.jsonl', '2026-1-28', '2026-10-28\n', '2026-02-30', '2026-13-01',
      '2026-10-28\0', '..\\2026-10-28',
    ]) {
      expect(readNight(directory, invalid)).toBeNull();
    }
  });

  it('propagates unexpected filesystem errors rather than reporting an empty night', () => {
    const directory = fixture('');
    mkdirSync(join(directory, 'nested'));
    mkdirSync(join(directory, 'nested', `${night}.jsonl`));
    expect(() => readNight(join(directory, 'nested'), night)).toThrow();
    expect(() => readNight(join(directory, `${night}.jsonl`), night)).toThrow();
  });
});
