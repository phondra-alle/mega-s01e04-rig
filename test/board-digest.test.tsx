import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readStatus } from '../src/status.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};

describe('board digest links', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function writeNight(night: string, statuses: string[]) {
    const lines = statuses.map((status, index) => JSON.stringify({
      at: `2026-10-28T10:0${index}:00+01:00`,
      job: index < 3 ? 'first' : 'second',
      status,
      owner: null,
    }));
    writeFileSync(join(runsDir, `${night}.jsonl`), [...lines, '{bad json', '{}'].join('\n'));
  }

  it('keeps every night newest first and counts entries across jobs, including recovered failures', async () => {
    writeNight('2026-10-28', ['fail', 'retry', 'ok', 'retry', 'ok', 'ok']);
    writeNight('2026-10-29', []);
    writeFileSync(join(runsDir, '2026-10-30.jsonl'), '');
    writeFileSync(join(runsDir, 'ignore.txt'), '');
    const fullConfig = { ...config, runsDir };
    expect(readStatus(fullConfig).nights).toEqual(['2026-10-30', '2026-10-29', '2026-10-28']);

    const response = await createApp(fullConfig).request('/');
    const html = await response.text();
    expect(response.status).toBe(200);
    const items = html.match(/<li>.*?<\/li>/g) ?? [];
    expect(items).toHaveLength(3);
    for (const [index, night] of ['2026-10-30', '2026-10-29', '2026-10-28'].entries()) {
      expect(items[index]).toContain(`<a href="/digest/${night}">${night}</a>`);
    }
    expect(items[0]).toContain('ok 0 / retry 0 / fail 0');
    expect(items[1]).toContain('ok 0 / retry 0 / fail 0');
    expect(items[2]).toContain('ok 3 / retry 2 / fail 1');
    expect(html).toContain(config.adapter);
    expect(html).toContain(config.installed);
    expect(html).toContain('last beat');
  });

  it('links to digest pages that render for both nights', async () => {
    writeNight('2026-10-28', ['ok']);
    writeNight('2026-10-29', ['fail']);
    const app = createApp({ ...config, runsDir });
    const board = await app.request('/');
    const links = [...(await board.text()).matchAll(/href="(\/digest\/[^"]+)"/g)];
    expect(links).toHaveLength(2);
    for (const [, href] of links) {
      const response = await app.request(href);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('first');
    }
  });

  it('keeps the empty board message when no nights exist', async () => {
    const response = await createApp({ ...config, runsDir }).request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('nothing in runs/');
  });
});
