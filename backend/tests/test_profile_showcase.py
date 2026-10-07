"""Public showcase privacy, persistence, concurrency, and private-message boundaries."""
from __future__ import annotations

import json
import sqlite3
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.auth import get_current_user, get_current_user_optional
from backend.routers.profile_showcase import router as profile_router
from backend.routers.marketplace_messages import router as message_router
from backend.services import profile_showcase_service as showcase, marketplace_messages_service as messages


@pytest.fixture
def environment(tmp_path):
    def conn():
        result=sqlite3.connect(tmp_path/"test.db")
        result.row_factory=sqlite3.Row
        return result
    users={k:{"id":k,"handle":k,"display_name":k.title(),"bio":"Creator biography","email":"private@example.com"} for k in ("alice","bob","eve")}
    catalog=[{"id":"robot","kind":"model","status":"approved","created_by":"alice","name":"Robot","slug":"robot-kit","files":[{"data_url":"secret-download"}],"thumbnail_url":"data:image/png;base64,YQ==","gallery":[{"url":"/api/projects/private/files/camera.png"},{"url":"https://cdn.example.com/render.png"}],"price_cents":1000},
             {"id":"skill","kind":"knowledge","status":"approved","created_by":"alice","name":"CAD Skill","body_md":"private-source","files":[{"ref":"/api/projects/private/source.py"}]},
             {"id":"unpublished","kind":"model","status":"pending","created_by":"alice","name":"Private Draft"},
             {"id":"other","kind":"model","status":"approved","created_by":"bob","name":"Other owner"}]
    def user(user_id=None,*,handle=None):return users.get(user_id or handle)
    with patch.object(showcase,"get_conn",conn),patch.object(messages,"get_conn",conn),patch("backend.services.profile_service.get_user_row",side_effect=user),patch.object(showcase.marketplace_catalog_service,"list_catalog",side_effect=lambda **kwargs:catalog):
        app=FastAPI();app.include_router(profile_router);app.include_router(message_router)
        identity={"id":"alice"}
        app.dependency_overrides[get_current_user]=lambda:identity
        app.dependency_overrides[get_current_user_optional]=lambda:identity
        yield users,catalog,TestClient(app),identity


def test_public_payload_never_copies_private_files(environment):
    users,_,_,_=environment
    data=showcase.payload(users["alice"])
    assert [i["id"] for i in data["listings"]]==["robot","skill"]
    encoded=json.dumps(data)
    assert "secret-download" not in encoded and "private-source" not in encoded
    assert "/api/projects/" not in encoded and "private@example.com" not in encoded
    assert len(data["listings"][0]["media"])==2
    assert not data["is_self"]


def test_model_without_uploaded_image_uses_generated_thumbnail_endpoint(environment):
    users,catalog,_,_=environment
    catalog[0]["thumbnail_url"]=""
    catalog[0]["gallery"]=[]
    item=showcase.payload(users["alice"])["listings"][0]
    assert item["thumbnail_url"]=="/api/marketplace/product/model/robot/thumbnail"


def test_owner_pin_save_reorder_and_public_snippet(environment):
    users,_,client,_=environment
    result=client.post("/api/marketplace/profile-showcase/me/pins",json={"kind":"model","listing_id":"robot","category":"Robotics"})
    assert result.status_code==200
    assert result.json()["profile_url"]=="/u/alice?edit=1"
    data=showcase.pin(users["alice"],"knowledge","skill","Learning")
    document=data["showcase"];document["pins"].reverse();document["pins"][0].update(display="code",code="print('public sample')",language="Python")
    result=client.put("/api/marketplace/profile-showcase/me",json={"showcase":document,"revision":data["revision"]})
    assert result.status_code==200
    public=client.get("/api/marketplace/profile/alice/showcase").json()
    assert [p["listing_id"] for p in public["showcase"]["pins"]]==["skill","robot"]
    assert public["showcase"]["pins"][0]["code"]=="print('public sample')"


@pytest.mark.parametrize("listing_id",["other","unpublished","missing"])
def test_cannot_pin_someone_elses_or_unpublished_product(environment,listing_id):
    _,_,client,_=environment
    assert client.post("/api/marketplace/profile-showcase/me/pins",json={"kind":"model","listing_id":listing_id}).status_code==400


def test_unpublishing_removes_previously_pinned_code_and_image(environment):
    users,catalog,_,_=environment
    data=showcase.pin(users["alice"],"model","robot")
    data["showcase"]["pins"][0].update(display="code",code="public excerpt")
    showcase.save(users["alice"],data["showcase"],data["revision"])
    catalog[0]["status"]="archived"
    result=showcase.payload(users["alice"])
    assert result["showcase"]["pins"]==[]
    assert "public excerpt" not in json.dumps(result)


