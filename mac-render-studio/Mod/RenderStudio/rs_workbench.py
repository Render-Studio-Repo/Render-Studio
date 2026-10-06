# SPDX-License-Identifier: LGPL-2.1-or-later
"""Render Studio workbench + commands — real module (not FreeCAD InitGui exec)."""

from __future__ import annotations

import traceback
from pathlib import Path

import FreeCAD as App
import FreeCADGui as Gui

from rs_config import CONFIG, MOD_DIR, icon


def _activate_partdesign():
    try:
        Gui.activateWorkbench("PartDesignWorkbench")
    except Exception:
        pass


def _make_pd_cmd(menu_text, tooltip, pixmap, fc_command):
    class _Cmd:
        def GetResources(self):
            return {"Pixmap": pixmap, "MenuText": menu_text, "ToolTip": tooltip}

        def IsActive(self):
            return True

        def Activated(self):
            _activate_partdesign()
            try:
                Gui.runCommand(fc_command, 0)
            except Exception as exc:  # noqa: BLE001
                App.Console.PrintError(f"[RenderStudio] {fc_command} failed: {exc}\n")

    return _Cmd()


def _make_import_cmd(pixmap):
    class _Cmd:
        def GetResources(self):
            return {
                "Pixmap": pixmap,
                "MenuText": "Import Render Projects",
                "ToolTip": "Import STEP files from Render Studio projects/",
            }

        def IsActive(self):
            return True

        def Activated(self):
            try:
                import project_import
            except ImportError:
                from RenderStudio import project_import  # type: ignore
            projects = Path(CONFIG.get("projects_dir", ""))
            doc = App.ActiveDocument or App.newDocument("RenderStudioImport")
            n = project_import.import_projects_tree(projects, doc)
            App.Console.PrintMessage(f"[RenderStudio] Imported {n} solid(s) from {projects}\n")
            Gui.SendMsgToActiveView("ViewFit")

    return _Cmd()


def _make_panel_cmd(menu_text, tooltip, pixmap, tab_index):
    class _Cmd:
        def GetResources(self):
            return {"Pixmap": pixmap, "MenuText": menu_text, "ToolTip": tooltip}

        def IsActive(self):
            return True

        def Activated(self):
            try:
                import layout_shell
            except ImportError:
                from RenderStudio import layout_shell  # type: ignore
            layout_shell.apply_layout(CONFIG)
            try:
                from right_panel import show_right_panel
            except ImportError:
                from RenderStudio.right_panel import show_right_panel  # type: ignore
            panel = show_right_panel(CONFIG)
            panel.tab_bar.setCurrentIndex(tab_index)
            panel.stack.setCurrentIndex(tab_index)
            panel._on_tab(tab_index)

    return _Cmd()


COMMANDS = {
    "RenderStudio_Box": _make_pd_cmd(
        "Box", "PartDesign Additive Box", icon("PartDesign_AdditiveBox.svg"),
        "PartDesign_AdditiveBox",
    ),
    "RenderStudio_Cylinder": _make_pd_cmd(
        "Cylinder", "PartDesign Additive Cylinder", icon("PartDesign_AdditiveCylinder.svg"),
        "PartDesign_AdditiveCylinder",
    ),
    "RenderStudio_Sphere": _make_pd_cmd(
        "Sphere", "PartDesign Additive Sphere", icon("PartDesign_AdditiveSphere.svg"),
        "PartDesign_AdditiveSphere",
    ),
    "RenderStudio_Cone": _make_pd_cmd(
        "Cone", "PartDesign Additive Cone", icon("PartDesign_AdditiveCone.svg"),
        "PartDesign_AdditiveCone",
    ),
    "RenderStudio_Torus": _make_pd_cmd(
        "Torus", "PartDesign Additive Torus", icon("PartDesign_AdditiveTorus.svg"),
        "PartDesign_AdditiveTorus",
    ),
    "RenderStudio_Pad": _make_pd_cmd(
        "Pad", "PartDesign Pad", icon("PartDesign_Pad.svg"), "PartDesign_Pad",
    ),
    "RenderStudio_Pocket": _make_pd_cmd(
        "Pocket", "PartDesign Pocket (cut)", icon("PartDesign_Pocket.svg"),
        "PartDesign_Pocket",
    ),
    "RenderStudio_Hole": _make_pd_cmd(
        "Hole", "PartDesign Hole", icon("PartDesign_Hole.svg"), "PartDesign_Hole",
    ),
    "RenderStudio_Revolution": _make_pd_cmd(
        "Revolve", "PartDesign Revolution", icon("PartDesign_Revolution.svg"),
        "PartDesign_Revolution",
    ),
    "RenderStudio_ImportProjects": _make_import_cmd(icon("PartDesign_Body.svg")),
    "RenderStudio_VibeScript": _make_panel_cmd(
        "VibeScript", "Open VibeScript composer", icon("PartDesignWorkbench.svg"), 0,
    ),
    "RenderStudio_Wiring": _make_panel_cmd(
        "Wiring Simulator", "Open Wiring tab", icon("PartDesign_AdditiveHelix.svg"), 1,
    ),
    "RenderStudio_AI": _make_panel_cmd(
        "AI Assistant", "Open VibeScript composer", icon("PartDesignWorkbench.svg"), 0,
    ),
}


