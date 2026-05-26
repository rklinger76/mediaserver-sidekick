const state = {
  settings: null,
  libraries: [],
  exportPoll: null,
  restorePoll: null,
  pathPickerTarget: null,
  pathPickerPath: '/'
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const savedSecretValue = '************';
const viewMeta = {
  export: {
    eyebrow: 'Artwork Export',
    title: 'Artwork sauber exportieren'
  },
  restore: {
    eyebrow: 'Asset Restore',
    title: 'Assets aus Backups wiederherstellen'
  },
  settings: {
    eyebrow: 'Docker & Unraid',
    title: 'Verbindungen und Pfade einstellen'
  }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function formToObject(form) {
  const data = new FormData(form);
  const result = {};

  for (const [key, value] of data.entries()) {
    const input = form.elements[key];
    if (input?.dataset?.savedSecret === 'true' && value === savedSecretValue) {
      continue;
    }
    const parts = key.split('.');
    let target = result;
    while (parts.length > 1) {
      const part = parts.shift();
      target[part] ||= {};
      target = target[part];
    }
    target[parts[0]] = value;
  }

  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
    const parts = checkbox.name.split('.');
    let target = result;
    while (parts.length > 1) {
      const part = parts.shift();
      target[part] ||= {};
      target = target[part];
    }
    target[parts[0]] = checkbox.checked;
  }

  return result;
}

function fillSettings(settings) {
  state.settings = settings;
  $('[name="exportPath"]').placeholder = settings.export.defaultPath;
  $('[name="targetPath"]').placeholder = settings.export.defaultPath;
  $('[name="export.defaultPath"]').value = settings.export.defaultPath;

  for (const server of ['plex', 'emby', 'jellyfin']) {
    $(`[name="${server}.url"]`).value = settings[server].url || '';
    $(`#${server}-secret`).textContent = settings.secretsSaved[server] ? 'Gespeichert' : 'Nicht gespeichert';
  }

  setSecretField('plex.token', settings.secretsSaved.plex);
  setSecretField('emby.apiKey', settings.secretsSaved.emby);
  setSecretField('jellyfin.apiKey', settings.secretsSaved.jellyfin);
}

function setViewMeta(view) {
  const meta = viewMeta[view] || viewMeta.export;
  $('#view-eyebrow').textContent = meta.eyebrow;
  $('#view-title').textContent = meta.title;
}

function setSecretField(name, saved) {
  const input = $(`[name="${name}"]`);
  input.dataset.savedSecret = saved ? 'true' : 'false';
  input.value = saved ? savedSecretValue : '';
  input.placeholder = saved ? '' : 'Noch nicht gespeichert';
}

function bindSecretFields() {
  for (const input of $$('input[type="password"]')) {
    input.addEventListener('focus', () => {
      if (input.dataset.savedSecret === 'true' && input.value === savedSecretValue) {
        input.value = '';
      }
    });
    input.addEventListener('blur', () => {
      if (input.dataset.savedSecret === 'true' && input.value === '') {
        input.value = savedSecretValue;
      }
    });
  }
}

function exportPayload() {
  const form = $('#export-form');
  const data = formToObject(form);
  const selectedLibrary = $('#library-select').selectedOptions[0];
  const artworkKinds = [...form.querySelectorAll('[name="artworkKinds"]:checked')]
    .filter(input => !input.closest('[hidden]'))
    .map(input => input.value);
  return {
    serverType: data.serverType,
    libraryId: data.libraryId,
    libraryType: selectedLibrary?.dataset.type || 'all',
    artworkKinds,
    useKometaAssetNames: Boolean(data.useKometaAssetNames),
    exportPath: data.exportPath || state.settings?.export.defaultPath
  };
}

function restorePayload() {
  const data = formToObject($('#restore-form'));
  return {
    sourcePath: data.sourcePath,
    targetPath: data.targetPath || state.settings?.export.defaultPath,
    overwriteExisting: Boolean(data.overwriteExisting)
  };
}

function typeLabel(type) {
  if (type === 'movie') return 'Filme';
  if (type === 'show') return 'Serien';
  return 'Unbekannt';
}

function updateLibraryType() {
  const selected = $('#library-select').selectedOptions[0];
  const type = selected?.dataset.type;
  $('#library-type').textContent = typeLabel(type);
  $('#season-poster-row').hidden = type !== 'show';
  $('#kometa-asset-name-row').hidden = !['movie', 'show'].includes(type);
}

async function loadLibraries(serverType = $('[name="serverType"]').value) {
  const select = $('#library-select');
  select.innerHTML = '<option value="">Lade Bibliotheken</option>';
  $('#library-type').textContent = '-';

  try {
    state.libraries = await api(`/api/libraries?serverType=${encodeURIComponent(serverType)}`);
  } catch (error) {
    state.libraries = [];
    select.innerHTML = `<option value="">${error.message}</option>`;
    updateLibraryType();
    return;
  }

  if (!state.libraries.length) {
    select.innerHTML = '<option value="">Keine Bibliothek gefunden</option>';
    updateLibraryType();
    return;
  }

  select.innerHTML = '';
  for (const library of state.libraries) {
    const option = document.createElement('option');
    option.value = library.id;
    option.dataset.type = library.type;
    option.textContent = `${library.name} (${typeLabel(library.type)})`;
    select.append(option);
  }
  updateLibraryType();
}

function renderFiles(plan) {
  $('#result-count').textContent = `${plan.count} Dateien`;
  const list = $('#file-list');
  const summary = $('#result-summary');
  list.innerHTML = '';
  summary.innerHTML = '';
  summary.hidden = false;

  if (!plan.files.length) {
    summary.hidden = true;
    list.innerHTML = '<div class="empty-state">Keine Dateien im Plan.</div>';
    return;
  }

  const groups = groupFiles(plan.files);
  const counts = countArtwork(plan.files);
  renderSummary(summary, groups, counts);
  renderExportExample(list, groups);
  renderDetectedProblems(list, plan.files);
}

function renderRestorePlan(plan) {
  $('#restore-result-count').textContent = `${plan.count} Bilder`;
  const list = $('#restore-file-list');
  const summary = $('#restore-result-summary');
  list.innerHTML = '';
  summary.innerHTML = '';
  summary.hidden = false;

  if (!plan.files.length) {
    summary.hidden = true;
    list.innerHTML = '<div class="empty-state">Keine Bilder im Backup gefunden.</div>';
    return;
  }

  renderMetrics(summary, [
    ['Bilder', plan.summary.total],
    ['Wiederherstellen', plan.summary.restore],
    ['Überschreiben', plan.summary.overwrite],
    ['Überspringen', plan.summary.skip],
    ['Probleme', restoreProblems(plan.files).length]
  ]);
  renderRestoreExample(list, plan.files);
  renderRestoreProblems(list, plan.files);
}

function renderSectionTitle(container, title) {
  const heading = document.createElement('h3');
  heading.className = 'preview-section-title';
  heading.textContent = title;
  container.append(heading);
}

function renderExportExample(container, groups) {
  const group = groups[0];
  renderSectionTitle(container, 'Export Beispiel');

  const card = document.createElement('article');
  card.className = 'media-preview';

  const header = document.createElement('div');
  header.className = 'media-preview-header';
  const title = document.createElement('div');
  title.innerHTML = `<strong></strong><span></span>`;
  title.querySelector('strong').textContent = group.title;
  title.querySelector('span').textContent = `${typeLabel(group.type)} · Beispiel aus dem Exportplan`;
  const badge = document.createElement('span');
  badge.className = 'media-badge';
  badge.textContent = group.type === 'show' ? 'Serie' : 'Film';
  header.append(title, badge);

  const folder = document.createElement('div');
  folder.className = 'folder-line';
  folder.textContent = group.folder;

  const assets = document.createElement('div');
  assets.className = 'asset-list compact';
  for (const file of group.files.slice(0, 3)) {
    const asset = document.createElement('div');
    asset.className = 'asset-chip';
    const kind = document.createElement('strong');
    kind.textContent = assetLabel(file.artwork);
    const name = document.createElement('span');
    name.textContent = fileName(file.target);
    asset.append(kind, name);
    assets.append(asset);
  }

  card.append(header, folder, assets);
  container.append(card);
}

function renderRestoreExample(container, files) {
  const file = files.find(entry => entry.action !== 'skip') || files[0];
  renderSectionTitle(container, 'Restore Beispiel');

  const card = document.createElement('article');
  card.className = 'media-preview';

  const header = document.createElement('div');
  header.className = 'media-preview-header';
  const title = document.createElement('div');
  title.innerHTML = `<strong></strong><span></span>`;
  title.querySelector('strong').textContent = file.relativePath;
  title.querySelector('span').textContent = restoreActionLabel(file.action);
  const badge = document.createElement('span');
  badge.className = 'media-badge';
  badge.textContent = assetLabel(file.artwork);
  header.append(title, badge);

  const source = document.createElement('div');
  source.className = 'folder-line';
  source.textContent = file.source;

  const target = document.createElement('div');
  target.className = 'asset-chip single';
  const label = document.createElement('strong');
  label.textContent = 'Ziel';
  const targetPath = document.createElement('span');
  targetPath.textContent = file.target;
  target.append(label, targetPath);

  card.append(header, source, target);
  container.append(card);
}

function renderRestoreProblems(container, files) {
  renderSectionTitle(container, 'Erkannte Probleme');

  const problems = restoreProblems(files);
  const panel = document.createElement('div');
  panel.className = 'problem-list';

  if (!problems.length) {
    const item = document.createElement('div');
    item.className = 'problem-item clean';
    item.textContent = 'Keine Probleme erkannt.';
    panel.append(item);
  } else {
    for (const problem of problems) {
      const item = document.createElement('div');
      item.className = 'problem-item';
      item.textContent = problem;
      panel.append(item);
    }
  }

  container.append(panel);
}

function renderDetectedProblems(container, files) {
  renderSectionTitle(container, 'Erkannte Probleme');

  const problems = findProblems(files);
  const panel = document.createElement('div');
  panel.className = 'problem-list';

  if (!problems.length) {
    const item = document.createElement('div');
    item.className = 'problem-item clean';
    item.textContent = 'Keine Probleme erkannt.';
    panel.append(item);
  } else {
    for (const problem of problems) {
      const item = document.createElement('div');
      item.className = 'problem-item';
      item.textContent = problem;
      panel.append(item);
    }
  }

  container.append(panel);
}

function findProblems(files) {
  const problems = [];
  const targets = new Map();

  for (const file of files) {
    targets.set(file.target, (targets.get(file.target) || 0) + 1);
  }

  const duplicateCount = [...targets.values()].filter(count => count > 1).length;
  if (duplicateCount) {
    problems.push(`${duplicateCount} Zielpfad${duplicateCount === 1 ? '' : 'e'} wird mehrfach verwendet.`);
  }

  const missingSources = files.filter(file => !file.source).length;
  if (missingSources) {
    problems.push(`${missingSources} Datei${missingSources === 1 ? '' : 'en'} hat keine Bildquelle.`);
  }

  return problems;
}

function restoreProblems(files) {
  const skipped = files.filter(file => file.action === 'skip').length;
  const unknown = files.filter(file => !file.artwork).length;
  const problems = [];

  if (skipped) {
    problems.push(skipped === 1
      ? '1 Datei existiert bereits im Ziel und wird übersprungen.'
      : `${skipped} Dateien existieren bereits im Ziel und werden übersprungen.`);
  }

  if (unknown) {
    problems.push(unknown === 1
      ? '1 Datei konnte nicht als Asset erkannt werden.'
      : `${unknown} Dateien konnten nicht als Assets erkannt werden.`);
  }

  return problems;
}

function restoreActionLabel(action) {
  if (action === 'restore') return 'Wird wiederhergestellt';
  if (action === 'overwrite') return 'Wird überschrieben';
  if (action === 'skip') return 'Bleibt unverändert';
  return action;
}

function renderError(message) {
  $('#result-count').textContent = 'Fehler';
  $('#result-summary').hidden = true;
  const list = $('#file-list');
  list.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'empty-state';
  row.textContent = message;
  list.append(row);
}

function groupFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const folder = folderName(file.target);
    const key = `${file.type}:${file.title}:${folder}`;
    if (!groups.has(key)) {
      groups.set(key, { title: file.title, type: file.type, folder, files: [] });
    }
    groups.get(key).files.push(file);
  }
  return [...groups.values()];
}

