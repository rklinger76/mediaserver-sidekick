import assert from 'node:assert/strict';
import test from 'node:test';
import { embyAdapter } from '../src/sources/emby.js';
import { createExportPlan } from '../src/services/exporter.js';

const settings = {
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

test('lists Emby movie and show libraries', async () => {
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
    assert.deepEqual(await embyAdapter.listLibraries(settings), [
      { id: 'movies-id', name: 'Movies', type: 'movie' },
      { id: 'shows-id', name: 'Shows', type: 'show' }
    ]);
  } finally {
    restore();
  }
});

test('builds Emby movie artwork URLs and export targets', async () => {
  const restore = mockFetch(url => {
    assert.equal(url.searchParams.get('api_key'), 'secret-key');
    return {
      Items: [
        {
          Id: 'movie-1',
          Type: 'Movie',
          Name: 'Arrival',
          ProductionYear: 2016,
          Path: '/movies/Arrival (2016)/Arrival.mkv',
          ImageTags: { Primary: 'primary-tag' },
          BackdropImageTags: ['backdrop-tag']
        }
      ]
    };
  });

  try {
    const plan = await createExportPlan(
      {
        serverType: 'emby',
        libraryId: 'movies-id',
        libraryType: 'movie',
        artworkKinds: ['poster', 'background'],
        useKometaAssetNames: true,
        exportPath: '/tmp/sidekick'
      },
      { emby: settings, export: { defaultPath: '/tmp/sidekick' } }
    );

    assert.deepEqual(plan.files.map(file => file.target), [
      '/tmp/sidekick/Arrival (2016)/poster.jpg',
      '/tmp/sidekick/Arrival (2016)/background.jpg'
    ]);
    assert.match(plan.files[0].source, /\/Items\/movie-1\/Images\/Primary/);
    assert.match(plan.files[1].source, /\/Items\/movie-1\/Images\/Backdrop\/0/);
  } finally {
    restore();
  }
});

test('adds Emby season posters for show libraries', async () => {
  const restore = mockFetch(url => {
    if (url.pathname === '/Shows/show-1/Seasons') {
      return {
        Items: [
          { Id: 'season-1', IndexNumber: 1, ImageTags: { Primary: 'season-tag' } }
        ]
      };
    }

    return {
      Items: [
        {
          Id: 'show-1',
          Type: 'Series',
          Name: 'Severance',
          ProductionYear: 2022,
          Path: '/shows/Severance (2022)',
          ImageTags: { Primary: 'primary-tag' },
          BackdropImageTags: ['backdrop-tag']
        }
      ]
    };
  });

  try {
    const plan = await createExportPlan(
      {
        serverType: 'emby',
        libraryId: 'shows-id',
        libraryType: 'show',
        artworkKinds: ['poster', 'background', 'seasonPoster'],
        useKometaAssetNames: false,
        exportPath: '/tmp/sidekick'
      },
      { emby: settings, export: { defaultPath: '/tmp/sidekick' } }
    );

    assert.deepEqual(plan.files.map(file => file.target), [
      '/tmp/sidekick/Severance (2022)/poster.jpg',
      '/tmp/sidekick/Severance (2022)/fanart.jpg',
      '/tmp/sidekick/Severance (2022)/Season01.jpg'
    ]);
  } finally {
    restore();
  }
});
