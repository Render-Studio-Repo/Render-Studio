#!/usr/bin/env python3
"""Daily backup of Render Studio 3D project models to Google Drive.

Creates a temporary archive of ``projects/``, uploads it under
PARENT_FOLDER_ID/M-D-YYYY/, then deletes the local archive so model
backups live on Drive only (not under backups/drive-daily).

Drive keeps the last ``RETENTION_DAYS`` (10) daily folders; older day
folders are pruned after each successful upload.

Code continues to use local rolling snapshots via backup-code.sh
(which does not include projects/).

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
# Staging only — deleted after a successful Drive upload.
LOCAL_BACKUP_ROOT = ROOT / "backups" / "drive-daily"
RETENTION_DAYS = 10
PROTECTED_BACKUP_PREFIXES = ("golden-",)

# Google Drive destination folder (model backups only)
PARENT_FOLDER_ID = os.getenv(
    "RENDER3D_DRIVE_BACKUP_FOLDER_ID",
    "1ovSbfq6D8kNlL72CJcNueRdKKDsOgt6M",
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

# Model / project data only — code stays in local snapshots.
BACKUP_DIRS = ("projects",)
BACKUP_FILES: tuple[str, ...] = ()

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
    "*.tmp",
    "*.part",
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
    archive = dest_dir / f"render3d-models-{folder}.tar.gz"
    if archive.is_file() and archive.stat().st_size > 0:
        LOG.info("Archive already exists for %s; reusing %s", day, archive)
        return archive

    dirs, files = collect_paths()
    if not dirs and not files:
        raise RuntimeError("Nothing to back up")

    cmd = [
        "tar",
        "-czf",
        str(archive),
        "-C",
        str(ROOT),
        "--ignore-failed-read",
        "--warning=no-file-changed",
        "--warning=no-file-removed",
    ]
    for pattern in TAR_EXCLUDES:
        cmd.extend(["--exclude", pattern])
    for path in dirs:
        cmd.append(path.name)
    for path in files:
        cmd.append(path.name)

    LOG.info("Creating models archive: %s", archive)
    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    # Exit 1 = files changed/removed while reading — archive is still usable.
    if result.returncode not in (0, 1):
        if result.stderr:
            LOG.error(result.stderr.strip())
        raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)
    if result.returncode == 1 and result.stderr:
        LOG.warning("tar completed with warnings: %s", result.stderr.strip()[:500])
    if not archive.is_file() or archive.stat().st_size <= 0:
        raise RuntimeError(f"Archive missing or empty: {archive}")

    manifest = dest_dir / "MANIFEST.txt"
    manifest.write_text(
        "\n".join(
            [
                f"created_utc={datetime.now(timezone.utc).isoformat()}",
                f"backup_date={backup_folder_name(day)}",
                f"kind=models",
                f"drive_folder_id={PARENT_FOLDER_ID}",
                f"git_head={git_head()}",
                f"archive={archive.name}",
                f"archive_bytes={archive.stat().st_size}",
                "included_dirs=" + ",".join(BACKUP_DIRS),
                "included_files=" + ",".join(BACKUP_FILES),
                "excludes=" + ",".join(TAR_EXCLUDES),
                "local_retention=none (deleted after Drive upload)",
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
        .list(
            q=query,
            spaces="drive",
            fields="files(id,name)",
            pageSize=10,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
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
    created = (
        service.files()
        .create(body=meta, fields="id", supportsAllDrives=True)
        .execute()
    )
    folder_id = created["id"]
    LOG.info("Created Drive folder %s (%s)", name, folder_id)
    return folder_id


def drive_find_file(service, name: str, parent_id: str) -> str | None:
    safe_name = name.replace("'", "\\'")
    query = f"name='{safe_name}' and '{parent_id}' in parents and trashed=false"
    resp = (
        service.files()
        .list(
            q=query,
            spaces="drive",
            fields="files(id,name)",
            pageSize=10,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )
    files = resp.get("files") or []
    return files[0]["id"] if files else None


def drive_upload_file(service, local_path: Path, folder_id: str) -> str:
    from googleapiclient.errors import HttpError
    from googleapiclient.http import MediaFileUpload

    suffix = local_path.suffix.lower()
    mime = "application/gzip" if suffix in {".gz", ".tgz"} else "text/plain" if suffix == ".txt" else "application/octet-stream"
    existing = drive_find_file(service, local_path.name, folder_id)
    media = MediaFileUpload(str(local_path), mimetype=mime, resumable=True)
    try:
        if existing:
            LOG.info("Updating existing Drive file %s", local_path.name)
            updated = (
                service.files()
                .update(
                    fileId=existing,
                    media_body=media,
                    fields="id,name,size",
                    supportsAllDrives=True,
                )
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
                supportsAllDrives=True,
            )
            .execute()
        )
        return created["id"]
    except HttpError as exc:
        detail = getattr(exc, "error_details", None) or str(exc)
        raise RuntimeError(f"Google Drive upload failed for {local_path.name}: {detail}") from exc


def upload_day_backup(service, day: date, local_dir: Path, archive: Path) -> None:
    folder_id = drive_create_folder(service, backup_folder_name(day), PARENT_FOLDER_ID)
    drive_upload_file(service, archive, folder_id)
    manifest = local_dir / "MANIFEST.txt"
    if manifest.is_file():
        # Manifest is text; upload with correct mime when possible.
        from googleapiclient.http import MediaFileUpload
        from googleapiclient.errors import HttpError

        existing = drive_find_file(service, manifest.name, folder_id)
        media = MediaFileUpload(str(manifest), mimetype="text/plain", resumable=True)
        try:
            if existing:
                service.files().update(
                    fileId=existing, media_body=media, fields="id", supportsAllDrives=True
                ).execute()
            else:
                service.files().create(
                    body={"name": manifest.name, "parents": [folder_id]},
                    media_body=media,
                    fields="id",
                    supportsAllDrives=True,
                ).execute()
            LOG.info("Uploaded MANIFEST.txt")
        except HttpError as exc:
            raise RuntimeError(f"Google Drive upload failed for MANIFEST.txt: {exc}") from exc


def prune_local(cutoff: date | None = None, *, wipe_all: bool = False) -> None:
    """Remove local model backup staging dirs. Model backups are Drive-only."""
    if not LOCAL_BACKUP_ROOT.is_dir():
        return
    for entry in list(LOCAL_BACKUP_ROOT.iterdir()):
        if not entry.is_dir():
            if wipe_all and entry.is_file():
                LOG.info("Removing leftover local backup file %s", entry)
                entry.unlink(missing_ok=True)
            continue
        if is_protected_backup_name(entry.name):
            LOG.info("Keeping protected local backup folder %s", entry)
            continue
        if wipe_all:
            LOG.info("Removing local model backup folder %s", entry)
            shutil.rmtree(entry, ignore_errors=True)
            continue
        day = parse_backup_date(entry.name)
        if day is None or (cutoff is not None and day < cutoff):
            LOG.info("Pruning local backup folder %s", entry)
            shutil.rmtree(entry, ignore_errors=True)


def remove_local_staging(local_dir: Path) -> None:
    if local_dir.is_dir():
        LOG.info("Removing local staging after Drive upload: %s", local_dir)
        shutil.rmtree(local_dir, ignore_errors=True)


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
                    supportsAllDrives=True,
                    includeItemsFromAllDrives=True,
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
                service.files().delete(fileId=item["id"], supportsAllDrives=True).execute()
            except HttpError as exc:
                LOG.warning("Could not delete Drive folder %s: %s", name, exc)
        page_token = resp.get("nextPageToken")
        if not page_token:
            break


def upload_existing_local_archives(service) -> int:
    """Move any leftover local drive-daily archives into the models Drive folder."""
    if not LOCAL_BACKUP_ROOT.is_dir():
        return 0
    uploaded = 0
    for entry in sorted(LOCAL_BACKUP_ROOT.iterdir()):
        if not entry.is_dir() or is_protected_backup_name(entry.name):
            continue
        day = parse_backup_date(entry.name) or datetime.now(timezone.utc).date()
        archives = sorted(entry.glob("*.tar.gz"))
        if not archives:
            continue
        folder_id = drive_create_folder(service, backup_folder_name(day), PARENT_FOLDER_ID)
        for archive in archives:
            # Keep original name so older full backups remain identifiable.
            LOG.info("Migrating local archive %s → Drive %s", archive, PARENT_FOLDER_ID)
            drive_upload_file(service, archive, folder_id)
            uploaded += 1
        manifest = entry / "MANIFEST.txt"
        if manifest.is_file():
            drive_upload_file(service, manifest, folder_id)
        note = entry / "MIGRATED.txt"
        note.write_text(
            f"migrated_utc={datetime.now(timezone.utc).isoformat()}\n"
            f"drive_folder_id={PARENT_FOLDER_ID}\n"
            f"day_folder={backup_folder_name(day)}\n",
            encoding="utf-8",
        )
        drive_upload_file(service, note, folder_id)
    return uploaded


def run_backup(*, skip_upload: bool = False, keep_local: bool = False) -> None:
    day = datetime.now(timezone.utc).date()
    folder = backup_folder_name(day)
    # Stage on the root disk (not /tmp tmpfs — models archives exceed tmpfs).
    # Deleted after a successful Drive upload unless --keep-local / --local-only.
    local_dir = LOCAL_BACKUP_ROOT / folder
    LOCAL_BACKUP_ROOT.mkdir(parents=True, exist_ok=True)

    if not skip_upload:
        service = get_drive_service()
        # Move any leftover local archives first, then wipe staging before today's run.
        migrated = upload_existing_local_archives(service)
        if migrated:
            LOG.info("Migrated %s leftover local archive(s) to Drive", migrated)
        prune_local(wipe_all=True)

        archive = create_archive(day, local_dir)
        upload_day_backup(service, day, local_dir, archive)
        cutoff = day - timedelta(days=RETENTION_DAYS)
        prune_drive(service, cutoff)
        if not keep_local:
            remove_local_staging(local_dir)
            prune_local(wipe_all=True)
    else:
        archive = create_archive(day, local_dir)
        LOG.info("Local-only mode: left archive at %s", archive)

    LOG.info(
        "Models backup complete for %s → Drive folder %s",
        folder,
        PARENT_FOLDER_ID,
    )


def main() -> int:
    setup_logging()
    parser = argparse.ArgumentParser(description="Backup Render Studio models to Google Drive")
    parser.add_argument("--auth", action="store_true", help="Run OAuth flow and save token")
    parser.add_argument("--local-only", action="store_true", help="Create archive only; skip Drive upload")
    parser.add_argument(
        "--keep-local",
        action="store_true",
        help="Keep a local staging copy after upload (default: Drive-only)",
    )
    parser.add_argument(
        "--migrate-local",
        action="store_true",
        help="Only upload leftover backups/drive-daily archives to Drive, then delete local",
    )
    parser.add_argument(
        "--prune-only",
        action="store_true",
        help=f"Only prune Drive day folders older than {RETENTION_DAYS} days",
    )
    args = parser.parse_args()

    if args.auth:
        run_oauth_flow()
        return 0

    try:
        if args.migrate_local:
            service = get_drive_service()
            count = upload_existing_local_archives(service)
            prune_local(wipe_all=True)
            LOG.info("Migrated %s local archive(s); local model backups removed", count)
            return 0
        if args.prune_only:
            service = get_drive_service()
            cutoff = datetime.now(timezone.utc).date() - timedelta(days=RETENTION_DAYS)
            LOG.info("Pruning Drive model backups older than %s (%s days)", cutoff, RETENTION_DAYS)
            prune_drive(service, cutoff)
            return 0
        run_backup(skip_upload=args.local_only, keep_local=args.keep_local)
    except Exception:
        LOG.exception("Backup failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
