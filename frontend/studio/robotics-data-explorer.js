import { authHeaders } from "./auth.js?v=20260914-forgot-pw-sblogin2-loginlog1-loginfix1";
import { addViserRecording, recordingDescriptorFromText } from "./viser-recording-selection.js?v=20260923-recording-viser1";
import { handoffRobotDataAgent } from "./robot-data-agent-handoff.js?v=20260923-1";

const DEFAULT_SOURCES = [
  { id: 'simulation', label: 'Simulation', path: 'openarm-mujoco/episodes', description: 'Simulation recordings currently contain analysis snapshots. Check missing_fields before using them for training.' },
  { id: 'viser', label: 'Viser', path: 'openarm-robotics/episodes', description: 'Viser joint recordings share this folder with hardware episodes. Inspect data_source in the metadata to distinguish them. A live visualization alone is not a saved observation/action recording.' },
  { id: 'hardware', label: 'Hardware', path: 'openarm-robotics/episodes', description: 'Hardware recordings currently contain commanded poses and available telemetry. Check missing_fields for measured state and camera gaps.' },
];
let closeActiveExplorer = null;

export function robotAssetFolderForFile(filename = '') {
  const path = String(filename || '').replace(/\\/g, '/').toLowerCase();
  const name = path.split('/').pop() || path;
  if (/\b(policy|checkpoint|weights?|actor|critic)\b/.test(path) || /\.(?:pt|pth|onnx|safetensors)$/.test(name)) return 'Policies';
  if (/\b(calibration|intrinsics?|extrinsics?|camera[_-]?matrix)\b/.test(path)) return 'Calibration';
  if (/\bviser\b/.test(path)) return 'Viser';
  if (/\b(simulation|mujoco|isaac|gazebo)\b/.test(path)) return 'Simulation';
  if (/\b(scene|world|workcell)\b/.test(path) || /\.(?:mjcf|sdf)$/.test(name)) return 'Scenes';
  if (/\.(?:urdf|xacro)$/.test(name)) return 'Robot Models';
  if (/\.(?:glb|gltf|stl|obj|dae)$/.test(name) || /\bmeshes?\b/.test(path)) return 'Meshes';
  if (/\b(record|episode|trajectory|demo|rosbag)\b/.test(path) || /\.(?:mcap|db3|mp4|webm)$/.test(name)) return 'Recordings';
  if (/\b(train|dataset|lerobot)\b/.test(path) || /\.(?:parquet|arrow|h5|hdf5|npz|npy)$/.test(name)) return 'Training Data';
  return 'Config';
}

export function robotDataExplorerPrompt({ robot = "OpenArm 2.0", simulator = "MuJoCo", task = "pick up a cube", artifact = "scene and LeRobot training dataset" } = {}) {
  return `Begin with a Robot Data Import & Setup checklist. I am new to robot learning. Help me set up ${robot} in ${simulator} for this task: ${task}. I need the right ${artifact}. First show what is needed, what is already present, what is missing, and the recommended import order. Search the live Data Explorer and official sources. Compare compatible options using evidence, then walk me through the robot model, scene, meshes, controllers, joint order and units, cameras and calibration, observation/action schema, policy baseline, smoke test, evaluation, and repair loop. Give exact clickable source links. Do not claim a file is compatible unless the metadata supports it. Tell me which file to review in Data Explorer, but wait for me to click Confirm download before retrieving anything. Confirmed files are automatically routed into the matching project folder under Robots/OpenArm 2.0 (Demos, Scenes, Robot Models, Meshes, Config, Calibration, Recordings, Training Data, Policies, Simulation, or Viser). Browser Reference Files remain visible from the Project folders section. After each confirmed download, give the exact next button to load or validate it in Simulation or Viser. Keep Simulation, Shadow, and Hardware steps separate, and never send hardware commands from this guide. Record assumptions, rejected options, validation checks, and the next visible success condition so this conversation can be debugged later.`;
}

