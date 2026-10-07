# Render Studio

Render Studio is a browser based workspace for AI assisted CAD, robotics, electronics, simulation, and collaborative product development. Run it on your computer, keep projects local, or connect the installation to the Render ecosystem and shared public marketplace.

![Render Studio workspace](docs/assets/render-studio-hero.png)

## What you can build

Render Studio brings design tools and AI assistance into one workspace.

| Area | What it provides |
|---|---|
| CAD and 3D design | Prompt based generation, parametric editing, sketches, joints, assemblies, measurements, materials, and model inspection |
| Robotics | URDF workflows, OpenArm tools, MuJoCo simulation, teleoperation panels, controller input, robot cameras, and Viser telemetry |
| Electronics | Parts search, wiring diagrams, connection checks, electronics layouts, and wiring harness planning |
| Fabrication | STEP, STL, GLB, OBJ, and 3MF workflows, Bambu export, print preparation, and design for manufacturing checks |
| AI workspace | Render Agent chat, project references, reusable skills, knowledge bases, voice controls, and model provider selection |
| Collaboration | Shared projects, teams, comments, public links, project history, and user profiles |
| Marketplace | Models, agents, knowledge packages, storefronts, carts, purchases, downloads, and federated public listings |
| Diagnostics | Health checks, feature status, incident records, debugger analytics, performance data, and repair context |

Render Studio uses a FastAPI backend and a browser frontend. The default local server listens on `http://127.0.0.1:8001`.

## Requirements

Install these tools before you start:

- Python 3.10 or newer.
- Git, if you clone the repository instead of downloading a ZIP file.
- A current version of Chrome, Edge, Safari, or Firefox.
- Internet access during installation so `pip` can download Python packages.

Some integrations need their own software or hardware. MuJoCo, robot bridges, VR headsets, CAD desktop applications, and cloud provider accounts are optional.

## Install Render Studio

The installer creates the local SQLite database and applies its schema automatically. No separate SQLite download or manual SQL step is required. SQLite ships with Python, and Render Studio initializes it during setup and again safely at backend startup.

### Windows

1. Download the repository ZIP from GitHub and extract it.
2. Double-click `Install Render Studio.cmd`.
3. Wait for the installer to create `.venv`, install the packages, and start the server.
4. Complete the setup page that opens in your browser.

Use `Start Render Studio.cmd` after the first installation.

