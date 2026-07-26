import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditPlan, auditInternals } from '../src/services/audit.js';

const embySettings = {
  url: 'http://emby.local:8096',
  apiKey: 'secret-key'
};

function mockFetch(handler) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const payload = handler(new URL(String(url)));
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      }
    };
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

test('normalizes movie folder names for audit matching', () => {
  assert.equal(auditInternals.normalizeName('Alien (1979)'), 'alien 1979');
  assert.equal(auditInternals.normalizeName('The Matrix - 1999'), 'matrix 1999');
  assert.equal(auditInternals.normalizeLooseName('Alien (1979)'), 'alien');
  assert.equal(auditInternals.normalizeLooseName('The Matrix - 1999'), 'matrix');
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
    assert.equal(plan.serverOnlyCount, 0);
    assert.equal(plan.missing[0].name, 'Missing Movie (1985)');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('matches Emby localized movie titles against original-title folders', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-audit-'));
  const restoreFetch = mockFetch(url => {
    assert.equal(url.pathname, '/Items');
    assert.equal(url.searchParams.get('Fields'), 'Path,ProductionYear,ProviderIds,OriginalTitle,SortName');
    return {
      Items: [
        {
          Type: 'Movie',
          Name: 'Chicken Run - Hennen rennen',
          OriginalTitle: 'Chicken Run',
          SortName: 'Chicken Run',
          ProductionYear: 2000
        }
      ]
    };
  });

  try {
    await mkdir(path.join(root, 'Chicken Run (2000)'), { recursive: true });

    const plan = await createAuditPlan(
      {
        serverType: 'emby',
        libraryId: 'movies-id',
        libraryType: 'movie',
        sourcePath: root
      },
      { emby: embySettings }
    );

    assert.equal(plan.count, 1);
    assert.equal(plan.serverCount, 1);
    assert.equal(plan.rawServerCount, 1);
    assert.equal(plan.matchedCount, 1);
    assert.equal(plan.missingCount, 0);
    assert.equal(plan.serverOnlyCount, 0);
  } finally {
    restoreFetch();
    await rm(root, { recursive: true, force: true });
  }
});

test('deduplicates repeated Emby API movie entries before audit counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sidekick-audit-'));
  const restoreFetch = mockFetch(() => ({
    Items: [
      {
        Type: 'Movie',
        Name: 'Arrival',
        OriginalTitle: 'Arrival',
        SortName: 'Arrival',
        ProductionYear: 2016,
        Path: '/movies/Arrival (2016)/Arrival.mkv'
      },
      {
        Type: 'Movie',
        Name: 'Arrival',
        OriginalTitle: 'Arrival',
        SortName: 'Arrival',
        ProductionYear: 2016,
        Path: '/movies/Arrival (2016)/Arrival - 4K.mkv'
      }
    ]
  }));

  try {
    await mkdir(path.join(root, 'Arrival (2016)'), { recursive: true });

    const plan = await createAuditPlan(
      {
        serverType: 'emby',
        libraryId: 'movies-id',
        libraryType: 'movie',
        sourcePath: root
      },
      { emby: embySettings }
    );

    assert.equal(plan.count, 1);
    assert.equal(plan.rawServerCount, 2);
    assert.equal(plan.serverCount, 1);
    assert.equal(plan.matchedCount, 1);
    assert.equal(plan.serverOnlyCount, 0);
  } finally {
    restoreFetch();
    await rm(root, { recursive: true, force: true });
  }
});
