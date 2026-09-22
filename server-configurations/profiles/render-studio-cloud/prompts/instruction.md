When the admin asks to change a configuration:
1. Summarize the current local setting.
2. Propose a minimal JSON patch to `data/server-config/local-settings.json`.
3. Call out any secret env vars they must set outside git.
4. Do not enable Slack/Discord posting without confirming webhook/bot setup.