export function normalizeHuggingFaceDatasets(payload) {
  const allowed = /\.(jsonl?|parquet|arrow|csv|ya?ml|xml|urdf|xacro|mjcf|sdf|zip|tar|gz|h5|hdf5|mcap|db3|mp4|webm|png|jpe?g|glb|gltf|stl|obj|dae|npz|npy|pt|pth|onnx|safetensors|ckpt|toml|ini|cfg)$/i;
  return (Array.isArray(payload) ? payload : []).filter(item => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(item?.id || ''))).slice(0, 12).map(item => ({
    id: item.id,
    author: String(item.author || item.id.split('/')[0]),
    url: `https://huggingface.co/datasets/${encodeURI(item.id)}`,
    downloads: Math.max(0, Number(item.downloads || 0)),
    likes: Math.max(0, Number(item.likes || 0)),
    last_modified: item.lastModified || null,
    tags: (item.tags || []).slice(0, 20).map(String),
    files: (item.siblings || []).map(file => ({ name: String(file?.rfilename || ''), size: file?.size ?? file?.lfs?.size ?? null }))
      .filter(file => file.name && !file.name.split('/').includes('..') && allowed.test(file.name)).slice(0, 60),
  }));
}

export function robotDatasetSearchTerms(robot, task = '') {
  const robotName = String(robot || '').replace(/\b(?:v(?:ersion)?\s*)?\d+(?:\.\d+)*\b/gi, ' ').replace(/[^a-z0-9_-]+/gi, ' ').trim();
  const taskWords = String(task || '').toLowerCase().match(/\b(cube|block|pick|place|grasp|stack|sort|drawer|door|cloth|pour|push)\b/g) || [];
  return [robotName, ...new Set(taskWords)].filter(Boolean).join(' ').slice(0, 120);
}

export function normalizeRecordingEntries(entries) {
  if (!Array.isArray(entries)) throw new Error('The recording list did not return an array.');
  return entries.map((entry) => typeof entry === 'string' ? { path: entry } : entry)
    .filter((entry) => entry && typeof entry.path === 'string' && entry.path && !entry.path.split('/').includes('..'))
    .map((entry) => ({ path: entry.path, name: String(entry.name || entry.path.split('/').filter(Boolean).pop() || entry.path), directory: entry.directory === true || entry.type === 'directory' || entry.type === 'dir' }));
}