function countArtwork(files) {
  return files.reduce((counts, file) => {
    counts[file.artwork] = (counts[file.artwork] || 0) + 1;
    return counts;
  }, {});
}

function renderSummary(container, groups, counts) {
  renderMetrics(container, [
    ['Medien', groups.length],
    ['Bilder', groups.reduce((sum, group) => sum + group.files.length, 0)],
    ['Poster', counts.poster || 0],
    ['Fanart', counts.background || 0],
    ['Staffeln', counts.seasonPoster || 0]
  ]);
}

function renderMetrics(container, values) {
  for (const [label, value] of values) {
    const item = document.createElement('div');
    item.className = 'summary-item';
    item.innerHTML = '<strong></strong><span></span>';
    item.querySelector('strong').textContent = value;
    item.querySelector('span').textContent = label;
    container.append(item);
  }
}

function assetLabel(kind) {
  if (kind === 'poster') return 'Poster';
  if (kind === 'background') return 'Fanart';
  if (kind === 'seasonPoster') return 'Staffel';
  return kind;
}

function fileName(target) {
  return target.split('/').pop();
}

function folderName(target) {
  return target.split('/').slice(0, -1).join('/');
}

function renderProgress(job) {
  const progress = $('#export-progress');
  const bar = $('#progress-bar');
  const label = $('#progress-label');
  const detail = $('#progress-detail');
  const total = job.total || job.result?.count || 0;
  const exported = job.exported || 0;

  progress.hidden = false;
  bar.value = total ? Math.round((exported / total) * 100) : 0;
  label.textContent = job.status === 'completed'
    ? 'Export abgeschlossen'
    : job.status === 'failed'
      ? 'Export fehlgeschlagen'
      : 'Export läuft';
  detail.textContent = job.status === 'failed'
    ? job.error
    : `${exported} von ${total || '?'} Dateien`;
}

