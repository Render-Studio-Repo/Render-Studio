from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class InstallerContractTests(unittest.TestCase):
    def test_clickable_installers_reference_platform_venvs_and_setup(self):
        mac = (ROOT / "Install Render Studio.command").read_text()
        win = (ROOT / "scripts" / "install-render-studio.ps1").read_text()
        cmd = (ROOT / "Install Render Studio.cmd").read_text()
        self.assertIn("scripts/install-render-studio.sh", mac)
        self.assertIn(".venv/bin/python", mac)
        self.assertIn("setup.html", mac)
        self.assertIn("ExecutionPolicy Bypass", cmd)
        self.assertIn(".venv\\Scripts\\python.exe", win)
        self.assertIn("requirements.txt", win)
        self.assertIn("bootstrap_render_instance.py", win)
        self.assertIn("setup.html", win)

    def test_clickable_starters_fall_back_to_installers(self):
        mac = (ROOT / "Start Render Studio.command").read_text()
        win = (ROOT / "Start Render Studio.cmd").read_text()
        self.assertIn("Install Render Studio.command", mac)
        self.assertIn("Install Render Studio.cmd", win)
        self.assertIn("run.py", mac)
        self.assertIn("run.py", win)

    def test_first_run_setup_covers_account_and_ai_access(self):
        html = (ROOT / "frontend" / "pages" / "setup.html").read_text(encoding="utf-8")
        js = (ROOT / "frontend" / "site" / "setup-instance.js").read_text(encoding="utf-8")

        self.assertIn("Sign in to Render", html)
        self.assertIn("Set up locally", html)
        self.assertIn("Add API keys", html)
        self.assertIn("/api/setup/render-login-status", js)
        self.assertIn("/api/setup/local", js)
        self.assertIn("ecosystem_opt_in: false", js)

    def test_installer_bootstrap_initializes_sqlite(self):
        bootstrap = (ROOT / "scripts" / "bootstrap_render_instance.py").read_text()
        self.assertIn("from backend.database import init_db", bootstrap)
        self.assertIn("init_db()", bootstrap)

if __name__ == "__main__":
    unittest.main()
