"""Public presentation-only thumbnails for already-published listings."""
from fastapi import APIRouter,HTTPException
from fastapi.responses import Response
from backend.services import model_marketplace_service,agent_marketplace_service
from backend.services.marketplace_thumbnail_service import model_thumbnail_asset,svg_thumbnail_asset

router=APIRouter(tags=['marketplace-thumbnails'])

@router.get('/api/marketplace/product/{kind}/{listing_id}/thumbnail')
def thumbnail(kind:str,listing_id:str):
    if kind not in {'model','knowledge','agent'}:raise HTTPException(404,'Thumbnail not found.')
    # Resolve raw listing, not decorated catalog, to avoid recursive thumbnail lookups.
    source=agent_marketplace_service if kind=='agent' else model_marketplace_service
    item=source.get_listing(listing_id,user_id=None,include_pending=False)
    if not item or item.get('status')!='approved':raise HTTPException(404,'Thumbnail not found.')
    payload=svg_thumbnail_asset(item)
    media_type='image/svg+xml'
    filename='thumbnail.svg'
    if not payload and kind=='model':
        payload=model_thumbnail_asset(item)
        media_type='image/png'
        filename='thumbnail.png'
    if not payload:raise HTTPException(404,'Thumbnail not found.')
    return Response(payload,media_type=media_type,headers={
        'Content-Security-Policy':"sandbox; default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'",
        'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300',
        'Content-Disposition':f'inline; filename="{filename}"',
    })
