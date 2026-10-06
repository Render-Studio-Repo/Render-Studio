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
        html = (ROOT / "frontend" / "setup.html").read_text(encoding="utf-8")
        js = (ROOT / "frontend" / "setup.js").read_text(encoding="utf-8")

        self.assertIn("Create Render account", html)
        self.assertIn("Connect a subscription", html)
        self.assertIn("Add an API key", html)
        self.assertIn('authenticate("/api/auth/register"', js)
        self.assertIn('api("/api/user/ai-keys"', js)
        self.assertIn('/?setup_ai=subscriptions', js)


if __name__ == "__main__":
    unittest.main()
