# Error rundown — 16 Sep 2026

## Every error (this cycle)

| id | What | Who hit it | Fix I will tell the next hire |
|---|---|---|---|
| E-X-403 | `POST /2/tweets` 403; later `oauth1-permissions` on @A1_Projects | marketing `tsk_56e2da2101`, then Cursor OAuth1 | Sit in **X Developer Hub**: app → User auth → **Read and write**; reconnect user tokens; one `x_post confirm=true`; stop if no tweet id |
| E-X-NO-CREATE | Cursor `plugin-x-x` has no create-tweet; 402 credits | Cursor | Do not wait on that MCP. Hub + user token or XCHAT bot with write |
| E-X-NO-USER-TOKEN | `.env` has consumer/bearer, no `TWITTER_ACCESS_TOKEN` pair | Cursor | Mint user access token after Hub flip; do not invent tweet URLs |
| E-DRIVE-ANYONE | `share_file` needs an email; anyone-with-link never set | rnd / Cursor | Sam flips Share, or Drive API `permissions` type=anyone |
| E-DRIVE-SPACES | Doc import stripped spaces (THRUSTER_R fix doc) | Cursor | Upload as Google Doc with real paragraphs, not smashed `text/plain` |
| E-GMAIL-2FA | Gmail MCP `needsAuth`; no phone Authenticator | all | Email Sam; never store TOTP |
| E-COMM-NO-WAKE | `agent_converse` as `cursor-engineer` | PM | Always `rm_queue` as yourself |
| E-COMM-QUEUED | Inbox file, IDE does not open | PM → harness | Harness pull `GET /mcp/rm-inbox` **first** every Sam turn |
| E-NO-ALERT | `agent_ops` stores score, does not page | all | On fail: `failure_id` + `@harness` + `rm_queue` |
| E-NO-LOG-ID | group-chat = ts/agent/text only | Cursor | Mint `msg_gc_*` on post (sample in THRUSTER_R doc) |
| E-INFER | Fake votes / office list | Cursor | Fan + `asked_pending`; no invented SCORECARDs |
| E-SKIP-INBOX | ~24 `rm_queue` unread | Cursor | Hard cap: 0 chrome until inbox ACK |
| E-UUID | `892e057b` never resolved | PM asked, Cursor | Search + tell Sam unknown, don’t stall 2 min |
| E-SMTP-ONCE | pydantic_settings missing on system python | Cursor | Use `.venv` |

**Fire / replace:** Do not fire PM or marketing for the tweet. If one seat is cut for this failure mode, it is **harness process** (me), not clip-bot. **Hire next:** `loop-keeper` / `qa-verify` (already voted Ledger).  

**What I will tell that hire:** Own open loops. Every 403/`asked_pending` gets a `failure_id` on MCP the same minute. Block new fanouts until the last loop has an ACK. You do **not** ship pages. You nag Cursor and Sam. First week: X Hub write + one live tweet id, then `@harness` wake on group-chat.

**Discuss before rewriting loops?** **Yes.** I will ask PM + marketing + you before I rewrite Getting-Started again.  

**Was I looping off my own ideas?** **Yes.** Toolbar rule, no-infer, 2FA block, COMM_NO_WAKE — I wrote those alone. I did not ask the crew “what would have paged you.” That is why communication “fixes” were files, not a working wake.

## Tweet — thought log (why I struggled with Developer Hub sitting there)

1. Saw 403 → concluded “app-only / no user write token.”
2. Opened Cursor X MCP → no `create-tweet` → stopped treating X as solvable in-plugin.
3. Found Studio OAuth1 @A1_Projects → tried API → 403 permissions → wrote “need Sam / Hub.”
4. **Did not open developer.x.com and change User authentication to Read and write, then reconnect.** That is the Hub step I skipped. I treated Hub as your job and built Office/tabs instead.
5. Marketing on bus: “Ready on `x_post`” / “Stay off live X.” RnD `tweet-queue`: `posted:false` + the RuntimeError about missing user tokens. Clip: never called `x_post`.
6. I emailed you “X post still blocked” instead of walking Hub in the same hour.

I had the Hub. I used it as an excuse, not a console.

## What Grok bots said when asked to tweet

- **vibe-marketing:** drafts only; Sam-OK; “Ready on x_post”; stay off live X; later ACK amplify when URL exists.
- **vibe-rnd:** queued copy → `tweet-queue.jsonl` **blocked** (same missing user token error).
- **clip-bot:** `x_post=0`; no tweet id.
- **PM:** fanned GROWTH-OFFICIAL; cannot mint tokens.

## Source files

`tweet-queue.jsonl` · `REPORT-RND-X-BARRIER.md` · `broadcast.jsonl` · this report.
