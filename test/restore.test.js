import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestorePlan, runRestore } from '../src/services/restore.js';

test('plans restore jobs without overwriting existing files by default', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-restore-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');

  await mkdir(path.join(source, 'Movies', 'Alien (1979)'), { recursive: true });
  await mkdir(path.join(target, 'Movies', 'Alien (1979)'), { recursive: true });
  await writeFile(path.join(source, 'Movies', 'Alien (1979)', 'poster.jpg'), 'new poster');
  await writeFile(path.join(source, 'Movies', 'Alien (1979)', 'background.jpg'), 'new background');
  await writeFile(path.join(target, 'Movies', 'Alien (1979)', 'poster.jpg'), 'existing poster');

  const plan = await createRestorePlan({ sourcePath: source, targetPath: target });

  assert.equal(plan.summary.restore, 1);
  assert.equal(plan.summary.skip, 1);

  const result = await runRestore({ sourcePath: source, targetPath: target });
  assert.equal(result.restored, 1);
  assert.equal(await readFile(path.join(target, 'Movies', 'Alien (1979)', 'poster.jpg'), 'utf8'), 'existing poster');
  assert.equal(await readFile(path.join(target, 'Movies', 'Alien (1979)', 'background.jpg'), 'utf8'), 'new background');

  await rm(root, { recursive: true, force: true });
});
