import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightSummaries: Record<string, { ok: number; retry: number; fail: number } | null>;
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightSummaries: Object.fromEntries(nights.map((night) => {
      const digest = readNight(config.runsDir, night);
      const counts = digest?.rows.reduce((total, row) => ({
        ok: total.ok + row.runs - row.retries - row.failures,
        retry: total.retry + row.retries,
        fail: total.fail + row.failures,
      }), { ok: 0, retry: 0, fail: 0 }) ?? null;
      return [night, counts];
    })),
  };
}
