# Render Studio

Render Studio is an AI-first workspace for browser CAD, robotics, electronics, simulation, and collaborative build workflows.

## Install

Download the repository ZIP from GitHub and extract it. Then use the installer for your computer:

- **Windows:** double-click `Install Render Studio.cmd`.
- **macOS:** double-click `Install Render Studio.command`. If macOS blocks the first launch, Control-click it and choose **Open**.
- **Linux:** run `bash scripts/install-render-studio.sh`.

The installer creates an isolated Python environment, installs dependencies, prepares local storage, starts Render Studio, and opens the setup page. Later, use the matching `Start Render Studio` file.

### Terminal installation

```bash
git clone https://github.com/wprojects/Render-Studio.git
cd Render-Studio
bash scripts/install-render-studio.sh
.venv/bin/python run.py
```

Open `http://127.0.0.1:8001/setup.html`. Choose local SQLite or connect your own Supabase project. Credentials remain in the local `.env` file and must never be committed.
