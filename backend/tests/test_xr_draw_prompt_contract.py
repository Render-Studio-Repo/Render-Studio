"""Validate the actual frontend Draw bridge against the production request model.

The fixture creates no files, AI calls, project writes, or generation requests.
"""
from pathlib import Path
import json
import subprocess

import pytest

from backend.main import PromptRequest
from backend.services.drawing_context import selected_geometry_context


@pytest.fixture(scope="module")
def draw_contract():
    root = Path(__file__).resolve().parents[2]
    script = r"""
import { createXrAiBoardStore } from './frontend/xr/xr-ai-board-state.js';
import { createBoardSnapshot } from './frontend/xr/xr-ai-board-graph.js';
import { createXrDrawPromptBridge } from './frontend/xr/xr-ai-draw-prompt.js';
const board = createXrAiBoardStore({ id: 'contract-board', projectId: 'contract-project' });
const matrix = [1,0,0,0,0,1,0,0,0,0,1,0,10,20,30,1];
const commands = [
  { type: 'node.add', node: { id: 'part', kind: 'model', name: 'Bracket', source: {
    projectId: 'contract-project', filename: 'bracket.step', revision: 'revision-A', units: 'mm', dimensions: [120,80,40] } } },
  { type: 'region.add', region: { id: 'cad-region', name: 'CAD split face', kind: 'face', nodeId: 'part', anchor: {
    nodeId: 'part', instanceId: 'part', sourceRevision: 'revision-A', faceId: 'cad-face-17', meshId: 'mesh-1', meshPath: 'root/0',
    triangleIndex: 24, localPoints: [[1,2,3],[2,2,3],[2,3,3]], localNormal: [0,0,1], sourceLocalPoint: [11,22,33], boardToSourceMatrix: matrix } } },
  { type: 'region.add', region: { id: 'mesh-region', name: 'Mesh-only lasso', kind: 'lasso', nodeId: 'part', anchor: {
    nodeId: 'part', instanceId: 'part', sourceRevision: 'revision-A', meshId: 'mesh-2', meshPath: 'root/1',
    triangleIndex: 25, localPoints: [[3,4,5],[4,4,5],[4,5,5]], localNormal: [0,0,1], sourceLocalPoint: [13,24,35], boardToSourceMatrix: matrix } } },
  { type: 'note.add', note: { id: 'split-note', regionId: 'cad-region', name: 'Assembly requirements', text: 'Split here and assemble with a keyed connector.',
    requirements: { printerModel: 'User-selected Bambu model', jointStyle: 'keyed connector', intendedSplit: 'Two parts', assembly: 'Keep mating faces aligned' } } },
  { type: 'node.add', node: { id: 'memo', kind: 'memo', name: 'Assembly memo', transcript: 'Preserve the mounting holes.', source: {
    projectId: 'contract-project', filename: 'references/assembly.wav' } } },
  { type: 'link.add', link: { id: 'memo-link', fromId: 'cad-region', toId: 'memo', caption: 'Assembly requirements for this selected region' } },
];
const commandResult = board.dispatch({ type: 'batch', commands });
if (commandResult.error) throw new Error(commandResult.error);
const draft = 'Split the selected region into two parts while preserving the original CAD dimensions.';
const references = [];
const bridge = createXrDrawPromptBridge({ getDraft: () => draft, setDraft: () => { throw new Error('prepare must not edit the reviewed draft'); },
  getAttachments: () => ({ images: [], references }), appendReference: (ref) => { references.push(ref); return true; } });
const prepared = await bridge.prepare(createBoardSnapshot(board.getState(), { prompt: draft }));
if (!prepared.ok) throw new Error(prepared.error);
const before = JSON.parse(JSON.stringify(board.exportState()));
const roundTrip = createXrAiBoardStore(before);
const restored = roundTrip.exportState();
roundTrip.dispatch({ type: 'node.update', id: 'part', patch: { source: { ...roundTrip.getState().nodes.part.source, revision: 'revision-B' } } });
const invalidated = JSON.parse(JSON.stringify(roundTrip.exportState()));
roundTrip.undo();
const undone = roundTrip.exportState();
console.log(JSON.stringify({ request: { prompt: prepared.prompt, base_filename: 'bracket.step', mode: 'v2', target_mode: 'edit', references },
  before, restored, invalidated, undone, snapshot: prepared.snapshot }));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        cwd=root, check=True, capture_output=True, text=True, timeout=15,
    )
    return json.loads(result.stdout)


def test_production_prompt_request_preserves_actual_frontend_surface_references(draw_contract):
    request = PromptRequest.model_validate(draw_contract["request"])
    refs = {ref.id: ref.model_dump(exclude_none=True) for ref in request.references}
    model = refs["vr-board:part"]
    assert model["type"] == "component"
    assert model["filename"] == "bracket.step"
    assert model["geometry_context"]["originalUnits"] == "mm"
    assert model["geometry_context"]["originalDimensions"] == [120, 80, 40]
    cad = refs["vr-board:cad-region"]
    assert cad["geometry_context"]["faceId"] == "cad-face-17"
    assert cad["geometry_context"]["sourceRevision"] == "revision-A"
    assert cad["geometry_context"]["meshPath"] == "root/0"
    assert cad["geometry_context"]["sourceLocalPoint"] == [11, 22, 33]
    assert len(cad["geometry_context"]["boardToSourceMatrix"]) == 16
    assert cad["local_point"] == [11, 22, 33]
    assert cad["loop_points"][1] == [12, 22, 33]
    mesh = refs["vr-board:mesh-region"]
    assert mesh["type"] == "lasso"
    assert mesh["geometry_context"]["faceId"] == ""
    assert mesh["geometry_context"]["triangleIndex"] == 25
    assert "face_index" not in mesh  # Mesh indices never masquerade as CAD IDs.


def test_spatial_document_and_prompt_survive_without_canvas_image_sanitizer(draw_contract):
    request = PromptRequest.model_validate(draw_contract["request"])
    document = next(ref for ref in request.references if ref.id == "vr-board-snapshot:contract-board")
    payload = json.loads(document.text_content)
    assert payload["graph"]["regions"][0]["anchor"]["faceId"] == "cad-face-17"
    assert payload["graph"]["regions"][1]["anchor"]["sourceLocalPoint"] == [13, 24, 35]
    assert payload["graph"]["notes"][0]["requirements"]["jointStyle"] == "keyed connector"
    assert "VR DRAW SPATIAL SNAPSHOT" in request.prompt
    assert '"sourceLocalPoint":[11,22,33]' in request.prompt
    assert not request.images  # This contract does not depend on drawing_metadata.
    context = selected_geometry_context(request.base_filename, request.references)
    assert "cad-face-17" in context
    assert "boardToSourceMatrix" in context
    assert "Preserve the mounting holes." in context


def test_anchor_round_trip_and_revision_invalidation_preserve_new_source_fields(draw_contract):
    for region_id in ("cad-region", "mesh-region"):
        original = draw_contract["before"]["regions"][region_id]["anchor"]
        restored = draw_contract["restored"]["regions"][region_id]["anchor"]
        changed = draw_contract["invalidated"]["regions"][region_id]["anchor"]
        undone = draw_contract["undone"]["regions"][region_id]["anchor"]
        assert restored == original
        assert restored["needsReattach"] is False
        assert changed["needsReattach"] is True
        assert changed["sourceRevision"] == "revision-A"
        assert changed["sourceLocalPoint"] == original["sourceLocalPoint"]
        assert changed["boardToSourceMatrix"] == original["boardToSourceMatrix"]
        assert undone == original