function renderRestoreProgress(job) {
  const progress = $('#restore-progress');
  const bar = $('#restore-progress-bar');
  const label = $('#restore-progress-label');
  const detail = $('#restore-progress-detail');
  const total = job.total || job.result?.count || 0;
  const restored = job.restored || 0;

  progress.hidden = false;
  bar.value = total ? Math.round((restored / total) * 100) : 0;
  label.textContent = job.status === 'completed'
    ? 'Restore abgeschlossen'
    : job.status === 'failed'
      ? 'Restore fehlgeschlagen'
      : 'Restore läuft';
  detail.textContent = job.status === 'failed'
    ? job.error
    : `${restored} von ${total || '?'} Dateien`;
}

async function pollExportJob(jobId) {
  window.clearInterval(state.exportPoll);
  state.exportPoll = window.setInterval(async () => {
    let job;
    try {
      job = await api(`/api/export/jobs/${jobId}`);
    } catch (error) {
      window.clearInterval(state.exportPoll);
      renderError(error.message);
      return;
    }
    renderProgress(job);

    if (job.status === 'completed') {
      window.clearInterval(state.exportPoll);
      renderFiles(job.result);
      $('#result-count').textContent = `${job.exported} exportiert`;
    }

    if (job.status === 'failed') {
      window.clearInterval(state.exportPoll);
    }
  }, 450);
}

