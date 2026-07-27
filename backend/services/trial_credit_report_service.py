"""Analytics + email digest for free signup ($10) Render Studio Key trial credits."""

from __future__ import annotations

import html
import json
import logging
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any
from zoneinfo import ZoneInfo

from backend.config import settings
from backend.database import get_conn
from backend.services.ai_credit_service import SIGNUP_TRIAL_CENTS

logger = logging.getLogger("render3d.trial_credit_report")

DEFAULT_TO = "sam@render3d.app"
REPORT_TZ = "America/New_York"


def smtp_configured() -> bool:
    return bool((settings.capacity_alert_smtp_user or "").strip() and (settings.capacity_alert_smtp_password or "").strip())


def _parse_iso(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _money(cents: int | float | None) -> str:
    return f"${(int(cents or 0) / 100):.2f}"


def _usd(cents: int | float | None) -> float:
    return round(int(cents or 0) / 100, 2)


def build_report(*, since: datetime | None = None, now: datetime | None = None) -> dict[str, Any]:
    """Aggregate free-signup trial credit grants and usage."""
    now = now or datetime.now(timezone.utc)
    since = since or (now - timedelta(days=3))

    with get_conn() as conn:
        accounts = conn.execute(
            """
            SELECT a.user_id, a.balance_cents, a.use_platform_key, a.trial_granted_at,
                   a.platform_provider, a.created_at,
                   u.email, u.display_name
            FROM ai_credit_accounts a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE a.trial_granted_at IS NOT NULL
              AND TRIM(COALESCE(a.trial_granted_at, '')) != ''
            ORDER BY a.trial_granted_at DESC
            """
        ).fetchall()

        trial_txns = conn.execute(
            """
            SELECT user_id, amount_cents, created_at
            FROM ai_credit_transactions
            WHERE kind = 'trial'
            """
        ).fetchall()

        usage_txns = conn.execute(
            """
            SELECT t.user_id, t.amount_cents, t.provider, t.model, t.project_id, t.created_at, t.meta_json
            FROM ai_credit_transactions t
            INNER JOIN ai_credit_accounts a ON a.user_id = t.user_id
            WHERE t.kind = 'usage'
              AND a.trial_granted_at IS NOT NULL
              AND TRIM(COALESCE(a.trial_granted_at, '')) != ''
            ORDER BY t.created_at DESC
            """
        ).fetchall()

    trial_granted_cents: dict[str, int] = {}
    for row in trial_txns:
        uid = str(row["user_id"])
        trial_granted_cents[uid] = trial_granted_cents.get(uid, 0) + int(row["amount_cents"] or 0)

    users: list[dict[str, Any]] = []
    provider_totals: dict[str, int] = {}
    model_totals: dict[str, int] = {}
    window_spent = 0
    lifetime_spent = 0
    grants_in_window = 0
    active_with_balance = 0
    depleted = 0

    usage_by_user: dict[str, list[Any]] = {}
    for row in usage_txns:
        usage_by_user.setdefault(str(row["user_id"]), []).append(row)

    for row in accounts:
        uid = str(row["user_id"])
        granted_at = _parse_iso(row["trial_granted_at"])
        granted_cents = trial_granted_cents.get(uid, SIGNUP_TRIAL_CENTS)
        balance = int(row["balance_cents"] or 0)
        rows = usage_by_user.get(uid, [])
        spent_life = 0
        spent_window = 0
        providers_used: set[str] = set()
        models_used: set[str] = set()
        for r in rows:
            amt = -int(r["amount_cents"] or 0)
            if amt <= 0:
                continue
            created = _parse_iso(r["created_at"])
            # Attribute only spend after the free trial was granted.
            if granted_at and created and created < granted_at:
                continue
            prov = str(r["provider"] or "unknown").lower() or "unknown"
            model = str(r["model"] or "unknown") or "unknown"
            providers_used.add(prov)
            models_used.add(model)
            spent_life += amt
            if created and created >= since:
                spent_window += amt
                provider_totals[prov] = provider_totals.get(prov, 0) + amt
                key = f"{prov}:{model}"
                model_totals[key] = model_totals.get(key, 0) + amt

        if granted_at and granted_at >= since:
            grants_in_window += 1
        if balance > 0:
            active_with_balance += 1
        else:
            depleted += 1

        lifetime_spent += spent_life
        window_spent += spent_window
        users.append(
            {
                "user_id": uid,
                "email": row["email"] or "",
                "display_name": row["display_name"] or "",
                "trial_granted_at": row["trial_granted_at"],
                "granted_cents": granted_cents,
                "balance_cents": balance,
                "spent_lifetime_cents": spent_life,
                "spent_window_cents": spent_window,
                "use_platform_key": bool(row["use_platform_key"]),
                "platform_provider": row["platform_provider"] or "",
                "providers": sorted(providers_used),
                "models": sorted(models_used),
            }
        )

    users.sort(key=lambda u: (u["spent_window_cents"], u["spent_lifetime_cents"]), reverse=True)

    return {
        "generated_at": now.isoformat(),
        "timezone": REPORT_TZ,
        "window_start": since.isoformat(),
        "window_end": now.isoformat(),
        "trial_amount_usd": _usd(SIGNUP_TRIAL_CENTS),
        "summary": {
            "trial_users": len(users),
            "grants_in_window": grants_in_window,
            "active_with_balance": active_with_balance,
            "depleted": depleted,
            "window_spent_cents": window_spent,
            "window_spent_usd": _usd(window_spent),
            "lifetime_spent_cents": lifetime_spent,
            "lifetime_spent_usd": _usd(lifetime_spent),
            "remaining_balance_cents": sum(int(u["balance_cents"]) for u in users),
            "remaining_balance_usd": _usd(sum(int(u["balance_cents"]) for u in users)),
            "granted_total_cents": sum(int(u["granted_cents"]) for u in users),
            "granted_total_usd": _usd(sum(int(u["granted_cents"]) for u in users)),
        },
        "providers_window": [
            {"provider": k, "spent_cents": v, "spent_usd": _usd(v)}
            for k, v in sorted(provider_totals.items(), key=lambda kv: kv[1], reverse=True)
        ],
        "models_window": [
            {"model": k, "spent_cents": v, "spent_usd": _usd(v)}
            for k, v in sorted(model_totals.items(), key=lambda kv: kv[1], reverse=True)[:20]
        ],
        "users": users,
    }


def render_report_email(report: dict[str, Any]) -> dict[str, str]:
    summary = report.get("summary") or {}
    tz = ZoneInfo(REPORT_TZ)
    window_start = _parse_iso(report.get("window_start"))
    window_end = _parse_iso(report.get("window_end"))
    start_label = window_start.astimezone(tz).strftime("%a %b %d, %Y %I:%M %p %Z") if window_start else "—"
    end_label = window_end.astimezone(tz).strftime("%a %b %d, %Y %I:%M %p %Z") if window_end else "—"
    subject = (
        f"Free trial credits report — "
        f"{summary.get('window_spent_usd', 0):.2f} spent "
        f"({summary.get('trial_users', 0)} trial users)"
    ).replace("  ", " ")

    provider_rows = "".join(
        f"<tr><td>{html.escape(p['provider'])}</td><td style='text-align:right'>{_money(p['spent_cents'])}</td></tr>"
        for p in (report.get("providers_window") or [])
    ) or "<tr><td colspan='2'>No usage in this window.</td></tr>"

    model_rows = "".join(
        f"<tr><td>{html.escape(m['model'])}</td><td style='text-align:right'>{_money(m['spent_cents'])}</td></tr>"
        for m in (report.get("models_window") or [])[:12]
    ) or "<tr><td colspan='2'>No model spend in this window.</td></tr>"

    user_rows = []
    for u in (report.get("users") or [])[:40]:
        name = html.escape(u.get("display_name") or "—")
        email = html.escape(u.get("email") or u.get("user_id") or "")
        user_rows.append(
            "<tr>"
            f"<td>{name}<br><span style='color:#9da7b3;font-size:12px'>{email}</span></td>"
            f"<td style='text-align:right'>{_money(u.get('spent_window_cents'))}</td>"
            f"<td style='text-align:right'>{_money(u.get('spent_lifetime_cents'))}</td>"
            f"<td style='text-align:right'>{_money(u.get('balance_cents'))}</td>"
            f"<td>{html.escape(', '.join(u.get('providers') or []) or '—')}</td>"
            "</tr>"
        )
    users_html = "".join(user_rows) or "<tr><td colspan='5'>No trial users yet.</td></tr>"

    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:860px;margin:0 auto;padding:24px;">
      <div style="padding:22px;border:1px solid #30363d;border-radius:18px;background:#161b22;">
        <h1 style="margin:0 0 8px;font-size:22px;">Free signup credit usage</h1>
        <p style="margin:0 0 16px;color:#9da7b3;line-height:1.5;">
          Render Studio Key trial (${report.get('trial_amount_usd', 10):.0f} at signup) — analytics for Sam.
          Window: <strong style="color:#e6edf3">{html.escape(start_label)}</strong>
          → <strong style="color:#e6edf3">{html.escape(end_label)}</strong>
        </p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
          <tr>
            <td style="padding:10px;border:1px solid #30363d;">Trial users<br><strong>{summary.get('trial_users', 0)}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">New grants (window)<br><strong>{summary.get('grants_in_window', 0)}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">Still have balance<br><strong>{summary.get('active_with_balance', 0)}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">Depleted<br><strong>{summary.get('depleted', 0)}</strong></td>
          </tr>
          <tr>
            <td style="padding:10px;border:1px solid #30363d;">Spent (window)<br><strong>{_money(summary.get('window_spent_cents'))}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">Spent (lifetime)<br><strong>{_money(summary.get('lifetime_spent_cents'))}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">Remaining balance<br><strong>{_money(summary.get('remaining_balance_cents'))}</strong></td>
            <td style="padding:10px;border:1px solid #30363d;">Granted total<br><strong>{_money(summary.get('granted_total_cents'))}</strong></td>
          </tr>
        </table>

        <h2 style="margin:18px 0 8px;font-size:16px;">Providers (this window)</h2>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
          <tr style="color:#9da7b3;text-align:left;"><th style="padding:6px;border-bottom:1px solid #30363d;">Provider</th><th style="padding:6px;border-bottom:1px solid #30363d;text-align:right;">Spend</th></tr>
          {provider_rows}
        </table>

        <h2 style="margin:18px 0 8px;font-size:16px;">Top models (this window)</h2>
        <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
          <tr style="color:#9da7b3;text-align:left;"><th style="padding:6px;border-bottom:1px solid #30363d;">Model</th><th style="padding:6px;border-bottom:1px solid #30363d;text-align:right;">Spend</th></tr>
          {model_rows}
        </table>

        <h2 style="margin:18px 0 8px;font-size:16px;">Trial users (by window spend)</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="color:#9da7b3;text-align:left;">
            <th style="padding:6px;border-bottom:1px solid #30363d;">User</th>
            <th style="padding:6px;border-bottom:1px solid #30363d;text-align:right;">Window</th>
            <th style="padding:6px;border-bottom:1px solid #30363d;text-align:right;">Lifetime</th>
            <th style="padding:6px;border-bottom:1px solid #30363d;text-align:right;">Left</th>
            <th style="padding:6px;border-bottom:1px solid #30363d;">Providers</th>
          </tr>
          {users_html}
        </table>
        <p style="margin:18px 0 0;color:#9da7b3;font-size:12px;line-height:1.45;">
          Scheduled Mon / Wed / Fri 9:00 AM America/New_York. Covers users who received the free $10 Render Studio Key trial at signup.
        </p>
      </div>
    </div>
  </body>
</html>"""

    text_lines = [
        "Free signup credit usage",
        f"Window: {start_label} → {end_label}",
        "",
        f"Trial users: {summary.get('trial_users', 0)}",
        f"New grants (window): {summary.get('grants_in_window', 0)}",
        f"Still have balance: {summary.get('active_with_balance', 0)}",
        f"Depleted: {summary.get('depleted', 0)}",
        f"Spent (window): {_money(summary.get('window_spent_cents'))}",
        f"Spent (lifetime): {_money(summary.get('lifetime_spent_cents'))}",
        f"Remaining balance: {_money(summary.get('remaining_balance_cents'))}",
        f"Granted total: {_money(summary.get('granted_total_cents'))}",
        "",
        "Providers (window):",
    ]
    for p in report.get("providers_window") or []:
        text_lines.append(f"  - {p['provider']}: {_money(p['spent_cents'])}")
    if not report.get("providers_window"):
        text_lines.append("  (none)")
    text_lines.append("")
    text_lines.append("Top trial users (window spend):")
    for u in (report.get("users") or [])[:25]:
        label = u.get("email") or u.get("display_name") or u.get("user_id")
        text_lines.append(
            f"  - {label}: window {_money(u.get('spent_window_cents'))}, "
            f"life {_money(u.get('spent_lifetime_cents'))}, left {_money(u.get('balance_cents'))}"
        )
    if not report.get("users"):
        text_lines.append("  (none yet)")
    text_lines.append("")
    text_lines.append("Scheduled Mon/Wed/Fri 9:00 AM America/New_York.")

    return {"subject": subject, "html": html_body, "text": "\n".join(text_lines)}


def send_report_email(
    report: dict[str, Any] | None = None,
    *,
    to_email: str = DEFAULT_TO,
) -> dict[str, Any]:
    report = report or build_report()
    to_email = (to_email or DEFAULT_TO).strip()
    template = render_report_email(report)
    if not smtp_configured():
        logger.info("Trial credit report not sent: SMTP is not configured.")
        return {"ok": False, "error": "smtp_not_configured", "template": template, "report": report}

    msg = EmailMessage()
    msg["Subject"] = template["subject"]
    msg["From"] = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = to_email
    msg.set_content(template["text"])
    msg.add_alternative(template["html"], subtype="html")

    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
        smtp.send_message(msg)
    return {
        "ok": True,
        "to": to_email,
        "subject": template["subject"],
        "summary": report.get("summary"),
    }


def default_window_start(now: datetime | None = None) -> datetime:
    """Previous Mon/Wed/Fri 9:00 AM ET (fallback ~3 days)."""
    now = now or datetime.now(timezone.utc)
    tz = ZoneInfo(REPORT_TZ)
    local = now.astimezone(tz)
    candidates: list[datetime] = []
    for days_back in range(1, 10):
        day = (local - timedelta(days=days_back)).replace(hour=9, minute=0, second=0, microsecond=0)
        if day.weekday() in {0, 2, 4}:  # Mon/Wed/Fri
            candidates.append(day.astimezone(timezone.utc))
            break
    return candidates[0] if candidates else (now - timedelta(days=3))
