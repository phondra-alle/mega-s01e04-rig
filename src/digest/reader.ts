import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type Entry = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
};

function isNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(entry.at) &&
    isNight(entry.at.slice(0, 10)) &&
    Number.isFinite(Date.parse(entry.at)) &&
    typeof entry.job === 'string' && entry.job.trim().length > 0 &&
    (entry.status === 'ok' || entry.status === 'retry' || entry.status === 'fail') &&
    (typeof entry.owner === 'string' || entry.owner === null) &&
    (entry.error === undefined || typeof entry.error === 'string')
  );
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!isNight(night)) return null;

  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const lines = content.split(/\r?\n/);
  // The separator after the final record is not itself a record.
  if (lines.at(-1) === '') lines.pop();
  const entries: Entry[] = [];
  let badLines = 0;
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (isEntry(value)) entries.push(value);
    else badLines++;
  }

  entries.sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  const rows = new Map<string, DigestRow>();
  for (const entry of entries) {
    let row = rows.get(entry.job);
    if (!row) {
      row = {
        job: entry.job,
        owner: entry.owner,
        runs: 0,
        retries: 0,
        failures: 0,
        lastStatus: entry.status,
        lastError: null,
        firstAt: entry.at,
        lastAt: entry.at,
      };
      rows.set(entry.job, row);
    }
    row.runs++;
    if (entry.status === 'retry') row.retries++;
    if (entry.status === 'fail') row.failures++;
    row.owner = entry.owner;
    row.lastStatus = entry.status;
    row.lastAt = entry.at;
    if (entry.error?.trim()) row.lastError = entry.error;
  }

  return {
    rows: [...rows.values()].sort((left, right) =>
      left.job < right.job ? -1 : left.job > right.job ? 1 : 0),
    badLines,
  };
};