export function recordingDirectoryEntries(files, directory) {
  const prefix = `${directory.replace(/\/+$/, '')}/`;
  const children = new Map();
  for (const entry of normalizeRecordingEntries(files)) {
    if (!entry.path.startsWith(prefix)) continue;
    const rest = entry.path.slice(prefix.length);
    const name = rest.split('/')[0];
    if (!name) continue;
    const path = prefix + name;
    const isDirectory = rest.includes('/') || entry.directory;
    children.set(path, { path, name, directory: isDirectory });
  }
  return [...children.values()].sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export function openRoboticsDataExplorer({ fetchFn = fetch, onOpenFile, onOpenFolder, onAskAgent, listEntries, readFile, getProjectId = () => '', sources = DEFAULT_SOURCES } = {}) {
  closeActiveExplorer?.();
  const element = (tag, text, styles = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    Object.assign(node.style, styles);
    return node;
  };
  const drawer = element('dialog', undefined, { position: 'fixed', inset: '0 0 0 auto', margin: '0', padding: '20px', width: 'min(860px, 94vw)', maxWidth: '94vw', height: '100dvh', maxHeight: '100dvh', boxSizing: 'border-box', background: '#111820', color: '#e8edf4', border: '1px solid #445260', overflow: 'auto' });
  drawer.id = 'robotics-data-explorer';
  drawer.style.fontFamily = 'system-ui, sans-serif';
  drawer.setAttribute('aria-labelledby', 'robotics-data-explorer-title');
  const header = element('div', undefined, { display: 'flex', alignItems: 'center', gap: '12px' });
  const heading = element('h2', 'Robot Data Explorer', { flex: '1', margin: '0' });
  heading.id = 'robotics-data-explorer-title';
  const button = (text, handler) => {
    const node = element('button', text, { padding: '8px 12px', cursor: 'pointer', color: 'inherit', background: '#223241', border: '1px solid #536578', borderRadius: '5px' });
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  };
  let controller = null;
  let remoteController = null;
  let selectedSource = sources[0];
  let selectedPath = null;
  let selectedRecording = null;
  let currentDirectory = selectedSource?.path;
  let disposed = false;
  const close = () => {
    disposed = true;
    controller?.abort();
    remoteController?.abort();
    drawer.close();
    drawer.remove();
    if (closeActiveExplorer === close) closeActiveExplorer = null;
  };
  closeActiveExplorer = close;
  header.append(heading, button('Close', close));
  drawer.append(header, element('p', 'Explore project robot folders and browser Reference Files, inspect recordings, search trusted dataset hosts, and ask Render Agent for a beginner setup walkthrough.'));
  if (typeof onOpenFolder === 'function') {
    const projectFolders = element('section', undefined, { padding: '14px', margin: '14px 0', border: '1px solid #3e4b58', borderRadius: '10px', background: '#0d141b' });
    projectFolders.append(element('h3', 'Project folders', { margin: '0 0 5px' }), element('p', 'Open the full project tree or jump directly to an OpenArm workspace folder.', { color: '#adbac7', margin: '0 0 10px' }));
    const folderActions = element('div', undefined, { display: 'flex', flexWrap: 'wrap', gap: '8px' });
    const openFolder = (label, path) => folderActions.append(button(label, () => { close(); onOpenFolder(path); }));
    openFolder('All Reference Files', 'references');
    openFolder('OpenArm workspace', 'references/Robots/OpenArm 2.0');
    openFolder('Demos', 'references/Robots/OpenArm 2.0/Demos');
    openFolder('Scenes', 'references/Robots/OpenArm 2.0/Scenes');
    openFolder('Training Data', 'references/Robots/OpenArm 2.0/Training Data');
    openFolder('Policies', 'references/Robots/OpenArm 2.0/Policies');
    openFolder('Simulation', 'references/Robots/OpenArm 2.0/Simulation');
    projectFolders.append(folderActions);
    drawer.append(projectFolders);
  }
  const guide = element('section', undefined, { padding: '16px', margin: '14px 0 20px', border: '1px solid #6f602f', borderRadius: '10px', background: '#181812' });
  guide.append(element('h3', 'Find the right robot data', { margin: '0 0 6px' }), element('p', 'Specify the robot, simulator, and task. Render Agent uses your connected AI key or ChatGPT subscription and saves the conversation in thread history for debugging.', { color: '#bdcad7', margin: '0 0 12px' }));
  const guideGrid = element('div', undefined, { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '10px' });
  const field = (labelText, value, placeholder = '') => {
    const label = element('label', undefined, { display: 'grid', gap: '5px', fontSize: '12px', color: '#d8c478' });
    label.append(element('span', labelText));
    const input = element('input', undefined, { width: '100%', boxSizing: 'border-box', padding: '9px', color: '#f2f0e8', background: '#0d1117', border: '1px solid #4f5660', borderRadius: '6px' });
    input.value = value; input.placeholder = placeholder;
    label.append(input);
    return { label, input };
  };
  const robotField = field('Robot and version', 'OpenArm 2.0', 'Robot name and version');
  const simulatorField = field('Simulator / runtime', 'MuJoCo', 'MuJoCo, Isaac Sim, LeRobot…');
  const taskField = field('Task', 'Pick up a cube', 'What should the robot learn?');
  const artifactField = field('Needed files', 'Scene and LeRobot dataset', 'Scene, URDF, policy, episodes…');
  guideGrid.append(robotField.label, simulatorField.label, taskField.label, artifactField.label);
  const guideActions = element('div', undefined, { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' });
  const remoteStatus = element('p', '', { minHeight: '18px', color: '#bdcad7' });
  remoteStatus.setAttribute('role', 'status');
  const remoteResults = element('div', undefined, { display: 'grid', gap: '10px' });
  guide.append(guideGrid, guideActions, remoteStatus, remoteResults);
  drawer.append(guide);
  const sourceBar = element('nav', undefined, { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  sourceBar.setAttribute('aria-label', 'Robot recording sources');
  const description = element('p', '', { color: '#bdcad7' });
  const folder = element('div', '', { fontFamily: 'monospace', overflowWrap: 'anywhere', padding: '8px 0' });
  const toolbar = element('div', undefined, { display: 'flex', gap: '8px' });
  const status = element('p', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = element('div', undefined, { display: 'grid', gridTemplateColumns: 'minmax(150px, 0.7fr) minmax(0, 1.3fr)', gap: '16px' });
  const entriesPane = element('div', undefined, { display: 'flex', flexDirection: 'column', gap: '7px', alignItems: 'stretch' });
  entriesPane.setAttribute('aria-label', 'Recording files');
  const previewPane = element('section', undefined, { minWidth: '0' });
  const filename = element('h3', 'Select a recording', { marginTop: '0', overflowWrap: 'anywhere' });
  const preview = element('pre', 'Choose a source and file to inspect its original contents.', { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#080e14', padding: '12px', maxHeight: '65vh', overflow: 'auto', fontSize: '12px' });
  const openButton = button('Open file', () => { if (selectedPath) onOpenFile?.(selectedPath); });
  openButton.hidden = typeof onOpenFile !== 'function';
  openButton.disabled = true;
  const viserButton = button('Use in Viser', () => {
    if (!selectedRecording) return;
    try {
      addViserRecording(selectedRecording);
      status.textContent = `Selected for Viser · ${selectedRecording.capture_kind}. ${selectedRecording.training_ready ? 'Marked training ready by its manifest.' : `Not training ready${selectedRecording.missing_fields.length ? ` · missing ${selectedRecording.missing_fields.join(', ')}` : '.'}`}`;
    } catch (error) {
      status.textContent = error?.message || 'Unable to select this recording for Viser.';
    }
  });
  viserButton.hidden = true;
  viserButton.disabled = true;
  previewPane.append(filename, openButton, viserButton, preview);
  body.append(entriesPane, previewPane);
  drawer.append(sourceBar, description, folder, toolbar, status, body);

  const currentPrompt = () => robotDataExplorerPrompt({
    robot: robotField.input.value.trim() || 'the selected robot',
    simulator: simulatorField.input.value.trim() || 'the selected simulator',
    task: taskField.input.value.trim() || 'the described task',
    artifact: artifactField.input.value.trim() || 'robot files and training data',
  });

  async function askAgent() {
    const prompt = currentPrompt();
    if (typeof onAskAgent === 'function') {
      await handoffRobotDataAgent({ closeSurface: close, openSidePanel: onAskAgent, question: prompt });
      return;
    }
    close();
    const { openMarketplaceAssistant } = await import('../marketplace/marketplace-discovery.js?v=20260928-hey-ai-summary1');
    await openMarketplaceAssistant({ mode: 'help', query: prompt });
  }

  function renderRemoteResults(payload) {
    remoteResults.replaceChildren();
    const datasets = Array.isArray(payload?.datasets) ? payload.datasets : [];
    for (const dataset of datasets) {
      const card = element('article', undefined, { padding: '12px', border: '1px solid #3e4650', borderRadius: '8px', background: '#10151b' });
      const title = element('a', dataset.id, { color: '#e8cf6a', fontWeight: '700', textDecoration: 'none' });
      title.href = dataset.url; title.target = '_blank'; title.rel = 'noopener noreferrer';
      card.append(title, element('p', `${dataset.downloads || 0} downloads · ${dataset.likes || 0} likes · ${dataset.last_modified || 'update unknown'}`, { color: '#aebbc8', fontSize: '12px' }));
      const files = Array.isArray(dataset.files) ? dataset.files : [];
      if (files.length) {
        const select = element('select', undefined, { width: '100%', padding: '8px', color: '#edf1f5', background: '#090d12', border: '1px solid #4d5965', borderRadius: '5px' });
        for (const file of files) {
          const option = element('option', `${file.name}${Number.isFinite(file.size) ? ` · ${(file.size / 1048576).toFixed(1)} MB` : ' · size unknown'}`);
          option.value = file.name; option.dataset.size = file.size ?? '';
          select.append(option);
        }
        const destination = element('p', '', { color: '#9fb0c0', fontSize: '12px' });
        const syncDestination = () => {
          const folder = robotAssetFolderForFile(select.value);
          destination.textContent = `Destination · Robots/OpenArm 2.0/${folder}`;
        };
        select.addEventListener('change', syncDestination);
        syncDestination();
        const download = button('Confirm download', async () => {
          const selected = select.selectedOptions[0];
          const destinationFolder = robotAssetFolderForFile(selected.value);
          const pid = String(getProjectId?.() || '').trim();
          download.disabled = true;
          remoteStatus.textContent = `Downloading ${dataset.id}/${selected.value} to ${destinationFolder}…`;
          try {
            const endpoint = pid
              ? `/api/projects/${encodeURIComponent(pid)}/robotics/data-explorer/retrieve`
              : '/api/robotics/data-explorer/retrieve';
            const response = await fetchFn(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ repo_id: dataset.id, filename: selected.value, destination_folder: destinationFolder, confirmed: true }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || `Download failed (${response.status}).`);
            remoteStatus.textContent = `Saved ${data.destination} · ${(Number(data.bytes || 0) / 1048576).toFixed(1)} MB.`;
          } catch (error) {
            remoteStatus.textContent = error.message || 'Dataset download failed.';
          } finally { download.disabled = false; }
        });
        card.append(select, destination, download);
      } else card.append(element('p', 'Open the source to inspect files and license information before downloading.', { color: '#aebbc8' }));
      remoteResults.append(card);
    }
    remoteStatus.textContent = datasets.length ? `${datasets.length} source datasets found. Review the source and file before confirming a download.` : 'No matching datasets found. Try a simpler robot or task name.';
  }

  async function searchRemote() {
    remoteController?.abort(); remoteController = new AbortController();
    remoteResults.replaceChildren(); remoteStatus.textContent = 'Searching Hugging Face datasets…';
    const params = new URLSearchParams({ q: `${taskField.input.value} ${artifactField.input.value}`.trim(), robot: robotField.input.value, simulator: simulatorField.input.value, limit: '8' });
    try {
      const response = await fetchFn(`/api/robotics/data-explorer/search?${params}`, { signal: remoteController.signal, headers: authHeaders() });
      let data = await response.json().catch(() => ({}));
      if (response.status === 404) {
        const terms = robotDatasetSearchTerms(robotField.input.value, taskField.input.value);
        const external = await fetchFn(`https://huggingface.co/api/datasets?search=${encodeURIComponent(terms)}&limit=8&full=true`, { signal: remoteController.signal });
        if (!external.ok) throw new Error(`Dataset host search failed (${external.status}).`);
        data = { query: terms, datasets: normalizeHuggingFaceDatasets(await external.json()), source: 'huggingface' };
      } else if (!response.ok) throw new Error(data.detail || `Search failed (${response.status}).`);
      renderRemoteResults(data);
    } catch (error) {
      if (error.name !== 'AbortError') remoteStatus.textContent = error.message || 'Dataset search failed.';
    }
  }

  guideActions.append(button('Search datasets', () => void searchRemote()), button('Ask Render Agent', () => void askAgent()));

  const loadFile = readFile || (async (path, { signal } = {}) => {
    const response = await fetchFn(`/mcp/sandbox/file?path=${encodeURIComponent(path)}`, { signal });
    if (!response.ok) throw new Error(`Unable to read recording (${response.status}).`);
    const data = await response.json();
    if (data.ok === false || typeof data.text !== 'string') throw new Error(data.error || 'Invalid recording file response.');
    return data.text;
  });
  const loadEntries = listEntries || (async (source, { path, signal }) => {
    const directory = path || source.path;
    const files = [];
    let cursor = 0;
    do {
      const response = await fetchFn(`/mcp/sandbox?action=list&path=${encodeURIComponent(directory)}&cursor=${cursor}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to list recordings (${response.status}).`);
      const data = await response.json();
      if (data.ok === false) throw new Error(data.error || 'Recording directory unavailable.');
      files.push(...(data.files || []));
      const next = data.next_cursor;
      if (next == null) break;
      if (!Number.isInteger(next) || next <= cursor) throw new Error('Invalid recording directory page.');
      cursor = next;
    } while (!signal.aborted);
    return recordingDirectoryEntries(files, directory);
  });

  function beginRequest() {
    controller?.abort();
    controller = new AbortController();
    return controller;
  }

  async function showFile(path) {
    const request = beginRequest();
    selectedPath = path;
    selectedRecording = null;
    filename.textContent = path;
    openButton.disabled = true;
    viserButton.hidden = true;
    viserButton.disabled = true;
    preview.textContent = 'Loading…';
    status.textContent = '';
    try {
      const content = await loadFile(path, { signal: request.signal });
      if (disposed || request.signal.aborted) return;
      const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      selectedRecording = recordingDescriptorFromText(text, { manifestPath: path });
      const limit = 1024 * 1024;
      preview.textContent = text.length > limit ? text.slice(0, limit) + '\n\n[Preview limited to 1 MB. Open the original file for the complete recording.]' : text;
      openButton.disabled = false;
      viserButton.hidden = !selectedRecording;
      viserButton.disabled = !selectedRecording;
      status.textContent = selectedRecording
        ? `${selectedRecording.capture_kind} · ${selectedRecording.sample_chunks.length} sample file${selectedRecording.sample_chunks.length === 1 ? '' : 's'} · ${selectedRecording.training_ready ? 'manifest says training ready' : 'visualization only, not training ready'}.`
        : (text.length > limit ? 'Showing the first 1 MB of this file.' : 'Recording preview loaded. Select an episode manifest to use it in Viser.');
    } catch (error) {
      if (disposed || request.signal.aborted) return;
      preview.textContent = '';
      status.textContent = error.message || 'Unable to read this recording.';
    }
  }

  async function refresh() {
    const request = beginRequest();
    entriesPane.replaceChildren();
    selectedPath = null;
    selectedRecording = null;
    openButton.disabled = true;
    viserButton.hidden = true;
    viserButton.disabled = true;
    filename.textContent = 'Select a recording';
    preview.textContent = '';
    description.textContent = selectedSource?.description || '';
    folder.textContent = currentDirectory || selectedSource?.label || 'Robots';
    for (const node of sourceBar.children) node.setAttribute('aria-pressed', String(node.dataset.source === selectedSource?.id));
    status.textContent = 'Loading recordings…';
    try {
      const entries = normalizeRecordingEntries(await loadEntries(selectedSource, { path: currentDirectory, signal: request.signal }));
      if (disposed || request.signal.aborted) return;
      for (const entry of entries) {
        const item = button(`${entry.directory ? 'Folder · ' : ''}${entry.name}`, () => {
          if (entry.directory) { currentDirectory = entry.path; void refresh(); }
          else void showFile(entry.path);
        });
        item.style.textAlign = 'left';
        item.style.overflowWrap = 'anywhere';
        item.title = entry.path;
        entriesPane.append(item);
      }
      status.textContent = entries.length ? `${entries.length} recording items.` : 'No saved recordings in this folder.';
    } catch (error) {
      if (disposed || request.signal.aborted) return;
      status.textContent = error.message || 'Unable to list recordings.';
    }
  }

  for (const source of sources) {
    const item = button(source.label, () => { selectedSource = source; currentDirectory = source.path; void refresh(); });
    item.dataset.source = source.id;
    sourceBar.append(item);
  }
  toolbar.append(button('Source folder', () => { currentDirectory = selectedSource?.path; void refresh(); }), button('Refresh', () => { void refresh(); }));
  drawer.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  document.body.append(drawer);
  drawer.showModal();
  void refresh();
  return { close, refresh, element: drawer };
}