async function pollRestoreJob(jobId) {
  window.clearInterval(state.restorePoll);
  state.restorePoll = window.setInterval(async () => {
    let job;
    try {
      job = await api(`/api/restore/jobs/${jobId}`);
    } catch (error) {
      window.clearInterval(state.restorePoll);
      renderRestoreError(error.message);
      return;
    }
    renderRestoreProgress(job);

    if (job.status === 'completed') {
      window.clearInterval(state.restorePoll);
      renderRestorePlan(job.result);
      $('#restore-result-count').textContent = `${job.restored} wiederhergestellt`;
    }

    if (job.status === 'failed') {
      window.clearInterval(state.restorePoll);
    }
  }, 450);
}

async function preview() {
  try {
    const plan = await api('/api/export/preview', {
      method: 'POST',
      body: exportPayload()
    });
    renderFiles(plan);
  } catch (error) {
    renderError(error.message);
  }
}

async function restorePreview() {
  try {
    const plan = await api('/api/restore/preview', {
      method: 'POST',
      body: restorePayload()
    });
    renderRestorePlan(plan);
  } catch (error) {
    renderRestoreError(error.message);
  }
}

function renderRestoreError(message) {
  $('#restore-result-count').textContent = 'Fehler';
  $('#restore-result-summary').hidden = true;
  const list = $('#restore-file-list');
  list.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'empty-state';
  row.textContent = message;
  list.append(row);
}

