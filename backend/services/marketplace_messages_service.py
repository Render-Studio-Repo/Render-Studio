"""Private marketplace conversations, separate from shared project chat."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from backend.database import get_conn
from backend.services import profile_service


class MessageLimit(ValueError):
    pass


def _schema(conn):
    conn.execute("""CREATE TABLE IF NOT EXISTS marketplace_direct_messages (
      id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL)""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_marketplace_dm_sender ON marketplace_direct_messages(sender_id, created_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_marketplace_dm_recipient ON marketplace_direct_messages(recipient_id, created_at)")
    conn.execute("""CREATE TABLE IF NOT EXISTS marketplace_dm_blocks (
      user_id TEXT NOT NULL, peer_id TEXT NOT NULL, PRIMARY KEY(user_id, peer_id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS marketplace_dm_reads (
      user_id TEXT NOT NULL, peer_id TEXT NOT NULL, read_at TEXT NOT NULL,
      PRIMARY KEY(user_id, peer_id))""")


def _person(user):
    return {"id": user["id"], "handle": user.get("handle") or "", "display_name": user.get("display_name") or "Creator", "avatar_url": user.get("avatar_url") or ""}


def _blocked(conn, user_id: str, peer_id: str) -> bool:
    return bool(conn.execute("SELECT 1 FROM marketplace_dm_blocks WHERE (user_id=? AND peer_id=?) OR (user_id=? AND peer_id=?)", (user_id, peer_id, peer_id, user_id)).fetchone())


def inbox(user_id: str) -> dict:
    with get_conn() as conn:
        _schema(conn)
        rows = conn.execute("""SELECT * FROM (
          SELECT *, CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END peer_id,
          ROW_NUMBER() OVER (PARTITION BY CASE WHEN sender_id=? THEN recipient_id ELSE sender_id END ORDER BY created_at DESC,id DESC) n
          FROM marketplace_direct_messages WHERE sender_id=? OR recipient_id=?)
          WHERE n=1 ORDER BY created_at DESC LIMIT 60""", (user_id,user_id,user_id,user_id)).fetchall()
        unread_rows=conn.execute("""SELECT message.sender_id peer_id,COUNT(*) unread_count
          FROM marketplace_direct_messages message
          LEFT JOIN marketplace_dm_reads reading
            ON reading.user_id=? AND reading.peer_id=message.sender_id
          WHERE message.recipient_id=? AND message.created_at>COALESCE(reading.read_at,'')
          GROUP BY message.sender_id""",(user_id,user_id)).fetchall()
    unread_by_peer={row["peer_id"]:int(row["unread_count"] or 0) for row in unread_rows}
    conversations=[]
    for row in rows:
        user=profile_service.get_user_row(row["peer_id"])
        if user:
            conversations.append({"peer":_person(user),"preview":row["body"][:180],"created_at":row["created_at"],"from_me":row["sender_id"]==user_id,"unread_count":unread_by_peer.get(row["peer_id"],0)})
    return {"conversations":conversations,"unread_count":sum(unread_by_peer.values())}


def unread(user_id: str) -> dict:
    with get_conn() as conn:
        _schema(conn)
        row=conn.execute("""SELECT COUNT(*) unread_count
          FROM marketplace_direct_messages message
          LEFT JOIN marketplace_dm_reads reading
            ON reading.user_id=? AND reading.peer_id=message.sender_id
          WHERE message.recipient_id=? AND message.created_at>COALESCE(reading.read_at,'')""",(user_id,user_id)).fetchone()
    return {"unread_count":int(row["unread_count"] or 0)}


def conversation(user_id: str, peer_id: str, before: str = "") -> dict:
    peer=profile_service.get_user_row(peer_id)
    if not peer:
        raise KeyError("Creator not found.")
    with get_conn() as conn:
        _schema(conn)
        # Both participant predicates are mandatory. Knowing a peer ID never grants another person's messages.
        rows=conn.execute("""SELECT id,sender_id,recipient_id,body,created_at FROM marketplace_direct_messages
          WHERE ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))
          AND (?='' OR created_at < ?) ORDER BY created_at DESC,id DESC LIMIT 80""", (user_id,peer_id,peer_id,user_id,before,before)).fetchall()
        blocked_by_me=bool(conn.execute("SELECT 1 FROM marketplace_dm_blocks WHERE user_id=? AND peer_id=?",(user_id,peer_id)).fetchone())
        blocked=_blocked(conn,user_id,peer_id)
        if not before:
            latest_received=next((row["created_at"] for row in rows if row["sender_id"]==peer_id),"")
            if latest_received:
                conn.execute("""INSERT INTO marketplace_dm_reads(user_id,peer_id,read_at) VALUES (?,?,?)
                  ON CONFLICT(user_id,peer_id) DO UPDATE SET read_at=MAX(read_at,excluded.read_at)""",(user_id,peer_id,latest_received))
                conn.commit()
    return {"peer":_person(peer),"messages":[{**dict(row),"from_me":row["sender_id"]==user_id} for row in reversed(rows)],"blocked":blocked,"blocked_by_me":blocked_by_me,"has_more":len(rows)==80}


def send(user_id: str, peer_id: str, body: str) -> dict:
    body=body.strip()
    if not body or len(body)>4000:
        raise ValueError("Write a message between 1 and 4,000 characters.")
    if user_id==peer_id:
        raise ValueError("Choose another creator to message.")
    if not profile_service.get_user_row(peer_id):
        raise KeyError("Creator not found.")
    now=datetime.now(timezone.utc)
    with get_conn() as conn:
        _schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        if _blocked(conn,user_id,peer_id):
            raise PermissionError("Messages are disabled for this conversation.")
        minute=(now-timedelta(minutes=1)).isoformat()
        day=(now-timedelta(days=1)).isoformat()
        count=conn.execute("SELECT COUNT(*) total,SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) recent FROM marketplace_direct_messages WHERE sender_id=? AND created_at>=?",(minute,user_id,day)).fetchone()
        if int(count["recent"] or 0)>=20 or int(count["total"])>=200:
            raise MessageLimit("Message limit reached. Please try again later.")
        message={"id":uuid.uuid4().hex,"sender_id":user_id,"recipient_id":peer_id,"body":body,"created_at":now.isoformat()}
        conn.execute("INSERT INTO marketplace_direct_messages (id,sender_id,recipient_id,body,created_at) VALUES (:id,:sender_id,:recipient_id,:body,:created_at)",message)
        conn.commit()
    return {"message":{**message,"from_me":True}}


def set_block(user_id: str, peer_id: str, blocked: bool) -> dict:
    if user_id==peer_id:
        raise ValueError("Choose another creator.")
    with get_conn() as conn:
        _schema(conn)
        if blocked:
            conn.execute("INSERT OR IGNORE INTO marketplace_dm_blocks (user_id,peer_id) VALUES (?,?)",(user_id,peer_id))
        else:
            conn.execute("DELETE FROM marketplace_dm_blocks WHERE user_id=? AND peer_id=?",(user_id,peer_id))
        conn.commit()
    return {"blocked":blocked}
