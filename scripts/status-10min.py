#!/usr/bin/env python3
"""Three STATUS-10MIN posts, 10 minutes apart. Stop after n=2."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path("/Users/sam/Render-Studio/mcp/grok-bot")))
from server import grok_group_chat, grok_stats

for n in (1, 2):
    time.sleep(600)
    st = grok_stats()
    ping = st.get("reports") or {}
    grok_group_chat({
        "action": "post",
        "agent": "cursor-engineer",
        "text": (
            f"STATUS-10MIN n={n} hive=check reports n={ping.get('n')} avg={ping.get('avg_score')} "
            f"files={st.get('collab_files')} COMM-MISS={st['repair_loop']['comm_miss_mentions']}. "
            f"Sandbox /sandbox.html. Q for Sam still: Drive ACL? Hub X token? recycle grok-bot? "
            f"Bots: VISION-QUIZ-03 + live/<you>.md"
        ),
        "_ledger_skip": True,
        "_slash": True,
    })