function pathInput(name) {
  return $(`[name="${CSS.escape(name)}"]`);
}

async function loadDirectory(directory) {
  const payload = await api(`/api/filesystem/directories?path=${encodeURIComponent(directory || '/')}`);
  state.pathPickerPath = payload.path;
  $('#path-picker-current').textContent = payload.path;
  const list = $('#path-picker-list');
  list.innerHTML = '';

  if (!payload.entries.length) {
    list.innerHTML = '<div class="empty-state compact">Keine Unterordner gefunden.</div>';
    return;
  }

  for (const entry of payload.entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'directory-item';
    button.textContent = entry.name;
    button.addEventListener('click', () => {
      loadDirectory(entry.path).catch(error => {
        renderDirectoryError(error.message);
      });
    });
    list.append(button);
  }
}

function renderDirectoryError(message) {
  const list = $('#path-picker-list');
  list.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'empty-state compact';
  item.textContent = message;
  list.append(item);
}

async function openPathPicker(targetName) {
  const input = pathInput(targetName);
  state.pathPickerTarget = targetName;
  const startPath = input.value || input.placeholder || state.settings?.export.defaultPath || '/';
  $('#path-picker').hidden = false;
  try {
    await loadDirectory(startPath);
  } catch {
    await loadDirectory('/');
  }
}

function closePathPicker() {
  $('#path-picker').hidden = true;
  state.pathPickerTarget = null;
}

function useSelectedPath() {
  const input = pathInput(state.pathPickerTarget);
  if (input) {
    input.value = state.pathPickerPath;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  closePathPicker();
}

function bindNavigation() {
  for (const button of $$('.nav-item')) {
    button.addEventListener('click', () => {
      $$('.nav-item').forEach(item => item.classList.remove('active'));
      $$('.view').forEach(view => view.classList.remove('active'));
      button.classList.add('active');
      $(`#view-${button.dataset.view}`).classList.add('active');
      setViewMeta(button.dataset.view);
    });
  }
}

function bindForms() {
  bindSecretFields();
  setViewMeta($('.nav-item.active')?.dataset.view || 'export');

  $('[name="serverType"]').addEventListener('change', event => {
    loadLibraries(event.currentTarget.value);
  });
  $('#library-select').addEventListener('change', updateLibraryType);

  $('#preview-button').addEventListener('click', preview);
  $('#restore-preview-button').addEventListener('click', restorePreview);

  $('#export-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const job = await api('/api/export/run', {
        method: 'POST',
        body: exportPayload()
      });
      renderProgress(job);
      await pollExportJob(job.id);
    } catch (error) {
      renderError(error.message);
    }
  });

  $('#restore-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const job = await api('/api/restore/run', {
        method: 'POST',
        body: restorePayload()
      });
      renderRestoreProgress(job);
      await pollRestoreJob(job.id);
    } catch (error) {
      renderRestoreError(error.message);
    }
  });

  for (const button of $$('.browse-button')) {
    button.addEventListener('click', () => {
      openPathPicker(button.dataset.pathTarget).catch(error => {
        $('#health').textContent = error.message;
      });
    });
  }

  $('#path-picker-close').addEventListener('click', closePathPicker);
  $('#path-picker-use').addEventListener('click', useSelectedPath);
  $('#path-picker-up').addEventListener('click', () => {
    const current = state.pathPickerPath;
    const parent = current === '/' ? '/' : current.split('/').slice(0, -1).join('/') || '/';
    loadDirectory(parent).catch(error => {
      renderDirectoryError(error.message);
    });
  });
  $('#path-picker').addEventListener('click', event => {
    if (event.target.id === 'path-picker') closePathPicker();
  });

  $('#settings-form').addEventListener('submit', async event => {
    event.preventDefault();
    const saved = await api('/api/settings', {
      method: 'PUT',
      body: formToObject(event.currentTarget)
    });
    fillSettings(saved);
    await loadLibraries();
  });
}

async function boot() {
  bindNavigation();
  bindForms();
  const health = await api('/api/health');
  $('#health').textContent = health.ok ? 'Bereit' : 'Nicht bereit';
  fillSettings(await api('/api/settings'));
  await loadLibraries();
}

boot().catch(error => {
  $('#health').textContent = error.message;
});