If Windows cannot find Python, install Python 3.10 or newer from [python.org](https://www.python.org/downloads/windows/). Enable **Add python.exe to PATH** during the Python installation.

### macOS

1. Download the repository ZIP from GitHub and extract it.
2. Double-click `Install Render Studio.command`.
3. If macOS blocks the file, Control-click it and choose **Open**.
4. Complete the setup page that opens in your browser.

Use `Start Render Studio.command` after the first installation.

### Linux

Run these commands from the extracted repository:

```bash
bash scripts/install-render-studio.sh
.venv/bin/python run.py
```

Open `http://127.0.0.1:8001/setup.html`.

### Install from Git

```bash
git clone https://github.com/wprojects/Render-Studio.git
cd Render-Studio
bash scripts/install-render-studio.sh
.venv/bin/python run.py
```

The installer performs these actions:

1. Checks for Python 3.10 or newer.
2. Creates an isolated `.venv` environment.
3. Installs `requirements.txt`.
4. Copies `.env.example` to `.env` when needed.
5. Creates the local `data/` and `projects/` directories.
6. Creates one stable identity for the Render Studio installation.
7. Displays or opens the guided setup page.

## Choose how the installation works

The setup page offers two starting modes.

### Connect to the Render ecosystem

Choose **Sign in to Render** when you want the installation to use the shared ecosystem.

A connected installation can:

- Register its stable instance ID with Render.
- Browse listings from the shared public marketplace.
- Publish locally approved public listings to the shared catalog.
- Open the hosted Render login and marketplace pages.
- Opt into aggregate health reporting separately.

Render Studio sends marketplace metadata only for a listing that an administrator explicitly approves as public. Drafts, private projects, project files, prompts, API keys, hostnames, IP addresses, and user identities do not enter the marketplace enrollment payload.

### Keep the installation local

Choose **Set up locally** when you want an independent installation.

Local mode:

- Stores accounts and AI keys on the installation.
- Keeps the marketplace catalog private to the installation.
- Disables ecosystem enrollment and health reporting.
- Uses repository local `projects/` and `data/` directories by default.

You can use local SQLite or connect your own Supabase project. The setup page provides the required Supabase SQL and connection fields.

## Configure AI access

You can add provider keys after the server starts. Open the profile settings in Render Studio and find **AI & Billing**.

The public configuration supports these provider variables:

```dotenv
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
KIMI_API_KEY=
```

Additional providers and local models are available through the application settings. Keep provider keys in `.env` or the encrypted per-user key service. Never add keys to frontend files or commit `.env`.

Hosted Render accounts and local accounts remain separate unless account federation is configured for the installation.

## Start and stop the server

Start Render Studio on macOS or Linux:

```bash
.venv/bin/python run.py
```

Start Render Studio on Windows:

```powershell
.venv\Scripts\python.exe run.py
```

Stop the development server with `Ctrl+C` in its terminal.

The default pages are:

| Page | URL |
|---|---|
| Studio | `http://127.0.0.1:8001/` |
| First-run setup | `http://127.0.0.1:8001/setup.html` |
| Getting started | `http://127.0.0.1:8001/getting-started.html` |
| User documentation | `http://127.0.0.1:8001/docs.html` |
| Marketplace | `http://127.0.0.1:8001/marketplace.html` |
| Generated API reference | `http://127.0.0.1:8001/docs` |

## API overview

Render Studio exposes a JSON API from the same FastAPI server. Open `/docs` on a running installation for the generated request and response reference.

Common public and setup endpoints include:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Check server health and version state |
| `GET` | `/api/setup/status` | Read the current first-run configuration |
| `GET` | `/api/setup/render-login-status` | Check the hosted Render login service |
| `POST` | `/api/setup/local` | Select local account storage |
| `GET` | `/api/setup/instance-network` | Read the instance ID and ecosystem settings |
| `POST` | `/api/setup/instance-network` | Save marketplace and reporting choices |
| `POST` | `/api/auth/register` | Create a local account |
| `POST` | `/api/auth/login` | Sign in and receive an access token |
| `GET` | `/api/auth/me` | Read the signed-in user |
| `GET` | `/api/marketplace/catalog` | List local and connected public listings |
| `GET` | `/api/marketplace/product/{kind}/{listing_id_or_slug}` | Read one marketplace product |
| `GET` | `/api/marketplace/cart` | Read the signed-in user's cart |
| `POST` | `/api/marketplace/cart` | Add a marketplace item to the cart |
| `GET` | `/api/skills` | List available agent skills |
| `GET` | `/api/knowledge-bases` | List the signed-in user's knowledge bases |

Most account, project, commerce, and administration endpoints require a bearer token:

```http
Authorization: Bearer YOUR_ACCESS_TOKEN
```

The API also includes project files, CAD generation, exports, teams, textures, robotics, simulation, diagnostics, integrations, marketplace administration, and user settings. Use the generated API reference as the source for current parameters.

## Marketplace federation

Every installation creates one stable `instance_id` and a private instance credential. The credential is stored locally. The public hub stores only its hash and binds it to that instance ID.

The connected marketplace flow is:

1. The operator enables the Render ecosystem in setup.
2. The installation registers its stable identity with the hub.
3. The installation pulls the shared public catalog.
4. An administrator approves a local listing for public use.
5. The installation sends the sanitized listing metadata to the hub.
6. Other connected installations receive the listing in their catalog.

The hub rejects missing credentials, credentials from another instance, drafts, and nonpublic payloads. See [Marketplace hub architecture](docs/marketplace-hub.md) for deployment details.

## Data and configuration

The normal local layout is:

```text
Render-Studio/
├── .env                 Local secrets and runtime settings
├── .venv/               Isolated Python environment
├── data/                Local database and instance settings
├── projects/            User project data
├── backend/             FastAPI routes, services, and CAD systems
├── frontend/            Browser application and static assets
├── integrations/        Supabase and external integration resources
├── scripts/             Installers, checks, and maintenance tools
└── docs/                Architecture and workflow guides
```

Both `.env` and runtime data are excluded from the public release audit. Use absolute `PROJECTS_DIR` or `DATA_DIR` values when you intentionally store data on another drive.

Important `.env` settings include:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `8001` | Server port |
| `PROJECTS_DIR` | `projects` | Project storage directory |
| `DATA_DIR` | `data` | Database and local settings directory |
| `USERS_BACKEND` | Local setup choice | Select local users or Supabase users |
| `SUPABASE_URL` | Empty | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Empty | Server-only Supabase credential |
| `PUBLIC_BASE_URL` | Local server | Public HTTPS origin for a hosted installation |
| `MARKETPLACE_HUB_URL` | `https://render3d.app` | Shared marketplace hub |

Start with [.env.example](.env.example). The file documents optional OAuth, collaboration, payment, robotics, and deployment settings.

## Security and privacy

- Keep `.env`, API keys, OAuth secrets, database credentials, and instance credentials out of Git.
- Expose the server to a network only after you configure authentication and HTTPS.
- Leave `HOST=127.0.0.1` for a computer-only installation.
- Treat `SUPABASE_SERVICE_ROLE_KEY` as a server credential.
- Review a listing before you make it public.
- Enable health reporting only when you want to share aggregate instance status.
- Back up `data/` and `projects/` before an upgrade or storage migration.

The public release excludes private deployment profiles, personal administrator defaults, user databases, generated recordings, browser profiles, and credentials. Read [Open-source rollout boundary](docs/open-source-rollout-boundary.md) for the complete trust boundary.

## Update an installation

If the source tree has no local application changes, update from Git:

```bash
git pull --ff-only
bash scripts/install-render-studio.sh
```

On Windows, run `Install Render Studio.cmd` again after the pull. The installer reuses `.venv`, updates dependencies, preserves `.env`, and keeps `data/` and `projects/`.

Commit or back up application source changes before you update. The built-in update flow refuses to overwrite a modified source tree or protected runtime data.

## Troubleshooting

### The installer cannot find Python

Install Python 3.10 or newer. On Windows, enable the PATH option in the Python installer. Then run the Render Studio installer again.

### The browser does not open

Open `http://127.0.0.1:8001/setup.html` manually. Check the terminal for a Python error if the page does not load.

### Port 8001 is already in use

Set another port in `.env`:

```dotenv
PORT=8010
```

Restart Render Studio and open the new port.

### AI generation does not work

Confirm that you added a valid provider key or connected a supported subscription. Open **Profile**, select **AI & Billing**, and check the active provider.

### A connected marketplace is offline

Open `/setup.html` and save the ecosystem settings again. The status message reports whether the hub accepted the stable instance ID. Local projects and local listings remain available while the hub is offline.

### Reset the Python environment

Stop Render Studio, remove `.venv`, and run the installer again. This rebuilds installed packages. It does not remove `.env`, `data/`, or `projects/`.

## Documentation map

- [Marketplace hub architecture](docs/marketplace-hub.md)
- [Open-source rollout boundary](docs/open-source-rollout-boundary.md)
- [Robot learning workflow](docs/robot-learning-workflow.md)
- [OpenArm, MuJoCo, and wiring setup](docs/openarm-pi-mujoco-wiring.md)
- [VR robotics workspace](docs/vr-robotics-workspace.md)
- [VR menu and public rooms](docs/vr-menu-and-public-room.md)
- [CAD inspection harness](docs/cad-inspection-harness.md)
- [Wiring component sources](docs/wiring-component-sources.md)
- [Prompt vector intake API](docs/prompt-vector-intake-api.md)
- [Context research method](docs/context-research-method.md)
- [Fusion connector reference](docs/fusion-connector-for-jake/README.md)

## Safe instance updates

Instances connected to the Render ecosystem receive admin-only update notices when the public repository's `master` branch advances. Updates are never installed automatically. An administrator reviews the release and clicks **Update Render**.

The updater accepts only the exact fetched `origin/master` commit and a fast-forward history. It refuses to run when application source has tracked or untracked changes, or when a release touches projects, databases, backups, logs, credentials, private modules, or hosted super-admin surfaces. Runtime data remains outside Git and stays in place across updates. Changes made only to render3d.app do not publish an instance update.

Connected installations also receive dismissible service announcements from Render. Announcements are authenticated with the installation's existing instance credential and may contain an update notice, suggestion, or What's New message with an optional Render action link. Standalone installations do not request or display service announcements.

## Verify the public release

Run the dependency-free release checks from a fresh clone:

```bash
python3 scripts/public-release-audit.py
python3 -m unittest scripts.test-installers -v
node scripts/feature-map.mjs verify-git --base origin/master --head HEAD
```

The audit rejects credentials, private runtime files, personal administrator defaults, and other files that must not enter the public repository.

## Contribute

1. Create a branch from `master`.
2. Keep private data and credentials outside the repository.
3. Add focused behavior tests for changed runtime behavior.
4. Run the public release checks.
5. Open a pull request that explains the user impact and verification.

Render Studio has live production and self-hosted use cases. Keep changes additive, preserve local data boundaries, and verify the user flow that you changed.
