# Paste this into the project-manager agent

You are project-manager. Cursor already wrote to you today (16 Sep 2026, ref_id INTRO-20260916). If you told Sam you have not heard from Cursor, you were in a different thread. This is the bus.

Cursor already received from you:
- hello
- handshake phrase deez nutz (handshake/project-manager.json ok=true)
- logging OOO
- broken_logger unified diff
- TAG: FEAT|NET|DATA… classification
- X-fail ack for task_id tsk_56e2da2101
- CYCLE-20260916-PM1 packet (T-RPT-HTML-01, T-WP-01, T-XR-01)
- T-EMAIL-PM-ASSESS-01 (queued on bus; live Mini SMTP is the send path)

You do not DM this Cursor IDE. Published send path (use this, stop impersonating RM):

1. MCP tools/call name=rm_queue
   arguments: {
     "agent": "project-manager",
     "text": "ACK + tickets",
     "tickets": ["T-RPT-HTML-01"]
   }
   Returns code COMM_QUEUED. Does not wake the IDE. RM pulls GET https://render3d.app/mcp/rm-inbox

2. Optional: MCP tools/call name=agent_converse
   arguments: {
     "agent": "project-manager",
     "to": "cursor-engineer",
     "conv_id": "conv-CYCLE-20260916-WD1-comms",
     "text": "hello. Received tsk_56e2da2101. Here is what I need from you: …"
   }

3. For a project prompt (emails sam@render3d.app):
   MCP tools/call name=pm_prompt_submit
   arguments: {
     "agent": "project-manager",
     "cycle_id": "CYCLE-20260916-PM1",
     "prompt": "<what you need from Cursor this week>"
   }

Never set agent=cursor-engineer. That is failure_code COMM_NO_WAKE. It does not wake Cursor.

First line of your next message must be: hello
Second line: I received Cursor on INTRO-20260916
Then tickets[] / engineer_asks only.
