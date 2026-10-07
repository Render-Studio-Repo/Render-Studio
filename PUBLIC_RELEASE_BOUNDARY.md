# Public release boundary

This repository contains the installable Render Studio product and the controls required to manage one installation.

The public release must never contain hosted Render super admin code or runtime state. This includes the aggregate cross-instance dashboard, central marketplace moderation and catalog records, production operator identities, private server profiles, customer data, credentials, backups, logs, databases, projects, or production-only automation.

Public instance administrators may access only their current installation through `instance-management.html` and `/api/setup/instance-management`. Cross-instance registry, GitHub issue coordination, marketplace moderation, and global settings remain on the official hosted instance.

Every public push must pass `python3 scripts/public-release-audit.py`. Do not weaken or bypass that audit to publish a change. Add new production-only paths and identities to the audit before introducing them in the live workspace.
