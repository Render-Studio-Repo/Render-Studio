"""Cart, checkout extras, orders, shipping, tickets, refunds, receipts."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.database import get_conn
from backend.services import marketplace_catalog_service, marketplace_config_service, marketplace_payments_service
from backend.services.marketplace_schema import ensure_schema

logger = logging.getLogger("render3d.marketplace_commerce")

ORDER_STATUSES = {
    "pending",
    "paid",
    "fulfilling",
    "shipped",
    "delivered",
    "completed",
    "cancelled",
    "refunded",
}
TICKET_STATUSES = {"open", "pending", "resolved", "closed"}
REFUND_STATUSES = {"requested", "approved", "rejected", "refunded"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _row(row: Any) -> dict[str, Any]:
    return dict(row) if row else {}


def get_listing_for_kind(kind: str, listing_id: str, *, user_id: str | None = None) -> dict[str, Any] | None:
    return marketplace_catalog_service.get_product(kind, listing_id, user_id=user_id, record=False)


def cart_list(user_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM marketplace_cart_items WHERE user_id=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        listing = get_listing_for_kind(row["kind"], row["listing_id"])
        if not listing:
            continue
        items.append(
            {
                "id": row["id"],
                "qty": int(row["qty"] or 1),
                "listing": listing,
            }
        )
    return items


def cart_add(user_id: str, kind: str, listing_id: str, qty: int = 1) -> list[dict[str, Any]]:
    ensure_schema()
    listing = get_listing_for_kind(kind, listing_id, user_id=user_id)
    if not listing:
        raise ValueError("Listing not found.")
    qty = max(1, min(20, int(qty or 1)))
    now = _now_iso()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id, qty FROM marketplace_cart_items WHERE user_id=? AND listing_id=? AND kind=?",
            (user_id, listing["id"], listing["kind"]),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE marketplace_cart_items SET qty=? WHERE id=?",
                (min(20, int(existing["qty"] or 1) + qty), existing["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO marketplace_cart_items (id, user_id, listing_id, kind, qty, created_at)
                VALUES (?,?,?,?,?,?)
                """,
                (str(uuid.uuid4())[:12], user_id, listing["id"], listing["kind"], qty, now),
            )
        conn.commit()
    return cart_list(user_id)


