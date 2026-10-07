import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRecordingEntries, recordingDirectoryEntries, robotDataExplorerPrompt, normalizeHuggingFaceDatasets, robotDatasetSearchTerms, robotAssetFolderForFile } from './robotics-data-explorer.js';

test('robot data explorer prompt preserves setup and confirmation gates', () => {
  const prompt = robotDataExplorerPrompt({ robot: 'OpenArm 2.0', simulator: 'MuJoCo', task: 'sort blocks', artifact: 'LeRobot episodes' });
  assert.match(prompt, /OpenArm 2\.0/);
  assert.match(prompt, /MuJoCo/);
  assert.match(prompt, /sort blocks/);
  assert.match(prompt, /Confirm download/);
  assert.match(prompt, /Robot Data Import & Setup checklist/);
  assert.match(prompt, /Simulation, Shadow, and Hardware steps separate/);
  assert.match(prompt, /debugged later/);
  assert.match(prompt, /Demos/);
  assert.match(prompt, /Browser Reference Files/);
});

test('recording entries reject parent traversal and group direct children', () => {
  const rows = normalizeRecordingEntries([{ path: 'runs/episode/one.json' }, { path: '../secret' }, 'runs/two.json']);
  assert.equal(rows.length, 2);
  assert.deepEqual(recordingDirectoryEntries(rows, 'runs').map(row => [row.name, row.directory]), [['episode', true], ['two.json', false]]);
});

test('Hugging Face results keep safe robot data files only', () => {
  const rows = normalizeHuggingFaceDatasets([{ id: 'enactic/openarm-demo', siblings: [{ rfilename: 'data/train.parquet', size: 20 }, { rfilename: 'run.sh' }, { rfilename: '../secret.json' }] }]);
  assert.deepEqual(rows[0].files, [{ name: 'data/train.parquet', size: 20 }]);
});

test('dataset search removes restrictive version punctuation', () => {
  assert.equal(robotDatasetSearchTerms('OpenArm 2.0', 'Pick up a cube'), 'OpenArm pick cube');
});

test('approved robot assets route into purpose-specific project folders', () => {
  assert.equal(robotAssetFolderForFile('workcell/scene.mjcf'), 'Scenes');
  assert.equal(robotAssetFolderForFile('openarm/robot.urdf'), 'Robot Models');
  assert.equal(robotAssetFolderForFile('meshes/gripper.glb'), 'Meshes');
  assert.equal(robotAssetFolderForFile('calibration/camera.json'), 'Calibration');
  assert.equal(robotAssetFolderForFile('policies/act.safetensors'), 'Policies');
  assert.equal(robotAssetFolderForFile('lerobot/train.parquet'), 'Training Data');
});
