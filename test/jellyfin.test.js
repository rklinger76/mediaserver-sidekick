import assert from 'node:assert/strict';
import test from 'node:test';
import { jellyfinAdapter } from '../src/sources/jellyfin.js';
import { createExportPlan } from '../src/services/exporter.js';

const settings = {
  url: 'http://jellyfin.local:8096',
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

test('lists Jellyfin movie and show libraries', async () => {
  const restore = mockFetch(url => {
    assert.equal(url.pathname, '/Library/VirtualFolders');
    assert.equal(url.searchParams.get('api_key'), 'secret-key');
    return [
      { ItemId: 'movies-id', Name: 'Movies', CollectionType: 'movies' },
      { ItemId: 'shows-id', Name: 'Shows', CollectionType: 'tvshows' },
      { ItemId: 'music-id', Name: 'Music', CollectionType: 'music' }
    ];
  });

  try {
    assert.deepEqual(await jellyfinAdapter.listLibraries(settings), [
      { id: 'movies-id', name: 'Movies', type: 'movie' },
      { id: 'shows-id', name: 'Shows', type: 'show' }
    ]);
  } finally {
    restore();
  }
});

test('builds Jellyfin movie artwork URLs and export targets', async () => {
  const restore = mockFetch(url => {
    assert.equal(url.searchParams.get('api_key'), 'secret-key');
    return {
      Items: [
        {
          Id: 'movie-1',
          Type: 'Movie',
          Name: 'Dune',
          ProductionYear: 2021,
          Path: '/movies/Dune (2021)/Dune.mkv',
          ImageTags: { Primary: 'primary-tag' },
          BackdropImageTags: ['backdrop-tag']
        }
      ]
    };
  });

  try {
    const plan = await createExportPlan(
      {
        serverType: 'jellyfin',
        libraryId: 'movies-id',
        libraryType: 'movie',
        artworkKinds: ['poster', 'background'],
        useKometaAssetNames: false,
        exportPath: '/tmp/sidekick'
      },
      { jellyfin: settings, export: { defaultPath: '/tmp/sidekick' } }
    );

    assert.deepEqual(plan.files.map(file => file.target), [
      '/tmp/sidekick/Dune (2021)/Dune (2021)-poster.jpg',
      '/tmp/sidekick/Dune (2021)/Dune (2021)-fanart.jpg'
    ]);
    assert.match(plan.files[0].source, /\/Items\/movie-1\/Images\/Primary/);
    assert.match(plan.files[1].source, /\/Items\/movie-1\/Images\/Backdrop\/0/);
  } finally {
    restore();
  }
});

test('adds Jellyfin season posters for show libraries', async () => {
  const restore = mockFetch(url => {
    if (url.pathname === '/Shows/show-1/Seasons') {
      return {
        Items: [
          { Id: 'season-0', IndexNumber: 0, ImageTags: { Primary: 'specials-tag' } },
          { Id: 'season-1', IndexNumber: 1, ImageTags: { Primary: 'season-tag' } }
        ]
      };
    }

    return {
      Items: [
        {
          Id: 'show-1',
          Type: 'Series',
          Name: 'Silo',
          ProductionYear: 2023,
          Path: '/shows/Silo (2023)',
          ImageTags: { Primary: 'primary-tag' },
          BackdropImageTags: ['backdrop-tag']
        }
      ]
    };
  });

  try {
    const plan = await createExportPlan(
      {
        serverType: 'jellyfin',
        libraryId: 'shows-id',
        libraryType: 'show',
        artworkKinds: ['poster', 'background', 'seasonPoster'],
        useKometaAssetNames: true,
        exportPath: '/tmp/sidekick'
      },
      { jellyfin: settings, export: { defaultPath: '/tmp/sidekick' } }
    );

    assert.deepEqual(plan.files.map(file => file.target), [
      '/tmp/sidekick/Silo (2023)/poster.jpg',
      '/tmp/sidekick/Silo (2023)/background.jpg',
      '/tmp/sidekick/Silo (2023)/Season00.jpg',
      '/tmp/sidekick/Silo (2023)/Season01.jpg'
    ]);
  } finally {
    restore();
  }
});
