"""Marketplace ranking, config, store slugs, and catalog helpers."""

from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from backend.database import get_conn, init_db
from backend.routers import marketplace_v2
from backend.services import (
    marketplace_catalog_service,
    marketplace_config_service,
    marketplace_hub_client,
    marketplace_ranking,
    marketplace_schema,
    marketplace_storefront_service,
    model_marketplace_service,
    profile_service,
)


class MarketplaceV2Tests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.db = self.data / "t.db"
        self.db_patch = patch("backend.database.DB_PATH", self.db)
        self.data_patch = patch("backend.services.marketplace_config_service.settings.data_dir", str(self.data))
        self.db_patch.start()
        self.data_patch.start()
        init_db()
        marketplace_schema.ensure_schema()

    def tearDown(self) -> None:
        self.db_patch.stop()
        self.data_patch.stop()
        self.tmp.cleanup()

    def test_ranking_sales_beat_fresh_sponsor(self) -> None:
        now = datetime(2026, 9, 8, tzinfo=timezone.utc)
        popular = {
            "sales_count": 40,
            "view_count": 200,
            "rating_avg": 4.6,
            "rating_count": 12,
            "published_at": (now - timedelta(days=20)).isoformat(),
            "boost_status": "none",
        }
        sponsored = {
            "sales_count": 0,
            "view_count": 10,
            "rating_count": 0,
            "published_at": now.isoformat(),
            "boost_status": "approved",
            "boost_kind": "sponsorship",
            "boosted_until": (now + timedelta(days=7)).isoformat(),
        }
        self.assertGreater(
            marketplace_ranking.score_listing(popular, now=now),
            marketplace_ranking.score_listing(sponsored, now=now),
        )

    def test_install_question_private_disables_hub(self) -> None:
        cfg = marketplace_config_service.answer_install(include=True, mode="private")
        self.assertEqual(cfg["mode"], "private")
        self.assertFalse(cfg["hub_pull_enabled"])
        self.assertFalse(cfg["hub_publish_enabled"])
        cfg = marketplace_config_service.answer_install(include=False, mode="public")
        self.assertFalse(cfg["enabled"])
        self.assertEqual(cfg["mode"], "private")

    def test_public_install_is_pull_only_until_hub_approval(self) -> None:
        with patch.object(marketplace_config_service, "_is_official_host", return_value=False):
            cfg = marketplace_config_service.answer_install(include=True, mode="public")
        self.assertTrue(cfg["hub_pull_enabled"])
        self.assertFalse(cfg["hub_publish_enabled"])

    def test_hub_publish_requires_configured_bearer_and_instance(self) -> None:
        secret = "issued-secret-for-instance-123456"
        marketplace_hub_client.register_instance({
            "instance_id": "instance-1",
            "instance_secret": secret,
            "name": "Shop",
        })
        self.assertTrue(marketplace_hub_client.verify_hub_request(f"Bearer {secret}", "instance-1"))
        self.assertFalse(marketplace_hub_client.verify_hub_request("Bearer wrong", "instance-1"))
        self.assertFalse(marketplace_hub_client.verify_hub_request(f"Bearer {secret}", ""))
        self.assertFalse(marketplace_hub_client.verify_hub_request(None, "instance-1"))

    def test_hub_publish_endpoint_fails_closed(self) -> None:
        body = marketplace_v2.HubListingBody(listing={"id": "part-1", "kind": "model"})
        request = SimpleNamespace(headers={"x-render-instance-id": "instance-1"})
        with patch.object(marketplace_hub_client, "verify_hub_request", return_value=False):
            with self.assertRaises(HTTPException) as raised:
                marketplace_v2.hub_publish_listing(body, request)
        self.assertEqual(raised.exception.status_code, 401)

    def test_public_hub_registration_never_returns_a_credential(self) -> None:
        registered = marketplace_hub_client.register_instance({
            "instance_id": "instance-1",
            "instance_secret": "secret-for-instance-1-123456",
            "name": "Shop",
        })
        self.assertEqual(registered["publishing"], "enabled")
        self.assertNotIn("token", registered)

    def test_instance_handle_is_unique_and_promotable(self) -> None:
        first = marketplace_hub_client.register_instance({
            "instance_id": "instance-1",
            "instance_secret": "secret-for-instance-1-123456",
            "name": "Sam Robotics",
            "public_handle": "sam-robotics",
        })
        self.assertEqual(first["public_handle"], "sam-robotics")
        self.assertFalse(marketplace_hub_client.instance_handle_availability("sam-robotics")["available"])
        self.assertTrue(marketplace_hub_client.instance_handle_availability("sam-robotics", instance_id="instance-1")["available"])
        with self.assertRaisesRegex(ValueError, "already taken"):
            marketplace_hub_client.register_instance({
                "instance_id": "instance-2",
                "instance_secret": "secret-for-instance-2-123456",
                "name": "Another shop",
                "public_handle": "sam-robotics",
            })

    def test_reserved_instance_handle_is_unavailable(self) -> None:
        result = marketplace_hub_client.instance_handle_availability("admin")
        self.assertFalse(result["available"])
        self.assertIn("reserved", result["reason"])

    def test_hub_credential_is_bound_to_one_instance(self) -> None:
        secret = "secret-for-instance-1-123456"
        marketplace_hub_client.register_instance({
            "instance_id": "instance-1",
            "instance_secret": secret,
            "name": "Shop",
        })
        self.assertTrue(marketplace_hub_client.verify_hub_request(f"Bearer {secret}", "instance-1"))
        self.assertFalse(marketplace_hub_client.verify_hub_request(f"Bearer {secret}", "instance-2"))
        self.assertFalse(marketplace_hub_client.verify_hub_request("Bearer wrong-secret-value-123456", "instance-1"))

    def test_hub_publish_rejects_private_or_draft_listing(self) -> None:
        with patch.object(
            marketplace_config_service,
            "ensure_instance_identity",
            return_value={"hub_publish_enabled": True, "mode": "public", "instance_id": "instance-1"},
        ):
            result = marketplace_hub_client.publish_listing({"id": "draft-1", "name": "Private draft"})
        self.assertEqual(result, {"ok": False, "error": "listing_not_public"})

    def test_hub_rejects_authenticated_nonpublic_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "explicitly public"):
            marketplace_hub_client.upsert_hub_listing(
                "instance-1",
                {"id": "draft-1", "kind": "model", "visibility": "private"},
            )

    def test_ecosystem_enrollment_sends_identity_without_project_data(self) -> None:
        captured = {}

        class Response:
            content = b"{}"
            def raise_for_status(self):
                return None
            def json(self):
                return {"ok": True, "publishing": "pending_approval"}

        class Client:
            def __init__(self, **_kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return None
            def post(self, _url, json):
                captured.update(json)
                return Response()

        cfg = {
            "enabled": True,
            "mode": "public",
            "instance_id": "instance-1",
            "instance_secret": "secret-for-instance-1-123456",
            "instance_name": "Shop",
        }
        with (
            patch.object(marketplace_config_service, "ensure_instance_identity", return_value=cfg),
            patch.object(marketplace_hub_client, "hub_is_self", return_value=False),
            patch("httpx.Client", Client),
        ):
            result = marketplace_hub_client.enroll_instance(public_network=False)
        self.assertTrue(result["ok"])
        self.assertEqual(captured["instance_id"], "instance-1")
        self.assertEqual(captured["name"], "Shop")
        self.assertEqual(captured["public_base_url"], "")
        self.assertTrue(captured["instance_secret"])

    def test_connected_instance_pulls_shared_hub_catalog(self) -> None:
        class Response:
            def raise_for_status(self):
                return None
            def json(self):
                return {"listings": [{"id": "shared-1", "kind": "model", "visibility": "public"}]}

        class Client:
            def __init__(self, **_kwargs):
                pass
            def __enter__(self):
                return self
            def __exit__(self, *_args):
                return None
            def get(self, _url, headers):
                self.headers = headers
                return Response()

        cfg = {"enabled": True, "mode": "public", "hub_pull_enabled": True}
        with (
            patch.object(marketplace_config_service, "load", return_value=cfg),
            patch.object(marketplace_hub_client, "hub_is_self", return_value=False),
            patch("httpx.Client", Client),
        ):
            listings = marketplace_hub_client.pull_listings()
        self.assertEqual(listings[0]["id"], "shared-1")

    def test_remote_hub_product_uses_authoritative_checkout_page(self) -> None:
        with patch.object(marketplace_hub_client, "_hub_url", return_value="https://render3d.app"):
            url = marketplace_hub_client.hosted_product_url({"kind": "model", "slug": "robot base"})
        self.assertEqual(url, "https://render3d.app/marketplace.html?kind=model&listing=robot%20base")

    def test_store_slug_reserved_and_unique(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u1", "a@example.com", "Ada", "x", now),
            )
            conn.commit()
        slug = marketplace_storefront_service.set_slug("u1", "og-store")
        self.assertEqual(slug, "og-store")
        with self.assertRaises(ValueError):
            marketplace_storefront_service.validate_slug("marketplace")
        owner = marketplace_storefront_service.get_user_for_slug("og-store")
        self.assertEqual(owner["id"], "u1")

    def test_view_and_sale_stats(self) -> None:
        marketplace_catalog_service.record_view("listing-1", "model")
        marketplace_catalog_service.record_sale("listing-1", "model", 2)
        extras = marketplace_catalog_service.extras_for("listing-1", "model")
        self.assertEqual(extras["view_count"], 1)
        self.assertEqual(extras["sales_count"], 2)

    def test_listing_payload_schema_has_kind(self) -> None:
        schema = marketplace_catalog_service.listing_payload_schema()
        self.assertIn("kind", schema["properties"])
        self.assertIn("id", schema["required"])

    def test_admin_prefs_persist_and_filter_kinds(self) -> None:
        saved = marketplace_config_service.save(
            {
                "show_agents": False,
                "show_featured_rail": False,
                "platform_fee_percent": 12,
                "payouts_enabled": True,
                "featured_limit": 3,
                "default_sort": "new",
                "hub_categories": "robots,parts",
            }
        )
        self.assertFalse(saved["show_agents"])
        self.assertFalse(saved["show_featured_rail"])
        self.assertEqual(saved["platform_fee_percent"], 12)
        self.assertEqual(saved["featured_limit"], 3)
        self.assertEqual(saved["default_sort"], "new")
        self.assertEqual(saved["hub_categories"], "robots,parts")
        self.assertNotIn("agent", marketplace_config_service.allowed_kinds())
        self.assertIn("model", marketplace_config_service.allowed_kinds())

    def test_partition_listings_skips_featured_from_catalog(self) -> None:
        listings = [
            {"id": "a", "name": "Alpha", "kind": "model"},
            {"id": "b", "name": "Beta", "kind": "agent", "featured": True},
            {"id": "c", "name": "Gamma", "kind": "model"},
        ]
        featured, catalog = marketplace_storefront_service.partition_listings(listings, ["a"])
        self.assertEqual([i["id"] for i in featured], ["a", "b"])
        self.assertEqual([i["id"] for i in catalog], ["c"])
        empty_featured, catalog_all = marketplace_storefront_service.partition_listings(listings, [])
        self.assertEqual([i["id"] for i in empty_featured], ["b"])
        self.assertEqual([i["id"] for i in catalog_all], ["a", "c"])

    def test_cover_toggle_persists_and_layout_does_not_wipe_it(self) -> None:
        saved = marketplace_storefront_service.save_layout(
            "u1",
            [{"id": "hero", "type": "hero", "visible": True, "label": "Hero"}],
            {"enabled": True, "image_url": "/api/marketplace/store/cover/u1"},
        )
        self.assertTrue(saved["cover"]["enabled"])
        self.assertEqual(saved["cover"]["image_url"], "/api/marketplace/store/cover/u1")
        preserved = marketplace_storefront_service.save_layout(
            "u1",
            [{"id": "hero", "type": "hero", "visible": True, "label": "Hero"}],
        )
        self.assertTrue(preserved["cover"]["enabled"])
        self.assertEqual(preserved["cover"]["image_url"], "/api/marketplace/store/cover/u1")
        hidden = marketplace_storefront_service.set_cover("u1", {"enabled": False})
        self.assertFalse(hidden["enabled"])
        self.assertEqual(hidden["image_url"], "/api/marketplace/store/cover/u1")
        public = marketplace_storefront_service.public_cover(hidden, is_self=False)
        self.assertFalse(public["enabled"])
        self.assertEqual(public["image_url"], "")
        owner = marketplace_storefront_service.public_cover(hidden, is_self=True)
        self.assertFalse(owner["enabled"])
        self.assertTrue(owner["image_url"])

    def test_cover_image_upload_enables_and_remove_clears(self) -> None:
        png = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
            "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082"
        )
        with patch.object(marketplace_storefront_service.settings, "data_dir", str(self.data)):
            cover = marketplace_storefront_service.save_cover_image("u1", png, "image/png")
            self.assertTrue(cover["enabled"])
            self.assertIn("/api/marketplace/store/cover/u1", cover["image_url"])
            found = marketplace_storefront_service.cover_image_file("u1")
            self.assertIsNotNone(found)
            self.assertTrue(found[0].is_file())
            removed = marketplace_storefront_service.delete_cover_image("u1")
            self.assertFalse(removed["enabled"])
            self.assertEqual(removed["image_url"], "")
            self.assertIsNone(marketplace_storefront_service.cover_image_file("u1"))

    def test_store_settings_merge_keeps_featured_ids(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u-store", "store@example.com", "Ada", "x", now),
            )
            conn.commit()
        profile_service.update_store_settings(
            "u-store",
            {"store_enabled": True, "store_title": "Ada's shop", "featured_listing_ids": ["abc"]},
        )
        profile_service.update_store_settings("u-store", {"store_title": "Ada store"})
        row = profile_service.get_user_row("u-store")
        self.assertEqual(row["store_settings"]["store_title"], "Ada store")
        self.assertEqual(row["store_settings"]["featured_listing_ids"], ["abc"])
        self.assertTrue(row["store_settings"]["store_enabled"])

    def test_owner_can_archive_listing(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?,?,?,?,?)",
                ("u-store", "store@example.com", "Ada", "x", now),
            )
            conn.commit()
        listing = model_marketplace_service.create_listing(
            "u-store",
            {
                "name": "Bracket",
                "tagline": "A useful bracket",
                "description": "Print-ready bracket from Studio",
                "access_mode": "free",
            },
        )
        self.assertEqual(listing["status"], "pending")
        updated = model_marketplace_service.update_listing("u-store", listing["id"], {"status": "archived"})
        self.assertEqual(updated["status"], "archived")
        with self.assertRaises(ValueError):
            model_marketplace_service.update_listing("u-store", listing["id"], {"status": "approved"})

    def test_normalize_cover_rejects_empty_placeholder(self) -> None:
        self.assertEqual(
            marketplace_storefront_service.normalize_cover({"enabled": True}),
            {"enabled": False, "image_url": ""},
        )
        self.assertEqual(
            marketplace_storefront_service.normalize_cover({"enabled": True, "image_url": "javascript:alert(1)"}),
            {"enabled": False, "image_url": ""},
        )


if __name__ == "__main__":
    unittest.main()