def test_revision_conflict_does_not_overwrite_saved_profile(environment):
    users,_,client,_=environment
    data=showcase.pin(users["alice"],"model","robot")
    draft=data["showcase"];draft["title"]="Outdated browser"
    result=client.put("/api/marketplace/profile-showcase/me",json={"showcase":draft,"revision":0})
    assert result.status_code==409
    assert showcase.load(users["alice"])[0]["title"]=="Alice"


@pytest.mark.parametrize("url",["javascript:alert(1)","data:text/html,hi","http://example.com","https://owner:secret@example.com","//example.com"])
def test_social_links_reject_script_and_credential_urls(environment,url):
    users,_,_,_=environment
    document=showcase.defaults(users["alice"]);document["social_links"]=[{"label":"Website","url":url}]
    with pytest.raises(ValueError):showcase.save(users["alice"],document,0)


def test_owner_id_in_body_cannot_mutate_another_profile(environment):
    users,_,client,identity=environment
    document=showcase.defaults(users["alice"]);document["title"]="Alice portfolio"
    client.put("/api/marketplace/profile-showcase/me",json={"showcase":document,"revision":0,"user_id":"bob"})
    assert showcase.load(users["alice"])[0]["title"]=="Alice portfolio"
    assert showcase.load(users["bob"])[0]["title"]=="Bob"
    identity["id"]="bob"
    assert client.get("/api/marketplace/profile/alice/showcase").json()["is_self"] is False


def test_private_messages_only_visible_to_both_participants(environment):
    _,_,client,identity=environment
    sent=client.post("/api/marketplace/messages/bob",json={"body":"A private sale question","sender_id":"eve"})
    assert sent.status_code==200 and sent.json()["message"]["sender_id"]=="alice"
    identity["id"]="bob"
    assert client.get("/api/marketplace/messages/alice").json()["messages"][0]["body"]=="A private sale question"
    assert client.get("/api/marketplace/messages").json()["conversations"][0]["peer"]["id"]=="alice"
    identity["id"]="eve"
    assert client.get("/api/marketplace/messages/bob").json()["messages"]==[]
    assert client.get("/api/marketplace/messages/alice").json()["messages"]==[]
    assert client.get("/api/marketplace/messages").json()["conversations"]==[]


def test_marketplace_unread_tracks_recipient_until_conversation_is_opened(environment):
    _,_,client,identity=environment
    client.post("/api/marketplace/messages/bob",json={"body":"First unread message"})
    client.post("/api/marketplace/messages/bob",json={"body":"Second unread message"})
    assert client.get("/api/marketplace/messages-unread").json()=={"unread_count":0}

    identity["id"]="bob"
    inbox=client.get("/api/marketplace/messages").json()
    assert inbox["unread_count"]==2
    assert inbox["conversations"][0]["unread_count"]==2
    assert client.get("/api/marketplace/messages-unread").json()=={"unread_count":2}

    opened=client.get("/api/marketplace/messages/alice").json()
    assert [row["body"] for row in opened["messages"]]==["First unread message","Second unread message"]
    assert client.get("/api/marketplace/messages-unread").json()=={"unread_count":0}
    assert client.get("/api/marketplace/messages").json()["conversations"][0]["unread_count"]==0


def test_blocking_applies_to_both_directions_and_only_owner_can_unblock(environment):
    _,_,client,identity=environment
    client.put("/api/marketplace/messages/bob/block",json={"blocked":True})
    assert client.post("/api/marketplace/messages/bob",json={"body":"blocked"}).status_code==403
    identity["id"]="bob"
    assert client.post("/api/marketplace/messages/alice",json={"body":"blocked"}).status_code==403
    client.put("/api/marketplace/messages/alice/block",json={"blocked":False})
    assert client.post("/api/marketplace/messages/alice",json={"body":"still blocked"}).status_code==403
    identity["id"]="alice"
    client.put("/api/marketplace/messages/bob/block",json={"blocked":False})
    assert client.post("/api/marketplace/messages/bob",json={"body":"allowed"}).status_code==200


def test_message_rate_limit_and_empty_message(environment):
    _,_,client,_=environment
    assert client.post("/api/marketplace/messages/bob",json={"body":"   "}).status_code==400
    for i in range(20):assert client.post("/api/marketplace/messages/bob",json={"body":f"Message {i}"}).status_code==200
    assert client.post("/api/marketplace/messages/bob",json={"body":"slow down"}).status_code==429


def test_message_routes_require_auth_without_override():
    app=FastAPI();app.include_router(message_router);app.include_router(profile_router)
    client=TestClient(app)
    assert client.get("/api/marketplace/messages").status_code==401
    assert client.post("/api/marketplace/messages/bob",json={"body":"no auth"}).status_code==401
    assert client.put("/api/marketplace/profile-showcase/me",json={"revision":0,"showcase":{}}).status_code==401