class RenderStudioWorkbench(Gui.Workbench):
    MenuText = CONFIG.get("workbench_menu", "Render Studio")
    ToolTip = "Render Studio on VibeCAD — Create tools, projects, AI bridge"
    Icon = (
        str(MOD_DIR / "Resources" / "render3d-logo.png")
        if (MOD_DIR / "Resources" / "render3d-logo.png").is_file()
        else icon("PartDesignWorkbench.svg")
    )

    def Initialize(self):
        for name, cmd in COMMANDS.items():
            Gui.addCommand(name, cmd)
        create = [
            "RenderStudio_Box",
            "RenderStudio_Cylinder",
            "RenderStudio_Sphere",
            "RenderStudio_Cone",
            "RenderStudio_Torus",
            "RenderStudio_Pad",
            "RenderStudio_Pocket",
            "RenderStudio_Hole",
            "RenderStudio_Revolution",
        ]
        studio = [
            "RenderStudio_ImportProjects",
            "RenderStudio_VibeScript",
            "RenderStudio_Wiring",
            "RenderStudio_AI",
        ]
        self.appendToolbar("Render Studio Create", create)
        self.appendToolbar("Render Studio", studio)
        self.appendMenu("Render Studio", create + studio)
        App.Console.PrintMessage("[RenderStudio] Workbench ready\n")

    def Activated(self):
        App.Console.PrintMessage("[RenderStudio] Workbench activated\n")
        try:
            try:
                import layout_shell
            except ImportError:
                from RenderStudio import layout_shell  # type: ignore
            layout_shell.apply_layout(CONFIG)
        except Exception as exc:  # noqa: BLE001
            App.Console.PrintError(f"[RenderStudio] Activated layout failed: {exc}\n")
            App.Console.PrintError(traceback.format_exc())
            try:
                Path("/tmp/renderstudio-boot.log").write_text(
                    f"Activated fail: {exc}\n{traceback.format_exc()}", encoding="utf-8"
                )
            except OSError:
                pass

    def Deactivated(self):
        pass

    def GetClassName(self):
        return "Gui::PythonWorkbench"


def register_and_boot() -> None:
    try:
        Gui.addWorkbench(RenderStudioWorkbench())
        App.Console.PrintMessage("[RenderStudio] Workbench registered\n")
        try:
            with Path("/tmp/renderstudio-boot.log").open("a", encoding="utf-8") as fh:
                fh.write("Workbench registered\n")
        except OSError:
            pass
    except Exception as exc:  # noqa: BLE001
        # Bundled + user Mod can both load InitGui; second add is expected.
        msg = str(exc)
        if "already exists" in msg:
            App.Console.PrintMessage("[RenderStudio] Workbench already registered\n")
            try:
                with Path("/tmp/renderstudio-boot.log").open("a", encoding="utf-8") as fh:
                    fh.write("Workbench already registered\n")
            except OSError:
                pass
        else:
            raise
    try:
        from startup import schedule_startup
    except ImportError:
        from RenderStudio.startup import schedule_startup  # type: ignore
    schedule_startup(CONFIG)
