"""Welcome email template and SMTP delivery for new Render Studio users."""

from __future__ import annotations

import html
import logging
import smtplib
from email.message import EmailMessage
from typing import Any

from backend.config import settings

logger = logging.getLogger("render3d.onboarding_email")

GETTING_STARTED_GIF = "https://render3d.app/assets/onboarding/text-to-cad-demo.gif"
KNOWLEDGE_GIF = "https://render3d.app/assets/onboarding/robot-motion-demo.gif"


def smtp_configured() -> bool:
    return bool((settings.capacity_alert_smtp_user or "").strip() and (settings.capacity_alert_smtp_password or "").strip())


def render_welcome_email(user: dict[str, Any]) -> dict[str, str]:
    name = html.escape(str(user.get("display_name") or "there"))
    subject = "Welcome to Render Studio - build your first model"
    links = {
        "Studio": "https://render3d.app/",
        "Getting Started": "https://render3d.app/getting-started.html",
        "Tips & Tricks": "https://render3d.app/getting-started.html#tips-library",
        "Docs": "https://render3d.app/getting-started.html",
        "Product Marketplace": "https://render3d.app/marketplace.html",
    }
    link_html = "".join(
        f'<a href="{url}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 13px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">{html.escape(label)}</a>'
        for label, url in links.items()
    )
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:720px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render3d-logo.png" alt="Render Studio" width="56" height="56" style="border-radius:14px;" />
        <h1 style="margin:18px 0 8px;font-size:28px;">Welcome to Render Studio, {name}.</h1>
        <p style="margin:0 0 16px;color:#9da7b3;line-height:1.55;">You can generate CAD models from text, edit parts in the viewport, organize files into projects, use knowledge bases for context, and publish products or agent apps in the marketplace.</p>
        <div style="margin:18px 0;">{link_html}</div>
        <h2 style="margin:24px 0 10px;font-size:18px;">Try these first</h2>
        <ol style="color:#c9d1d9;line-height:1.65;padding-left:22px;">
          <li>Open Studio and describe the part or assembly you want.</li>
          <li>Drop reference files or knowledge base docs into the prompt for better context.</li>
          <li>Use the Render Agent when you are stuck or want a walkthrough.</li>
          <li>Publish models, knowledge bases, or agent apps from Product Marketplace when you are ready.</li>
        </ol>
        <h2 style="margin:24px 0 10px;font-size:18px;">Quick demos</h2>
        <p style="margin:0 0 10px;color:#9da7b3;">A couple short GIFs to get you moving:</p>
        <a href="{GETTING_STARTED_GIF}" style="color:#58a6ff;">Generate your first CAD model</a><br />
        <img src="{GETTING_STARTED_GIF}" alt="Generate a model demo" style="width:100%;max-width:620px;margin:10px 0 18px;border-radius:14px;border:1px solid #30363d;" />
        <a href="{KNOWLEDGE_GIF}" style="color:#58a6ff;">Explore robot motion and rigging workflows</a><br />
        <img src="{KNOWLEDGE_GIF}" alt="Robot motion demo" style="width:100%;max-width:620px;margin:10px 0 18px;border-radius:14px;border:1px solid #30363d;" />
        <p style="margin:18px 0 0;color:#9da7b3;line-height:1.55;">Need help? Reply to this email or open Render Agent from the app.</p>
      </div>
    </div>
  </body>
</html>"""
    text_body = f"""Welcome to Render Studio, {user.get('display_name') or 'there'}.

Useful links:
- Studio: {links['Studio']}
- Getting Started: {links['Getting Started']}
- Tips & Tricks: {links['Tips & Tricks']}
- Docs: {links['Docs']}
- Product Marketplace: {links['Product Marketplace']}

Try these first:
1. Open Studio and describe the model you want.
2. Drop reference files or knowledge base docs into the prompt.
3. Use Render Agent when you want help.
4. Publish models, knowledge bases, or agent apps from Product Marketplace.

