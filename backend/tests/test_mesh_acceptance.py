import json
import subprocess
from pathlib import Path

import pytest
import trimesh
from PIL import Image

from backend.services.mesh_acceptance import candidate_manifest, inspect_mesh, snapshot_payloads, verify_manifest
from backend.services.mesh_service import _parse_review, _review_factory, _find_node, EXPORT_SCRIPT


def test_export_cannot_reuse_previous_attempt_glb(tmp_path, monkeypatch):
    from backend.services import mesh_service
    factory, glb, exporter = tmp_path / "factory.mjs", tmp_path / "out.glb", tmp_path / "export.mjs"
    factory.write_text("export default function(THREE) {}")
    glb.write_bytes(b"stale" * 100)
    exporter.write_text("console.log('{}');")
    monkeypatch.setattr(mesh_service, "EXPORT_SCRIPT", exporter)
    result = mesh_service._run_export(factory, glb)
    assert result["ok"] is False
    assert not glb.exists()


def test_hashes_bind_review_to_source_and_final_glb(tmp_path):
    source = tmp_path / "part.mjs"
    source.write_text("original")
    glb = tmp_path / "part.glb"
    glb.write_bytes(trimesh.creation.box().export(file_type="glb"))
    manifest = candidate_manifest(source, glb, run_id="r1", runtime={})
    manifest["review_passed"] = True
    verify_manifest(source, glb, manifest, "r1")
    source.write_text("mutated")
    with pytest.raises(ValueError, match="changed"):
        verify_manifest(source, glb, manifest, "r1")
    with pytest.raises(ValueError, match="current-run"):
        verify_manifest(source, glb, manifest, "r2")


def test_inspection_rejects_invalid_and_degenerate_glb(tmp_path):
    glb = tmp_path / "bad.glb"
    glb.write_bytes(b"not glb" * 100)
    with pytest.raises(Exception):
        inspect_mesh(glb)
    glb.write_bytes(trimesh.Trimesh(vertices=[[0, 0, 0], [1, 0, 0], [2, 0, 0]],
                                  faces=[[0, 1, 2]], process=False).export(file_type="glb"))
    with pytest.raises(ValueError, match="degenerate"):
        inspect_mesh(glb)


@pytest.mark.parametrize("raw", ['{"pass":"false"}', '{"pass":1}', '{"pass":true,'])
def test_review_requires_complete_json_boolean(raw):
    class AI:
        def _call_model(self, *args, **kwargs):
            return raw, {}
    passed, _, _ = _review_factory(AI(), prompt="box", source="", export_meta={}, trace_id=None,
                                   snapshot_images=[{"data_url": "pixels"}])
    assert passed is False


def test_snapshots_cannot_be_truncated_by_reference_images():
    class AI:
        def _call_model(self, *args, **kwargs):
            assert kwargs["images"][:3] == [{"name": x} for x in ("iso", "top", "front")]
            assert len(kwargs["images"]) == 6
            assert kwargs["allow_truncated"] is False
            return '{"pass":true}', {}
    assert _review_factory(AI(), prompt="box", source="", export_meta={}, trace_id=None,
                           images=[{"name": "reference"}] * 8,
                           snapshot_images=[{"name": x} for x in ("iso", "top", "front")])[0]


def test_snapshot_payload_reads_all_three_images(tmp_path):
    files = {}
    for view in ("iso", "top", "front"):
        Image.new("RGB", (8, 8), "red").save(tmp_path / f"{view}.png")
        files[view] = f"{view}.png"
    payload = snapshot_payloads(tmp_path, {"files": files, "up_axis": "z"})
    assert len(payload) == 3
    assert all(p["data_url"].startswith("data:image/png;base64,iVBOR") for p in payload)
    with pytest.raises(ValueError, match="Z-up"):
        snapshot_payloads(tmp_path, {"files": files, "up_axis": "y"})


@pytest.mark.parametrize("body", [
    "const r=new THREE.Group(); r.visible=false; r.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial())); return r;",
    "const r=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()); r.position.x=NaN; return r;",
])
def test_export_rejects_invisible_or_nonfinite_factory(tmp_path, body):
    factory = tmp_path / "factory.mjs"
    factory.write_text("export default function(THREE){" + body + "}")
    result = subprocess.run([_find_node(), str(EXPORT_SCRIPT), str(factory), str(tmp_path / "out.glb")], capture_output=True, text=True)
    assert result.returncode != 0
    assert not (tmp_path / "out.glb").exists()


def test_real_export_keeps_instances_and_reports_runtime(tmp_path):
    factory = tmp_path / "factory.mjs"
    factory.write_text("""export default function(THREE){ const root=new THREE.Group();
        const geometry=new THREE.BoxGeometry(10,20,30); const material=new THREE.MeshStandardMaterial();
        for(const x of [-100,100]) { const mesh=new THREE.Mesh(geometry,material); mesh.position.x=x; root.add(mesh); } return root; }""")
    glb = tmp_path / "out.glb"
    result = subprocess.run([_find_node(), str(EXPORT_SCRIPT), str(factory), str(glb)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    facts = inspect_mesh(glb)
    assert facts["instances"] == 2
    assert facts["bounds"][0] == pytest.approx([-105, -15, 0])
    assert facts["bounds"][1] == pytest.approx([105, 15, 20])
    metadata = json.loads(result.stdout.strip().splitlines()[-1])
    assert metadata["runtime"]["three"]
    assert metadata["runtime"]["up_axis"] == "z"


def test_axis_conversion_preserves_authored_root_rotation(tmp_path):
    factory = tmp_path / "rotated.mjs"
    factory.write_text("""export default function(THREE){
      const root=new THREE.Mesh(new THREE.BoxGeometry(10,20,30),new THREE.MeshStandardMaterial());
      root.rotation.z=Math.PI/2; return root; }""")
    glb = tmp_path / "out.glb"
    result = subprocess.run([_find_node(), str(EXPORT_SCRIPT), str(factory), str(glb)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    bounds = inspect_mesh(glb)["bounds"]
    assert [hi - lo for lo, hi in zip(*bounds)] == pytest.approx([20, 30, 10])