def cart_remove(user_id: str, item_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        conn.execute("DELETE FROM marketplace_cart_items WHERE id=? AND user_id=?", (item_id, user_id))
        conn.commit()
    return cart_list(user_id)


def cart_clear(user_id: str) -> None:
    ensure_schema()
    with get_conn() as conn:
        conn.execute("DELETE FROM marketplace_cart_items WHERE user_id=?", (user_id,))
        conn.commit()


def list_purchases(user_id: str) -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM marketplace_purchases
             WHERE buyer_user_id=?
             ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return [_decorate_purchase(dict(r)) for r in rows]


def _decorate_purchase(row: dict[str, Any]) -> dict[str, Any]:
    listing = get_listing_for_kind(row.get("kind") or "model", row.get("listing_id") or "")
    order = None
    if row.get("order_id"):
        order = get_order(row["order_id"])
    return {**row, "listing": listing, "order": order}


def get_order(order_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM marketplace_orders WHERE id=?", (order_id,)).fetchone()
        if not row:
            return None
        items = conn.execute("SELECT * FROM marketplace_order_items WHERE order_id=?", (order_id,)).fetchall()
    data = dict(row)
    data["items"] = [dict(i) for i in items]
    return data


def list_orders(*, user_id: str, role: str = "buyer") -> list[dict[str, Any]]:
    ensure_schema()
    col = "seller_user_id" if role == "seller" else "buyer_user_id"
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM marketplace_orders WHERE {col}=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [get_order(r["id"]) for r in rows if r]


def _create_order_from_purchase(purchase: dict[str, Any], listing: dict[str, Any], shipping: dict[str, Any] | None = None) -> dict[str, Any]:
    ensure_schema()
    fulfillment = str(listing.get("fulfillment") or "digital")
    status = "completed" if fulfillment == "digital" else "paid"
    now = _now_iso()
    order_id = str(uuid.uuid4())[:12]
    ship = shipping or {}
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_orders (
              id, purchase_id, buyer_user_id, seller_user_id, status, fulfillment,
              shipping_name, shipping_line1, shipping_line2, shipping_city, shipping_region,
              shipping_postal, shipping_country, notes, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                order_id,
                purchase.get("id"),
                purchase["buyer_user_id"],
                purchase["seller_user_id"],
                status,
                fulfillment,
                str(ship.get("name") or "")[:80],
                str(ship.get("line1") or "")[:120],
                str(ship.get("line2") or "")[:120],
                str(ship.get("city") or "")[:80],
                str(ship.get("region") or "")[:80],
                str(ship.get("postal") or "")[:20],
                str(ship.get("country") or "")[:40],
                "",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO marketplace_order_items (
              id, order_id, listing_id, kind, listing_slug, name, qty, price_cents, currency
            ) VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                str(uuid.uuid4())[:12],
                order_id,
                listing.get("id") or purchase.get("listing_id"),
                listing.get("kind") or purchase.get("kind") or "model",
                str(listing.get("slug") or purchase.get("listing_slug") or ""),
                str(listing.get("name") or "Listing")[:120],
                1,
                int(purchase.get("price_cents") or 0),
                str(purchase.get("currency") or "USD"),
            ),
        )
        conn.execute(
            "UPDATE marketplace_purchases SET order_id=? WHERE id=?",
            (order_id, purchase["id"]),
        )
        conn.commit()
    return get_order(order_id) or {"id": order_id}


def on_purchase_paid(purchase: dict[str, Any]) -> dict[str, Any]:
    """Called after Stripe (or demo) marks a purchase paid."""
    ensure_schema()
    if purchase.get("order_id"):
        return {"purchase": purchase, "order": get_order(purchase["order_id"])}
    listing = get_listing_for_kind(purchase.get("kind") or "model", purchase.get("listing_id") or "") or {
        "id": purchase.get("listing_id"),
        "kind": purchase.get("kind") or "model",
        "slug": purchase.get("listing_slug"),
        "name": purchase.get("listing_slug") or "Listing",
        "fulfillment": "digital",
    }
    marketplace_catalog_service.record_sale(listing["id"], listing.get("kind") or "model")
    try:
        from backend.services import marketplace_analytics_service
        marketplace_analytics_service.record_purchase(purchase, listing)
    except Exception:
        pass
    shipping = {}
    try:
        shipping = json.loads(purchase.get("shipping_json") or "{}")
    except Exception:
        shipping = {}
    order = _create_order_from_purchase(purchase, listing, shipping if isinstance(shipping, dict) else None)
    send_receipt(purchase, listing, order)
    try:
        from backend.services import marketplace_hub_client

        marketplace_hub_client.publish_approved_listing(listing)
    except Exception:
        pass
    cart_clear(purchase["buyer_user_id"])
    return {"purchase": purchase, "order": order}


def send_receipt(purchase: dict[str, Any], listing: dict[str, Any] | None, order: dict[str, Any] | None) -> dict[str, Any]:
    from backend.services import email_notification_service

    with get_conn() as conn:
        buyer = conn.execute("SELECT email, display_name FROM users WHERE id=?", (purchase["buyer_user_id"],)).fetchone()
    if not buyer or not buyer["email"]:
        return {"ok": False, "error": "no_buyer_email"}
    name = (listing or {}).get("name") or purchase.get("listing_slug") or "Marketplace item"
    cents = int(purchase.get("price_cents") or 0)
    dollars = f"${cents / 100:.2f}"
    order_id = (order or {}).get("id") or ""
    subject = f"Receipt — {name}"
    text = (
        f"Thanks for your purchase on Render Studio.\n\n"
        f"Item: {name}\nAmount: {dollars} {purchase.get('currency') or 'USD'}\n"
        f"Order: {order_id}\nPurchase: {purchase.get('id')}\n\n"
        f"Manage purchases: https://render3d.app/marketplace.html#/purchases\n"
    )
    html_body = f"""<!doctype html>
<html><body style="margin:0;background:#0d1117;color:#e6edf3;font-family:Inter,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:28px;">
    <div style="padding:24px;border:1px solid #30363d;border-radius:22px;background:linear-gradient(135deg,#161b22,#0d1117);">
      <p style="color:#ff8a33;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">Render Studio</p>
      <h1 style="margin:8px 0 12px;font-size:26px;">Receipt</h1>
      <p style="color:#9da7b3;">Thanks for buying <strong>{name}</strong>.</p>
      <p style="font-size:22px;font-weight:800;">{dollars}</p>
      <p style="color:#9da7b3;">Order {order_id or '—'}</p>
      <a href="https://render3d.app/marketplace.html#/purchases" style="display:inline-block;padding:12px 16px;border-radius:999px;background:#fb8500;color:#0d1117;text-decoration:none;font-weight:800;">View purchases</a>
    </div>
  </div>
</body></html>"""
    result = email_notification_service.send_email(
        to_email=buyer["email"],
        subject=subject,
        text=text,
        html_body=html_body,
        category="purchase_alerts",
        user_id=purchase["buyer_user_id"],
        skip_preferences=True,
    )
    if result.get("ok"):
        with get_conn() as conn:
            conn.execute(
                "UPDATE marketplace_purchases SET receipt_sent_at=? WHERE id=?",
                (_now_iso(), purchase["id"]),
            )
            conn.commit()
    return result


def update_shipping(order_id: str, user: dict[str, Any], *, tracking_carrier: str = "", tracking_number: str = "", status: str | None = None) -> dict[str, Any]:
    order = get_order(order_id)
    if not order:
        raise KeyError("Order not found")
    is_seller = order["seller_user_id"] == user["id"]
    from backend.services import platform_roles_service

    if not is_seller and not platform_roles_service.is_super_admin(user):
        raise PermissionError("Only the seller can update shipping.")
    now = _now_iso()
    next_status = str(status or order["status"]).strip().lower()
    if next_status not in ORDER_STATUSES:
        next_status = order["status"]
    shipped_at = order.get("shipped_at")
    delivered_at = order.get("delivered_at")
    if next_status == "shipped" and not shipped_at:
        shipped_at = now
    if next_status in {"delivered", "completed"}:
        delivered_at = delivered_at or now
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE marketplace_orders
               SET tracking_carrier=?, tracking_number=?, status=?, shipped_at=?, delivered_at=?, updated_at=?
             WHERE id=?
            """,
            (
                str(tracking_carrier or order.get("tracking_carrier") or "")[:80],
                str(tracking_number or order.get("tracking_number") or "")[:80],
                next_status,
                shipped_at,
                delivered_at,
                now,
                order_id,
            ),
        )
        conn.commit()
    return get_order(order_id) or order


def request_refund(user: dict[str, Any], purchase_id: str, reason: str = "") -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        purchase = conn.execute("SELECT * FROM marketplace_purchases WHERE id=?", (purchase_id,)).fetchone()
    if not purchase:
        raise KeyError("Purchase not found")
    purchase = dict(purchase)
    if purchase["buyer_user_id"] != user["id"]:
        raise PermissionError("Only the buyer can request a refund.")
    if purchase.get("status") != "paid":
        raise ValueError("Only paid purchases can be refunded.")
    listing = get_listing_for_kind(purchase.get("kind") or "model", purchase["listing_id"]) or {}
    cfg = marketplace_config_service.load()
    allowed = bool(listing.get("refunds_allowed", cfg.get("refunds_allowed_default", True)))
    window = int(listing.get("refund_window_days") if listing.get("refund_window_days") is not None else cfg.get("refund_window_days_default") or 14)
    paid_at = _parse(purchase.get("paid_at") or purchase.get("created_at"))
    if not allowed:
        raise ValueError("This seller does not allow refunds on this listing.")
    if window and paid_at and (_now() - paid_at) > timedelta(days=window):
        raise ValueError(f"The {window}-day refund window has closed.")
    now = _now_iso()
    refund_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT * FROM marketplace_refunds WHERE purchase_id=? AND status IN ('requested','approved')",
            (purchase_id,),
        ).fetchone()
        if existing:
            return dict(existing)
        conn.execute(
            """
            INSERT INTO marketplace_refunds (
              id, purchase_id, order_id, buyer_user_id, seller_user_id, amount_cents,
              status, reason, created_at
            ) VALUES (?,?,?,?,?,?,'requested',?,?)
            """,
            (
                refund_id,
                purchase_id,
                purchase.get("order_id"),
                purchase["buyer_user_id"],
                purchase["seller_user_id"],
                int(purchase.get("price_cents") or 0),
                str(reason or "")[:2000],
                now,
            ),
        )
        conn.execute(
            "UPDATE marketplace_purchases SET refund_status='requested' WHERE id=?",
            (purchase_id,),
        )
        conn.commit()
    return get_refund(refund_id) or {"id": refund_id, "status": "requested"}


def get_refund(refund_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM marketplace_refunds WHERE id=?", (refund_id,)).fetchone()
    return dict(row) if row else None


def list_refunds(*, user_id: str | None = None, status: str | None = None, admin: bool = False) -> list[dict[str, Any]]:
    ensure_schema()
    sql = "SELECT * FROM marketplace_refunds WHERE 1=1"
    params: list[Any] = []
    if not admin and user_id:
        sql += " AND (buyer_user_id=? OR seller_user_id=?)"
        params.extend([user_id, user_id])
    if status:
        sql += " AND status=?"
        params.append(status)
    sql += " ORDER BY created_at DESC"
    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def review_refund(user: dict[str, Any], refund_id: str, status: str) -> dict[str, Any]:
    refund = get_refund(refund_id)
    if not refund:
        raise KeyError("Refund not found")
    from backend.services import platform_roles_service

    is_admin = platform_roles_service.is_super_admin(user)
    if refund["seller_user_id"] != user["id"] and not is_admin:
        raise PermissionError("Only the seller or an admin can decide this refund.")
    status = str(status or "").strip().lower()
    if status not in {"approved", "rejected"}:
        raise ValueError("status must be approved or rejected")
    now = _now_iso()
    stripe_refund_id = None
    if status == "approved":
        stripe_refund_id = _stripe_refund(refund)
        final = "refunded" if stripe_refund_id or not marketplace_payments_service.configured() else "approved"
        with get_conn() as conn:
            conn.execute(
                """
                UPDATE marketplace_refunds
                   SET status=?, resolved_at=?, resolved_by=?, stripe_refund_id=?
                 WHERE id=?
                """,
                (final, now, user["id"], stripe_refund_id, refund_id),
            )
            conn.execute(
                "UPDATE marketplace_purchases SET refund_status=? WHERE id=?",
                (final, refund["purchase_id"]),
            )
            if refund.get("order_id"):
                conn.execute(
                    "UPDATE marketplace_orders SET status='refunded', updated_at=? WHERE id=?",
                    (now, refund["order_id"]),
                )
            conn.commit()
    else:
        with get_conn() as conn:
            conn.execute(
                "UPDATE marketplace_refunds SET status='rejected', resolved_at=?, resolved_by=? WHERE id=?",
                (now, user["id"], refund_id),
            )
            conn.execute(
                "UPDATE marketplace_purchases SET refund_status='rejected' WHERE id=?",
                (refund["purchase_id"],),
            )
            conn.commit()
    return get_refund(refund_id) or refund


def _stripe_refund(refund: dict[str, Any]) -> str | None:
    stripe = marketplace_payments_service._stripe()
    if not stripe:
        return "demo_refund"
    with get_conn() as conn:
        purchase = conn.execute("SELECT * FROM marketplace_purchases WHERE id=?", (refund["purchase_id"],)).fetchone()
    if not purchase:
        return None
    pi = purchase["stripe_payment_intent"]
    if not pi or str(purchase["stripe_session_id"] or "").startswith("demo_"):
        return "demo_refund"
    try:
        created = stripe.Refund.create(payment_intent=pi, amount=int(refund["amount_cents"]))
        return created.get("id") if isinstance(created, dict) else getattr(created, "id", None)
    except Exception as exc:
        logger.warning("Stripe refund failed: %s", exc)
        return None


def create_ticket(user: dict[str, Any], *, order_id: str | None = None, purchase_id: str | None = None, subject: str, body: str) -> dict[str, Any]:
    ensure_schema()
    subject = str(subject or "").strip()[:160]
    body = str(body or "").strip()[:4000]
    if len(subject) < 3:
        raise ValueError("Subject is required.")
    if len(body) < 4:
        raise ValueError("Describe the issue.")
    seller_id = ""
    buyer_id = user["id"]
    if order_id:
        order = get_order(order_id)
        if not order:
            raise KeyError("Order not found")
        if order["buyer_user_id"] != user["id"] and order["seller_user_id"] != user["id"]:
            raise PermissionError("Not your order.")
        seller_id = order["seller_user_id"]
        buyer_id = order["buyer_user_id"]
        purchase_id = purchase_id or order.get("purchase_id")
    elif purchase_id:
        with get_conn() as conn:
            purchase = conn.execute("SELECT * FROM marketplace_purchases WHERE id=?", (purchase_id,)).fetchone()
        if not purchase:
            raise KeyError("Purchase not found")
        purchase = dict(purchase)
        if purchase["buyer_user_id"] != user["id"] and purchase["seller_user_id"] != user["id"]:
            raise PermissionError("Not your purchase.")
        seller_id = purchase["seller_user_id"]
        buyer_id = purchase["buyer_user_id"]
        order_id = purchase.get("order_id")
    else:
        raise ValueError("Attach this ticket to an order or purchase.")
    now = _now_iso()
    ticket_id = str(uuid.uuid4())[:12]
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO marketplace_tickets (
              id, order_id, purchase_id, buyer_user_id, seller_user_id, subject, status, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,'open',?,?)
            """,
            (ticket_id, order_id, purchase_id, buyer_id, seller_id, subject, now, now),
        )
        conn.execute(
            "INSERT INTO marketplace_ticket_messages (id, ticket_id, user_id, body, created_at) VALUES (?,?,?,?,?)",
            (str(uuid.uuid4())[:12], ticket_id, user["id"], body, now),
        )
        conn.commit()
    return get_ticket(ticket_id, user) or {"id": ticket_id}


