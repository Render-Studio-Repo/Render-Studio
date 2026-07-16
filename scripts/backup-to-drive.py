#!/usr/bin/env python3
"""Daily backup of Render3D code + project models to Google Drive.

Creates /home/ubuntu/backups/drive-daily/M-D-YYYY/render3d-backup.tar.gz,
uploads it under PARENT_FOLDER_ID/M-D-YYYY/, and prunes backups older than
RETENTION_DAYS locally and on Drive.

Excludes installed packages (.venv, myenv, node_modules, __pycache__, etc.).

One-time auth (browser required):
  /home/ubuntu/.venv/bin/python3 /home/ubuntu/scripts/backup-to-drive.py --auth
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import pickle
import shutil
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path("/home/ubuntu")
LOCAL_BACKUP_ROOT = ROOT / "backups" / "drive-daily"
RETENTION_DAYS = 7
PROTECTED_BACKUP_PREFIXES = ("golden-",)

# Google Drive destination folder (Render3D daily backups)
PARENT_FOLDER_ID = os.getenv(
    "RENDER3D_DRIVE_BACKUP_FOLDER_ID",
    "1fem3lTRHWwzHpnXZMUTaYFXf7qYeqGwU",
)

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]

TOKEN_DIR = Path(os.getenv("GOOGLE_TOKEN_DIR", "/home/ubuntu/.config/ohio"))
TOKEN_DIR.mkdir(parents=True, exist_ok=True)
TOKEN_FILE = TOKEN_DIR / "token_google_drive_backup.pickle"
CREDENTIALS_FILE = TOKEN_DIR / "credentials_google_drive_backup.json"

CLIENT_ID = os.getenv(
    "GOOGLE_OAUTH_CLIENT_ID",
    "1089945756491-8g4rpmi0t3i1qh5qrparfahj86ptnviq.apps.googleusercontent.com",
)
CLIENT_SECRET = os.getenv(
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "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",
)

BACKUP_DIRS = (
    "backend",
    "frontend",
    "scripts",
    "services",
    "deploy",
    "data",
    "projects",
    "fusion360-plugin",
    "milestones",
    "inbox",
    "images",
)
BACKUP_FILES = (
    "requirements.txt",
    "run.py",
    "README.md",
    ".env",
    ".env.example",
)

TAR_EXCLUDES = (
    ".venv",
    "myenv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".cache",
    ".cursor",
    ".cursor-server",
    ".codex",
    ".local",
    "snap",
    "backups",
    "*.pyc",
    "*.pyo",
    ".mypy_cache",
    ".ruff_cache",
    "*.egg-info",
)

LOG = logging.getLogger("backup-to-drive")


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def ensure_credentials_file() -> None:
    if CREDENTIALS_FILE.is_file():
        return
    payload = {
        "installed": {
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "project_id": "render3d-drive-backup",
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
            "redirect_uris": ["http://localhost"],
        }
    }
    CREDENTIALS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    LOG.info("Wrote OAuth client config to %s", CREDENTIALS_FILE)


def get_drive_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    ensure_credentials_file()
    creds = None
    if TOKEN_FILE.is_file():
        with TOKEN_FILE.open("rb") as fh:
            creds = pickle.load(fh)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            raise RuntimeError(
                "Google Drive token missing or expired. Run once with --auth:\n"
                f"  {sys.executable} {Path(__file__).resolve()} --auth"
            )
        with TOKEN_FILE.open("wb") as fh:
            pickle.dump(creds, fh)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def run_oauth_flow() -> None:
    from google_auth_oauthlib.flow import InstalledAppFlow

    ensure_credentials_file()
    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=0, open_browser=False, prompt="consent")
    with TOKEN_FILE.open("wb") as fh:
        pickle.dump(creds, fh)
    LOG.info("Saved OAuth token to %s", TOKEN_FILE)


def git_head() -> str:
    try:
        out = subprocess.check_output(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
        return out.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def collect_paths() -> tuple[list[Path], list[Path]]:
    dirs: list[Path] = []
    files: list[Path] = []
    for name in BACKUP_DIRS:
        path = ROOT / name
        if path.is_dir():
            dirs.append(path)
        else:
            LOG.warning("Skipping missing directory: %s", path)
    for name in BACKUP_FILES:
        path = ROOT / name
        if path.is_file():
            files.append(path)
    git_dir = ROOT / ".git"
    if git_dir.is_dir():
        dirs.append(git_dir)
    return dirs, files


def backup_folder_name(day: date) -> str:
    """US-style m-d-y folder name, e.g. 7-6-2026."""
    return f"{day.month}-{day.day}-{day.year}"


def parse_backup_date(name: str) -> date | None:
    try:
        return datetime.strptime(name, "%Y-%m-%d").date()
    except ValueError:
        pass
    parts = name.split("-")
    if len(parts) != 3:
        return None
    try:
        a, b, c = (int(part) for part in parts)
    except ValueError:
        return None
    if c >= 1000:
        return date(c, a, b)
    if a >= 1000:
        return date(a, b, c)
    return None


def is_protected_backup_name(name: str) -> bool:
    lowered = str(name or "").strip().lower()
    return any(lowered.startswith(prefix) for prefix in PROTECTED_BACKUP_PREFIXES)


def create_archive(day: date, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    folder = backup_folder_name(day)
    archive = dest_dir / f"render3d-backup-{folder}.tar.gz"
    if archive.is_file():
        LOG.info("Archive already exists for %s; reusing %s", day, archive)
        return archive

    dirs, files = collect_paths()
    if not dirs and not files:
        raise RuntimeError("Nothing to back up")

    cmd = ["tar", "-czf", str(archive), "-C", str(ROOT)]
    for pattern in TAR_EXCLUDES:
        cmd.extend(["--exclude", pattern])
    for path in dirs:
        cmd.append(path.name)
    for path in files:
        cmd.append(path.name)

    LOG.info("Creating archive: %s", archive)
    subprocess.run(cmd, check=True)

    manifest = dest_dir / "MANIFEST.txt"
    manifest.write_text(
        "\n".join(
            [
                f"created_utc={datetime.now(timezone.utc).isoformat()}",
                f"backup_date={backup_folder_name(day)}",
                f"git_head={git_head()}",
                f"archive={archive.name}",
                f"archive_bytes={archive.stat().st_size}",
                "included_dirs=" + ",".join(BACKUP_DIRS) + ",.git",
                "included_files=" + ",".join(BACKUP_FILES),
                "excludes=" + ",".join(TAR_EXCLUDES),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    LOG.info("Archive size: %.2f GiB", archive.stat().st_size / (1024**3))
    return archive


def drive_find_folder(service, name: str, parent_id: str) -> str | None:
    safe_name = name.replace("'", "\\'")
    query = (
        f"name='{safe_name}' and '{parent_id}' in parents and "
        "mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    resp = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id,name)", pageSize=10)
        .execute()
    )
    files = resp.get("files") or []
    return files[0]["id"] if files else None


def drive_create_folder(service, name: str, parent_id: str) -> str:
    existing = drive_find_folder(service, name, parent_id)
    if existing:
        return existing
    meta = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    created = service.files().create(body=meta, fields="id").execute()
    folder_id = created["id"]
    LOG.info("Created Drive folder %s (%s)", name, folder_id)
    return folder_id


def drive_upload_file(service, local_path: Path, folder_id: str) -> str:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    existing = drive_find_file(service, local_path.name, folder_id)
    media = MediaFileUpload(str(local_path), mimetype="application/gzip", resumable=True)
    try:
        if existing:
            LOG.info("Updating existing Drive file %s", local_path.name)
            updated = (
                service.files()
                .update(fileId=existing, media_body=media, fields="id,name,size")
                .execute()
            )
            return updated["id"]

        LOG.info("Uploading %s to Drive folder %s", local_path.name, folder_id)
        created = (
            service.files()
            .create(
                body={"name": local_path.name, "parents": [folder_id]},
                media_body=media,
                fields="id,name,size",
            )
            .execute()
        )
        return created["id"]
    except HttpError as exc:
        detail = getattr(exc, "error_details", None) or str(exc)
        raise RuntimeError(f"Google Drive upload failed for {local_path.name}: {detail}") from exc


def drive_find_file(service, name: str, parent_id: str) -> str | None:
    safe_name = name.replace("'", "\\'")
    query = f"name='{safe_name}' and '{parent_id}' in parents and trashed=false"
    resp = (
        service.files()
        .list(q=query, spaces="drive", fields="files(id,name)", pageSize=10)
        .execute()
    )
    files = resp.get("files") or []
    return files[0]["id"] if files else None


def upload_day_backup(service, day: date, local_dir: Path, archive: Path) -> None:
    folder_id = drive_create_folder(service, backup_folder_name(day), PARENT_FOLDER_ID)
    drive_upload_file(service, archive, folder_id)
    manifest = local_dir / "MANIFEST.txt"
    if manifest.is_file():
        drive_upload_file(service, manifest, folder_id)


def prune_local(cutoff: date) -> None:
    if not LOCAL_BACKUP_ROOT.is_dir():
        return
    for entry in LOCAL_BACKUP_ROOT.iterdir():
        if not entry.is_dir():
            continue
        if is_protected_backup_name(entry.name):
            LOG.info("Keeping protected local backup folder %s", entry)
            continue
        day = parse_backup_date(entry.name)
        if day is None or day >= cutoff:
            continue
        LOG.info("Pruning local backup folder %s", entry)
        shutil.rmtree(entry)


def prune_drive(service, cutoff: date) -> None:
    from googleapiclient.errors import HttpError

    query = (
        f"'{PARENT_FOLDER_ID}' in parents and "
        "mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    page_token = None
    while True:
        try:
            resp = (
                service.files()
                .list(
                    q=query,
                    spaces="drive",
                    fields="nextPageToken, files(id,name)",
                    pageSize=100,
                    pageToken=page_token,
                )
                .execute()
            )
        except HttpError as exc:
            raise RuntimeError(f"Google Drive list failed during prune: {exc}") from exc
        for item in resp.get("files") or []:
            name = item.get("name") or ""
            if is_protected_backup_name(name):
                LOG.info("Keeping protected Drive backup folder %s (%s)", name, item["id"])
                continue
            day = parse_backup_date(name)
            if day is None or day >= cutoff:
                continue
            LOG.info("Pruning Drive backup folder %s (%s)", name, item["id"])
            try:
                service.files().delete(fileId=item["id"]).execute()
            except HttpError as exc:
                LOG.warning("Could not delete Drive folder %s: %s", name, exc)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break


def run_backup(*, skip_upload: bool = False) -> None:
    day = datetime.now(timezone.utc).date()
    folder = backup_folder_name(day)
    local_dir = LOCAL_BACKUP_ROOT / folder
    archive = create_archive(day, local_dir)

    if not skip_upload:
        service = get_drive_service()
        upload_day_backup(service, day, local_dir, archive)
        cutoff = day - timedelta(days=RETENTION_DAYS)
        prune_drive(service, cutoff)

    cutoff = day - timedelta(days=RETENTION_DAYS)
    prune_local(cutoff)
    LOG.info("Daily backup complete for %s", folder)


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(description="Backup Render3D code/models to Google Drive")
    parser.add_argument("--auth", action="store_true", help="Run OAuth flow and save token")
    parser.add_argument("--local-only", action="store_true", help="Create archive only; skip Drive upload")
    args = parser.parse_args()

    if args.auth:
        run_oauth_flow()
        return 0

    try:
        run_backup(skip_upload=args.local_only)
    except Exception:
        LOG.exception("Backup failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
