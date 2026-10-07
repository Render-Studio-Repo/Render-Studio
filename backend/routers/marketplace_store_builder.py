"""AI store drafts; existing authenticated policies select the user's AI provider."""
from __future__ import annotations
from typing import Any, Callable
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from backend.services import marketplace_catalog_service as catalog, marketplace_store_builder_service as service

class DraftBody(BaseModel):
    prompt: str = Field(min_length=3,max_length=4000)
    ai_key_id: str | None = None
    ai_key_source: str | None = None
    model: str | None = None
    speed: str = 'fast'

class LayoutDraftBody(DraftBody):
    layout: list[dict[str,Any]] = Field(default_factory=list,max_length=24)

class DescriptionDraftBody(DraftBody):
    kind: str = Field(default='model',pattern='^(model|knowledge|agent)$')
    listing_id: str = Field(min_length=1,max_length=100)


def create_marketplace_store_builder_router(get_user: Callable, get_ai: Callable) -> APIRouter:
    """get_ai(user, body) returns existing user's AI service; does not publish drafts."""
    router=APIRouter(tags=['marketplace-store-builder'])
    def call(fn,*args):
        try: return fn(*args)
        except ValueError as exc: raise HTTPException(422,str(exc)) from exc

    @router.post('/api/marketplace/store/layout/suggest')
    def suggest(body: LayoutDraftBody,user=Depends(get_user)):
        # Filter identity again even though mine_only is applied, including hub records.
        owned=[item for item in catalog.list_catalog(user_id=user['id'],mine_only=True,include_hub=False)
               if str(item.get('created_by') or (item.get('owner') or {}).get('id') or '') == str(user['id'])]
        return call(service.suggest_layout,get_ai(user,body),body.prompt,body.layout,owned)

    @router.post('/api/marketplace/store/product-description')
    def describe(body: DescriptionDraftBody,user=Depends(get_user)):
        item=catalog.get_product(body.kind,body.listing_id,user_id=user['id'],record=False)
        if not item: raise HTTPException(404,'Product not found.')
        if str(item.get('created_by') or (item.get('owner') or {}).get('id') or '') != str(user['id']):
            raise HTTPException(403,'Only the seller can generate product copy.')
        return call(service.describe_product,get_ai(user,body),body.prompt,item)
    return router
