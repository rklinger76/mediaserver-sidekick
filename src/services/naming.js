import path from 'node:path';

export function sanitizeAssetName(name) {
  const cleaned = String(name || 'Untitled')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '');

  return cleaned || 'Untitled';
}

export function artworkFileName(item, artwork, options = {}) {
  const extension = artwork.extension || '.jpg';
  const assetName = sanitizeAssetName(item.assetName || item.title);
  const folderName = sanitizeAssetName(item.sourceFolderName || item.assetName || item.title);

  if (item.type === 'movie') {
    if (options.useKometaAssetNames) {
      if (artwork.kind === 'poster') return path.join(folderName, `poster${extension}`);
      if (artwork.kind === 'background') return path.join(folderName, `background${extension}`);
    }
    if (artwork.kind === 'poster') return path.join(folderName, `${assetName}-poster${extension}`);
    if (artwork.kind === 'background') return path.join(folderName, `${assetName}-fanart${extension}`);
  }

  if (artwork.kind === 'poster') return path.join(folderName, `poster${extension}`);
  if (artwork.kind === 'background') {
    return path.join(folderName, `${options.useKometaAssetNames ? 'background' : 'fanart'}${extension}`);
  }
  if (artwork.kind === 'seasonPoster') {
    return path.join(folderName, `Season${String(artwork.seasonNumber).padStart(2, '0')}${extension}`);
  }

  return path.join(folderName, `${artwork.kind}${extension}`);
}

export function targetRelativePath(item, artwork, options = {}) {
  return artworkFileName(item, artwork, options);
}
