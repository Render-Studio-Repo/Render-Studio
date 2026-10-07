import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "frontend" / "xr" / "xr-dock-hand.js"
NODE_TEST = ROOT / "frontend" / "xr" / "xr-dock-hand.test.js"
JSC = Path(
    "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
)

JSC_HARNESS = r"""
function memStore(init) {
  var data = Object.assign({}, init || {});
  return {
    getItem: function (k) {
      return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
    },
    setItem: function (k, v) {
      data[k] = String(v);
    },
  };
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error((msg || "assert") + ": " + JSON.stringify(a) + " !== " + JSON.stringify(b));
}
assertEq(normalizeDockHand(""), "left");
assertEq(normalizeDockHand(null), "left");
assertEq(normalizeDockHand("none"), "left");
assertEq(normalizeDockHand("RIGHT"), "right");
assertEq(readPreferredDockHand(memStore()), "left");
assertEq(readPreferredDockHand(null), "left");
assertEq(dockHandLabel("left"), "Left hand");
assertEq(dockHandLabel("right"), "Right hand");
assertEq(otherDockHand("left"), "right");
assertEq(otherDockHand("right"), "left");
var store = memStore();
assertEq(writePreferredDockHand(store, "left"), "left");
assertEq(store.getItem(LS_DOCK_HAND), "left");
assertEq(readPreferredDockHand(store), "left");
assertEq(togglePreferredDockHand(store, "left"), "right");
assertEq(readPreferredDockHand(store), "right");
assertEq(togglePreferredDockHand(store, "right"), "left");
assertEq(readPreferredDockHand(store), "left");
print("ok");
"""


def test_xr_dock_hand_preference(tmp_path):
    node = shutil.which("node")
    if node:
        proc = subprocess.run(
            [node, "--test", str(NODE_TEST)],
            cwd=str(ROOT / "frontend"),
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert proc.returncode == 0, proc.stdout + proc.stderr
        return

    assert JSC.exists(), "need node or JavaScriptCore to run xr-dock-hand tests"
    src = HELPER.read_text(encoding="utf-8").replace("export ", "")
    script = tmp_path / "xr-dock-hand-jsc.js"
    script.write_text(src + "\n" + JSC_HARNESS, encoding="utf-8")
    proc = subprocess.run(
        [str(JSC), str(script)],
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "ok" in proc.stdout
