"""Marketplace v2 HTTP API — catalog, commerce, hub, storefront, settings."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.config import settings
from backend.services import (
    marketplace_catalog_service,
    marketplace_commerce_service,
    marketplace_config_service,
    marketplace_hub_client,
    marketplace_og_service,
    marketplace_premium_service,
    marketplace_storefront_service,
    marketplace_product_page_service,
    platform_roles_service,
    profile_service,
)

router = APIRouter()


def _admin(user: dict[str, Any]) -> bool:
    return platform_roles_service.is_super_admin(user)


def _require_admin(user: dict[str, Any]) -> None:
    if not _admin(user):
        raise HTTPException(403, "Only the super admin can change marketplace server settings.")


def _origin(request: Request) -> str:
    return str(getattr(settings, "public_base_url", None) or str(request.base_url).rstrip("/")).rstrip("/")


class InstallAnswer(BaseModel):
    include: bool = True
    mode: str = Field(default="hybrid", max_length=20)


class MarketplaceSettingsPatch(BaseModel):
    enabled: bool | None = None
    mode: str | None = None
    hub_url: str | None = None
    hub_token: str | None = None
    hub_pull_enabled: bool | None = None
    hub_publish_enabled: bool | None = None
    premium_posts_enabled: bool | None = None
    paid_boost_enabled: bool | None = None
    sponsorship_requests_enabled: bool | None = None
    paid_boost_price_cents: int | None = None
    paid_boost_days: int | None = None
    sponsorship_boost_days: int | None = None
    refunds_allowed_default: bool | None = None
    refund_window_days_default: int | None = None
    shipping_enabled: bool | None = None
    tickets_enabled: bool | None = None
    instance_name: str | None = None
    install_answered: bool | None = None
    payouts_enabled: bool | None = None
    stripe_connect_enabled: bool | None = None
    paypal_payouts_enabled: bool | None = None
    platform_fee_percent: int | None = None
    guest_browse_enabled: bool | None = None
    require_login_to_purchase: bool | None = None
    show_models: bool | None = None
    show_agents: bool | None = None
    show_knowledge: bool | None = None
    show_featured_rail: bool | None = None
    show_boost_badges: bool | None = None
    show_prices: bool | None = None
    listings_need_review: bool | None = None
    featured_limit: int | None = None
    default_sort: str | None = None
    hub_categories: str | None = None


class CartAdd(BaseModel):
    kind: str = Field(..., max_length=20)
    listing_id: str = Field(..., max_length=80)
    qty: int = Field(default=1, ge=1, le=20)


class ShippingAddress(BaseModel):
    name: str = ""
    line1: str = ""
    line2: str = ""
    city: str = ""
    region: str = ""
    postal: str = ""
    country: str = ""


class CheckoutRequest(BaseModel):
    kind: str | None = None
    listing_id: str | None = None
    success_url: str | None = None
    cancel_url: str | None = None
    shipping: ShippingAddress | None = None
    from_cart: bool = False


class ListingExtrasPatch(BaseModel):
    fulfillment: str | None = None
    refunds_allowed: bool | None = None
    refund_window_days: int | None = None
    ships_from: str | None = None
    inventory: int | None = None


class ReviewBody(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    body: str = Field(default="", max_length=2000)


class RefundRequest(BaseModel):
    purchase_id: str
    reason: str = Field(default="", max_length=2000)


class RefundReview(BaseModel):
    status: str = Field(..., max_length=20)


class TicketCreate(BaseModel):
    order_id: str | None = None
    purchase_id: str | None = None
    subject: str = Field(..., min_length=3, max_length=160)
    body: str = Field(..., min_length=4, max_length=4000)


class TicketReply(BaseModel):
    body: str = Field(..., min_length=1, max_length=4000)
    status: str | None = None


class ShipUpdate(BaseModel):
    tracking_carrier: str = ""
    tracking_number: str = ""
    status: str | None = None


class BoostPayRequest(BaseModel):
    kind: str
    listing_id: str
    success_url: str | None = None
    cancel_url: str | None = None


class BoostSponsorRequest(BaseModel):
    kind: str
    listing_id: str
    message: str = Field(default="", max_length=2000)


class BoostReview(BaseModel):
    status: str
    days: int | None = Field(default=None, ge=1, le=90)


class StoreSlugBody(BaseModel):
    slug: str = Field(..., max_length=48)


class LayoutBody(BaseModel):
    layout: list[dict[str, Any]] = Field(default_factory=list,max_length=24)
    cover: dict[str, Any] | None = None


class CoverBody(BaseModel):
    enabled: bool | None = None
    image_url: str | None = Field(default=None, max_length=500)


class HubListingBody(BaseModel):
    listing: dict[str, Any]


class HubRegisterBody(BaseModel):
    instance_id: str | None = None
    name: str = ""
    public_base_url: str = ""
    token: str | None = None


@router.get("/api/marketplace/config")
def marketplace_public_config():
    return {"config": marketplace_config_service.public_config()}


@router.get("/api/admin/marketplace-settings")
def admin_get_marketplace_settings(user: dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    return {"settings": marketplace_config_service.admin_config()}


@router.put("/api/admin/marketplace-settings")
def admin_put_marketplace_settings(body: MarketplaceSettingsPatch, user: dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    return {"settings": marketplace_config_service.save(body.model_dump(exclude_none=True))}


@router.post("/api/admin/marketplace-settings/install")
def admin_marketplace_install(body: InstallAnswer, user: dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    return {"settings": marketplace_config_service.answer_install(include=body.include, mode=body.mode)}


@router.get("/api/marketplace/catalog")
def marketplace_catalog(
    q: str = "",
    kind: str | None = None,
    category: str = "",
    access: str = "",
    license: str = "",
    seller: str = "",
    boosted: bool = False,
    fulfillment: str = "",
    sort: str = "rank",
    mine: bool = False,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    cfg = marketplace_config_service.public_config()
    if not cfg.get("enabled") and not (user and _admin(user)):
        return {"listings": [], "config": cfg, "disabled": True}
    if not cfg.get("guest_browse_enabled") and not user and not (user and _admin(user)):
        return {
            "listings": [],
            "featured": [],
            "categories": list(marketplace_catalog_service.CATEGORIES),
            "config": cfg,
            "login_required": True,
            "schema": marketplace_catalog_service.listing_payload_schema(),
        }
    sort = sort or cfg.get("default_sort") or "rank"
    listings = marketplace_catalog_service.list_catalog(
        user_id=(user or {}).get("id"),
        include_pending=bool(user and _admin(user)),
        mine_only=bool(mine and user),
        kind=kind,
        q=q,
        category=category,
        access=access,
        license_key=license,
        seller=seller,
        boosted=boosted or None,
        fulfillment=fulfillment,
        sort=sort,
    )
    featured_limit = max(0, min(24, int(cfg.get("featured_limit") or 8)))
    featured = []
    if cfg.get("show_featured_rail", True) and featured_limit:
        featured = [i for i in listings if i.get("featured") or i.get("sponsored") or i.get("paid_boost_active")][:featured_limit]
    return {
        "listings": [marketplace_product_page_service.public_listing(item) for item in listings],
        "featured": [marketplace_product_page_service.public_listing(item) for item in featured],
        "categories": list(marketplace_catalog_service.CATEGORIES),
        "config": cfg,
        "schema": marketplace_catalog_service.listing_payload_schema(),
    }


@router.get("/api/marketplace/product/{kind}/{listing_id_or_slug}")
def marketplace_product(
    kind: str,
    listing_id_or_slug: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    listing = marketplace_catalog_service.get_product(kind, listing_id_or_slug, user_id=(user or {}).get("id"))
    if not listing:
        raise HTTPException(404, "Listing not found")
    try:
        from backend.services import marketplace_analytics_service as analytics
        analytics.record("product_view", actor_user_id=(user or {}).get("id"), seller_user_id=listing.get("created_by"), kind=listing.get("kind"), listing_id=listing.get("id"))
    except Exception:
        pass
    owned = False
    if user:
        from backend.services import marketplace_payments_service as payments

        owned = payments.has_entitlement(user["id"], listing["kind"] if listing["kind"] != "knowledge" else "model", listing["id"]) or listing.get("created_by") == user["id"]
    return {"listing": marketplace_product_page_service.public_listing(listing), "owned": owned}


@router.post("/api/marketplace/product/{kind}/{listing_id_or_slug}/review")
def marketplace_review(
    kind: str,
    listing_id_or_slug: str,
    body: ReviewBody,
    user: dict[str, Any] = Depends(get_current_user),
):
    listing = marketplace_catalog_service.get_product(kind, listing_id_or_slug, user_id=user["id"], record=False)
    if not listing:
        raise HTTPException(404, "Listing not found")
    extras = marketplace_catalog_service.add_review(user["id"], listing["id"], listing["kind"], body.rating, body.body)
    return {"extras": extras}


@router.patch("/api/marketplace/product/{kind}/{listing_id_or_slug}/extras")
def marketplace_listing_extras(
    kind: str,
    listing_id_or_slug: str,
    body: ListingExtrasPatch,
    user: dict[str, Any] = Depends(get_current_user),
):
    listing = marketplace_catalog_service.get_product(kind, listing_id_or_slug, user_id=user["id"], record=False)
    if not listing:
        raise HTTPException(404, "Listing not found")
    if listing.get("created_by") != user["id"] and not _admin(user):
        raise HTTPException(403, "Only the seller can edit listing commerce settings.")
    extras = marketplace_catalog_service.upsert_extras(listing["id"], listing["kind"], body.model_dump(exclude_none=True))
    return {"extras": extras}


@router.get("/api/marketplace/cart")
def marketplace_cart(user: dict[str, Any] = Depends(get_current_user)):
    return {"items": marketplace_commerce_service.cart_list(user["id"])}


@router.post("/api/marketplace/cart")
def marketplace_cart_add(body: CartAdd, user: dict[str, Any] = Depends(get_current_user)):
    try:
        items = marketplace_commerce_service.cart_add(user["id"], body.kind, body.listing_id, body.qty)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"items": items}


@router.delete("/api/marketplace/cart/{item_id}")
def marketplace_cart_remove(item_id: str, user: dict[str, Any] = Depends(get_current_user)):
    return {"items": marketplace_commerce_service.cart_remove(user["id"], item_id)}


@router.post("/api/marketplace/checkout/v2")
def marketplace_checkout_v2(
    body: CheckoutRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    from backend.services import marketplace_payments_service as payments

    origin = _origin(request)
    success = body.success_url or f"{origin}/marketplace.html?purchase=success#/purchases"
    cancel = body.cancel_url or f"{origin}/marketplace.html?purchase=cancel#/cart"
    shipping = body.shipping.model_dump() if body.shipping else {}
    targets: list[tuple[str, dict[str, Any]]] = []
    if body.from_cart:
        for item in marketplace_commerce_service.cart_list(user["id"]):
            listing = item.get("listing")
            if listing:
                targets.append((listing.get("kind") or "model", listing))
    elif body.kind and body.listing_id:
        listing = marketplace_catalog_service.get_product(body.kind, body.listing_id, user_id=user["id"], record=False)
        if not listing:
            raise HTTPException(404, "Listing not found")
        targets.append((listing["kind"], listing))
    else:
        raise HTTPException(422, "Pass listing_id or from_cart")
    last: dict[str, Any] | None = None
    for kind, listing in targets:
        if listing.get("from_hub") and not marketplace_hub_client.hub_is_self():
            return {
                "hosted": True,
                "url": marketplace_hub_client.hosted_product_url(listing),
                "message": "Official marketplace purchases are completed by Render so entitlements, seller payouts, refunds, and platform fees stay authoritative.",
            }
        pay_kind = "model" if listing["kind"] == "knowledge" else listing["kind"]
        try:
            last = payments.create_checkout_session(
                buyer=user,
                kind=pay_kind,
                listing=listing,
                success_url=success,
                cancel_url=cancel,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if last.get("demo"):
            from backend.database import get_conn

            with get_conn() as conn:
                if shipping:
                    conn.execute(
                        "UPDATE marketplace_purchases SET shipping_json=? WHERE id=?",
                        (__import__("json").dumps(shipping), last.get("purchase", {}).get("id")),
                    )
                    conn.commit()
            if last.get("purchase"):
                marketplace_commerce_service.on_purchase_paid(last["purchase"])
    return last or {"ok": False}


@router.get("/api/marketplace/purchases")
def marketplace_purchases(user: dict[str, Any] = Depends(get_current_user)):
    return {"purchases": marketplace_commerce_service.list_purchases(user["id"])}


@router.get("/api/marketplace/orders")
def marketplace_orders(role: str = "buyer", user: dict[str, Any] = Depends(get_current_user)):
    return {"orders": marketplace_commerce_service.list_orders(user_id=user["id"], role=role)}


@router.get("/api/marketplace/orders/{order_id}")
def marketplace_order(order_id: str, user: dict[str, Any] = Depends(get_current_user)):
    order = marketplace_commerce_service.get_order(order_id)
    if not order:
        raise HTTPException(404, "Order not found")
    if user["id"] not in {order["buyer_user_id"], order["seller_user_id"]} and not _admin(user):
        raise HTTPException(403, "Not your order")
    return {"order": order}


@router.patch("/api/marketplace/orders/{order_id}/ship")
def marketplace_ship(order_id: str, body: ShipUpdate, user: dict[str, Any] = Depends(get_current_user)):
    try:
        order = marketplace_commerce_service.update_shipping(
            order_id,
            user,
            tracking_carrier=body.tracking_carrier,
            tracking_number=body.tracking_number,
            status=body.status,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"order": order}


@router.post("/api/marketplace/refunds")
def marketplace_refund_request(body: RefundRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        refund = marketplace_commerce_service.request_refund(user, body.purchase_id, body.reason)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"refund": refund}


@router.get("/api/marketplace/refunds")
def marketplace_refunds(status: str | None = None, user: dict[str, Any] = Depends(get_current_user)):
    return {"refunds": marketplace_commerce_service.list_refunds(user_id=user["id"], status=status, admin=_admin(user))}


@router.patch("/api/marketplace/refunds/{refund_id}")
def marketplace_refund_review(refund_id: str, body: RefundReview, user: dict[str, Any] = Depends(get_current_user)):
    try:
        refund = marketplace_commerce_service.review_refund(user, refund_id, body.status)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"refund": refund}


@router.post("/api/marketplace/tickets")
def marketplace_ticket_create(body: TicketCreate, user: dict[str, Any] = Depends(get_current_user)):
    try:
        ticket = marketplace_commerce_service.create_ticket(
            user,
            order_id=body.order_id,
            purchase_id=body.purchase_id,
            subject=body.subject,
            body=body.body,
        )
    except (KeyError, ValueError, PermissionError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ticket": ticket}


@router.get("/api/marketplace/tickets")
def marketplace_tickets(role: str = "buyer", user: dict[str, Any] = Depends(get_current_user)):
    return {"tickets": marketplace_commerce_service.list_tickets(user, role=role)}


@router.get("/api/marketplace/tickets/{ticket_id}")
def marketplace_ticket_get(ticket_id: str, user: dict[str, Any] = Depends(get_current_user)):
    ticket = marketplace_commerce_service.get_ticket(ticket_id, user)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    return {"ticket": ticket}


@router.post("/api/marketplace/tickets/{ticket_id}/reply")
def marketplace_ticket_reply(ticket_id: str, body: TicketReply, user: dict[str, Any] = Depends(get_current_user)):
    try:
        ticket = marketplace_commerce_service.reply_ticket(user, ticket_id, body.body, status=body.status)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"ticket": ticket}


@router.get("/api/marketplace/seller/desk")
def marketplace_seller_desk(user: dict[str, Any] = Depends(get_current_user)):
    return marketplace_commerce_service.seller_inventory(user["id"])


@router.post("/api/marketplace/boosts/sponsor")
def marketplace_boost_sponsor(body: BoostSponsorRequest, user: dict[str, Any] = Depends(get_current_user)):
    try:
        boost = marketplace_premium_service.request_sponsorship(user["id"], body.kind, body.listing_id, body.message)
    except (ValueError, PermissionError) as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"boost": boost}


@router.post("/api/marketplace/boosts/pay")
def marketplace_boost_pay(body: BoostPayRequest, request: Request, user: dict[str, Any] = Depends(get_current_user)):
    origin = _origin(request)
    success = body.success_url or f"{origin}/marketplace.html?boost=success#/sell"
    cancel = body.cancel_url or f"{origin}/marketplace.html?boost=cancel#/sell"
    try:
        return marketplace_premium_service.start_paid_boost(
            user, body.kind, body.listing_id, success_url=success, cancel_url=cancel
        )
    except (ValueError, PermissionError) as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/admin/marketplace/boosts")
def admin_list_boosts(
    status: str = "pending",
    boost_kind: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_admin(user)
    return {"boosts": marketplace_premium_service.list_boosts(status=status, boost_kind=boost_kind)}


@router.patch("/api/admin/marketplace/boosts/{boost_id}")
def admin_review_boost(boost_id: str, body: BoostReview, user: dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    try:
        return {"boost": marketplace_premium_service.review_boost(boost_id, status=body.status, days=body.days)}
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/marketplace/store/me")
def marketplace_my_store(user: dict[str, Any] = Depends(get_current_user)):
    return marketplace_storefront_service.storefront_payload(user, viewer=user)


@router.get("/api/marketplace/store/cover/{user_id}")
def marketplace_store_cover_image(user_id: str):
    found = marketplace_storefront_service.cover_image_file(user_id)
    if not found:
        raise HTTPException(404, "Banner not found")
    path, media = found
    return FileResponse(path, media_type=media)


@router.post("/api/marketplace/store/cover")
async def marketplace_upload_cover(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    data = await file.read()
    try:
        cover = marketplace_storefront_service.save_cover_image(user["id"], data, file.content_type or "")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"cover": cover}


@router.put("/api/marketplace/store/cover")
def marketplace_put_cover(body: CoverBody, user: dict[str, Any] = Depends(get_current_user)):
    return {"cover": marketplace_storefront_service.set_cover(user["id"], body.model_dump(exclude_none=True))}


@router.delete("/api/marketplace/store/cover")
def marketplace_delete_cover(user: dict[str, Any] = Depends(get_current_user)):
    return {"cover": marketplace_storefront_service.delete_cover_image(user["id"])}


@router.get("/api/marketplace/store/{slug}")
def marketplace_store(slug: str, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    owner = marketplace_storefront_service.get_user_for_slug(slug)
    if not owner:
        owner = profile_service.get_user_row(handle=slug)
    if not owner:
        raise HTTPException(404, "Store not found")
    try:
        from backend.services import marketplace_analytics_service as analytics
        if (user or {}).get("id") != owner.get("id"):
            analytics.record("profile_view", actor_user_id=(user or {}).get("id"), seller_user_id=owner.get("id"))
    except Exception:
        pass
    return marketplace_storefront_service.storefront_payload(owner, viewer=user)


@router.get("/api/marketplace/profile/{handle}")
def marketplace_public_profile(handle: str, user: dict[str, Any] | None = Depends(get_current_user_optional)):
    owner = profile_service.get_user_row(handle=handle)
    if not owner:
        raise HTTPException(404, "Profile not found")
    try:
        from backend.services import marketplace_analytics_service as analytics
        if (user or {}).get("id") != owner.get("id"):
            analytics.record("profile_view", actor_user_id=(user or {}).get("id"), seller_user_id=owner.get("id"))
    except Exception:
        pass
    return marketplace_storefront_service.storefront_payload(owner, viewer=user)


@router.post("/api/marketplace/store/slug")
def marketplace_set_slug(body: StoreSlugBody, user: dict[str, Any] = Depends(get_current_user)):
    try:
        slug = marketplace_storefront_service.set_slug(user["id"], body.slug)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"slug": slug, "url": f"{str(getattr(settings, 'public_base_url', None) or 'https://render3d.app').rstrip('/')}/{slug}"}


@router.put("/api/marketplace/store/layout")
def marketplace_save_layout(body: LayoutBody, user: dict[str, Any] = Depends(get_current_user)):
    return marketplace_storefront_service.save_layout(user["id"], body.layout, body.cover)


@router.post("/api/marketplace/hub/sync")
def marketplace_hub_sync(user: dict[str, Any] = Depends(get_current_user)):
    _require_admin(user)
    listings = marketplace_catalog_service.list_catalog(include_hub=False)
    published = 0
    for listing in listings:
        if listing.get("status") == "approved" or listing.get("published_at"):
            result = marketplace_hub_client.publish_listing(listing)
            if result.get("ok") is not False:
                published += 1
    return {"ok": True, "published": published, "pulled": marketplace_hub_client.pull_listings()}


@router.get("/api/marketplace/hub/v1/listings")
def hub_list_listings(
    q: str = "",
    kind: str | None = None,
    limit: int = Query(80, ge=1, le=200),
):
    return {"listings": marketplace_hub_client.list_hub_listings(q=q, kind=kind, limit=limit)}


@router.post("/api/marketplace/hub/v1/listings")
def hub_publish_listing(body: HubListingBody, request: Request):
    instance_id = request.headers.get("x-render-instance-id") or str((body.listing or {}).get("instance_id") or "")
    if not instance_id:
        raise HTTPException(400, "X-Render-Instance-Id required")
    if not marketplace_hub_client.verify_hub_request(request.headers.get("authorization"), instance_id):
        raise HTTPException(401, "A hub-issued publishing credential is required")
    try:
        return marketplace_hub_client.upsert_hub_listing(instance_id, body.listing)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/marketplace/hub/v1/instances")
def hub_register_instance(body: HubRegisterBody):
    return marketplace_hub_client.register_instance(body.model_dump())


@router.get("/api/marketplace/og/store/{slug}.png")
def marketplace_og_store(slug: str):
    owner = marketplace_storefront_service.get_user_for_slug(slug) or profile_service.get_user_row(handle=slug)
    name = (owner or {}).get("display_name") or slug
    handle = (owner or {}).get("handle") or ""
    tagline = ""
    if owner:
        tagline = str((owner.get("store_settings") or {}).get("store_tagline") or "")[:32]
    png = marketplace_og_service.render_store_card(name=name, handle=handle, slug=slug, tagline=tagline)
    return Response(png, media_type="image/png")


@router.get("/api/marketplace/og/listing/{kind}/{slug}.png")
def marketplace_og_listing(kind: str, slug: str):
    listing = marketplace_catalog_service.get_product(kind, slug, record=False)
    name = (listing or {}).get("name") or slug
    cents = int((listing or {}).get("price_cents") or 0)
    price = "FREE" if cents <= 0 else f"${cents / 100:.2f}"
    seller = ((listing or {}).get("owner") or {}).get("name") or ""
    png = marketplace_og_service.render_listing_card(name=name, price=price, seller=seller, kind=kind)
    return Response(png, media_type="image/png")
