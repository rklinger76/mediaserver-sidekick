import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkFileName, targetRelativePath } from '../src/services/naming.js';
import { createExportPlan } from '../src/services/exporter.js';

const item = {
  title: 'The Expanse (2015) {tvdb-280619}',
  assetName: 'The Expanse (2015) {tvdb-280619}'
};

test('builds movie artwork names with movie title and year', () => {
  assert.equal(
    artworkFileName({ ...item, type: 'movie' }, { kind: 'poster', extension: '.png' }),
    'The Expanse (2015) {tvdb-280619}/The Expanse (2015) {tvdb-280619}-poster.png'
  );
  assert.equal(
    artworkFileName({ ...item, type: 'movie' }, { kind: 'background', extension: '.png' }),
    'The Expanse (2015) {tvdb-280619}/The Expanse (2015) {tvdb-280619}-fanart.png'
  );
});

test('builds Kometa asset names for movies when requested', () => {
  assert.equal(
    artworkFileName(
      { ...item, type: 'movie' },
      { kind: 'poster', extension: '.jpg' },
      { useKometaAssetNames: true }
    ),
    'The Expanse (2015) {tvdb-280619}/poster.jpg'
  );
  assert.equal(
    artworkFileName(
      { ...item, type: 'movie' },
      { kind: 'background', extension: '.jpg' },
      { useKometaAssetNames: true }
    ),
    'The Expanse (2015) {tvdb-280619}/background.jpg'
  );
});

test('builds series artwork names in the series folder', () => {
  assert.equal(
    artworkFileName({ ...item, type: 'show' }, { kind: 'poster', extension: '.jpg' }),
    'The Expanse (2015) {tvdb-280619}/poster.jpg'
  );
  assert.equal(
    artworkFileName({ ...item, type: 'show' }, { kind: 'background', extension: '.jpg' }),
    'The Expanse (2015) {tvdb-280619}/fanart.jpg'
  );
  assert.equal(
    artworkFileName({ ...item, type: 'show' }, { kind: 'seasonPoster', seasonNumber: 1, extension: '.jpg' }),
    'The Expanse (2015) {tvdb-280619}/Season01.jpg'
  );
});

test('uses background for series fanart when Kometa asset names are requested', () => {
  assert.equal(
    artworkFileName(
      { ...item, type: 'show' },
      { kind: 'background', extension: '.jpg' },
      { useKometaAssetNames: true }
    ),
    'The Expanse (2015) {tvdb-280619}/background.jpg'
  );
});

test('uses the source folder as target folder', () => {
  assert.equal(
    targetRelativePath(
      { title: 'Display Title', assetName: 'Kometa Asset Name', sourceFolderName: 'Original Source Folder' },
      { kind: 'background', originalName: 'fanart.jpg' },
      {}
    ),
    'Original Source Folder/fanart.jpg'
  );
});

test('filters selected artwork kinds in export plans', async () => {
  const plan = await createExportPlan(
    {
      serverType: 'plex',
      libraryId: 'demo-shows',
      libraryType: 'show',
      artworkKinds: ['poster', 'seasonPoster'],
      exportPath: '/tmp/sidekick'
    },
    {
      plex: {},
      export: { defaultPath: '/tmp/sidekick' }
    }
  );

  assert.deepEqual(plan.files.map(file => file.artwork), ['poster', 'seasonPoster']);
});
