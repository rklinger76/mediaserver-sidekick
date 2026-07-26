import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditPlan, auditInternals } from '../src/services/audit.js';

test('normalizes movie folder names for audit matching', () => {
  assert.equal(auditInternals.normalizeName('Alien (1979)'), 'alien');
  assert.equal(auditInternals.normalizeName('The Matrix - 1999'), 'matrix');
});

test('finds movie folders missing from the selected media server library', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-audit-'));

  try {
    await mkdir(path.join(root, 'Example Movie (2024)'), { recursive: true });
    await mkdir(path.join(root, 'Missing Movie (1985)'), { recursive: true });

    const plan = await createAuditPlan(
      {
        serverType: 'plex',
        libraryId: 'demo-movies',
        libraryType: 'movie',
        sourcePath: root
      },
      { plex: {}, emby: {}, jellyfin: {} }
    );

    assert.equal(plan.count, 2);
    assert.equal(plan.serverCount, 1);
    assert.equal(plan.matchedCount, 1);
    assert.equal(plan.missingCount, 1);
    assert.equal(plan.missing[0].name, 'Missing Movie (1985)');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