def get_ticket(ticket_id: str, user: dict[str, Any] | None = None) -> dict[str, Any] | None:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM marketplace_tickets WHERE id=?", (ticket_id,)).fetchone()
        if not row:
            return None
        messages = conn.execute(
            "SELECT * FROM marketplace_ticket_messages WHERE ticket_id=? ORDER BY created_at",
            (ticket_id,),
        ).fetchall()
    data = dict(row)
    if user:
        from backend.services import platform_roles_service

        if user["id"] not in {data["buyer_user_id"], data["seller_user_id"]} and not platform_roles_service.is_super_admin(user):
            return None
    data["messages"] = [dict(m) for m in messages]
    return data


def list_tickets(user: dict[str, Any], *, role: str = "buyer") -> list[dict[str, Any]]:
    ensure_schema()
    col = "seller_user_id" if role == "seller" else "buyer_user_id"
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM marketplace_tickets WHERE {col}=? ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


def reply_ticket(user: dict[str, Any], ticket_id: str, body: str, *, status: str | None = None) -> dict[str, Any]:
    ticket = get_ticket(ticket_id, user)
    if not ticket:
        raise KeyError("Ticket not found")
    body = str(body or "").strip()[:4000]
    if len(body) < 1:
        raise ValueError("Message required.")
    now = _now_iso()
    next_status = str(status or ticket["status"]).strip().lower()
    if next_status not in TICKET_STATUSES:
        next_status = ticket["status"]
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO marketplace_ticket_messages (id, ticket_id, user_id, body, created_at) VALUES (?,?,?,?,?)",
            (str(uuid.uuid4())[:12], ticket_id, user["id"], body, now),
        )
        conn.execute(
            "UPDATE marketplace_tickets SET status=?, updated_at=? WHERE id=?",
            (next_status, now, ticket_id),
        )
        conn.commit()
    return get_ticket(ticket_id, user) or ticket


def seller_inventory(user_id: str) -> dict[str, Any]:
    listings = marketplace_catalog_service.list_catalog(user_id=user_id, mine_only=True, include_hub=False)
    orders = list_orders(user_id=user_id, role="seller")
    tickets = list_tickets({"id": user_id}, role="seller")
    refunds = list_refunds(user_id=user_id)
    return {
        "listings": listings,
        "orders": orders,
        "tickets": tickets,
        "refunds": [r for r in refunds if r.get("seller_user_id") == user_id],
        "open_orders": sum(1 for o in orders if o and o.get("status") in {"paid", "fulfilling", "shipped"}),
        "open_tickets": sum(1 for t in tickets if t.get("status") in {"open", "pending"}),
    }