GIF demos:
- Generate your first CAD model: {GETTING_STARTED_GIF}
- Explore robot motion and rigging workflows: {KNOWLEDGE_GIF}
"""
    return {"subject": subject, "html": html_body, "text": text_body}


def send_welcome_email(user: dict[str, Any]) -> dict[str, Any]:
    email = str(user.get("email") or "").strip()
    if not email:
        return {"ok": False, "error": "missing_email"}
    if email.endswith("@social.render3d.local"):
        return {"ok": False, "error": "placeholder_social_email"}
    template = render_welcome_email(user)
    if not smtp_configured():
        logger.info("Welcome email not sent to %s: SMTP is not configured.", email)
        return {"ok": False, "error": "smtp_not_configured", "template": template}

    msg = EmailMessage()
    msg["Subject"] = template["subject"]
    msg["From"] = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = email
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
    return {"ok": True, "to": email}


def render_trial_credits_email(user: dict[str, Any]) -> dict[str, str]:
    name = html.escape(str(user.get("display_name") or "there"))
    subject = "You've got $10 in render credits"
    studio = "https://render3d.app/"
    html_body = f"""<!doctype html>
<html>
  <body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
    <div style="max-width:720px;margin:0 auto;padding:28px;">
      <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
        <img src="https://render3d.app/render3d-logo.png" alt="Render Studio" width="56" height="56" style="border-radius:14px;" />
        <h1 style="margin:18px 0 8px;font-size:26px;">Hi {name} — you have $10 for one week.</h1>
        <p style="margin:0 0 16px;color:#9da7b3;line-height:1.55;">
          We added <strong style="color:#e6edf3;">$10 in free trial credits</strong> to your account
          (one week only). That unlocks the temporary <strong style="color:#e6edf3;">Render Studio Key</strong>
          for OpenAI, Claude, and Kimi — no personal API key required.
        </p>
        <p style="margin:0 0 16px;color:#9da7b3;line-height:1.55;">
          If you don’t use them for a week, unused credits may be reclaimed for other new users.
          When the $10 is used up, the Render Studio Key disappears until you buy more credits (or add your own API key).
          Usage uses the same pricing as paid render credits (model cost + 15% markup).
        </p>
        <a href="{studio}" style="display:inline-block;margin:8px 0 18px;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">Open Studio</a>
        <h2 style="margin:18px 0 10px;font-size:18px;">Want more after the trial?</h2>
        <ol style="color:#c9d1d9;line-height:1.65;padding-left:22px;">
          <li>Open <strong>Account → AI &amp; billing</strong> (or the key picker next to Generate).</li>
          <li>Choose <strong>Buy</strong> under render credits and checkout with Stripe.</li>
          <li>Credits keep the Render Studio Key available for any supported model.</li>
        </ol>
        <p style="margin:18px 0 0;color:#9da7b3;line-height:1.55;">Prefer your own key? You can add OpenAI, Claude, Kimi, or Grok anytime in AI &amp; billing.</p>
      </div>
    </div>
  </body>
</html>"""
    text_body = f"""Hi {user.get('display_name') or 'there'} — you have $10 for one week.

We added $10 in free trial credits (one week only). That unlocks the temporary Render Studio Key for OpenAI, Claude, and Kimi — no personal API key required.

If you don't use them for a week, unused credits may be reclaimed for other new users. When the $10 is used up, the Render Studio Key disappears until you buy more credits (or add your own API key).

Open Studio: {studio}

Want more after the trial?
1. Open Account → AI & billing (or the key picker next to Generate).
2. Choose Buy under render credits and checkout with Stripe.
3. Credits keep the Render Studio Key available for any supported model.

Prefer your own key? Add OpenAI, Claude, Kimi, or Grok anytime in AI & billing.
"""
    return {"subject": subject, "html": html_body, "text": text_body}


def send_trial_credits_email(user: dict[str, Any]) -> dict[str, Any]:
    email = str(user.get("email") or "").strip()
    if not email:
        return {"ok": False, "error": "missing_email"}
    if email.endswith("@social.render3d.local"):
        return {"ok": False, "error": "placeholder_social_email"}
    template = render_trial_credits_email(user)
    if not smtp_configured():
        logger.info("Trial credits email not sent to %s: SMTP is not configured.", email)
        return {"ok": False, "error": "smtp_not_configured", "template": template}

    msg = EmailMessage()
    msg["Subject"] = template["subject"]
    msg["From"] = (settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = email
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
    return {"ok": True, "to": email}
