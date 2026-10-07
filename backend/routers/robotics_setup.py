from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from backend.auth import get_current_user
from backend.services.robotics_setup import install_setup
from backend.services.robotics_prefs import put_prefs
from backend.routers.robotics_studio import _require_lan_studio
router=APIRouter()
class InstallBody(BaseModel):
    url:str=Field(max_length=2048)
    bundle_url:str=Field(default='',max_length=2048)
    use_template:bool=False
@router.post('/api/robotics/setup/install')
async def install(body:InstallBody,request:Request,user=Depends(get_current_user)):
    _require_lan_studio(request)
    try:
        selection=await install_setup(body.url,bundle_url=body.bundle_url,use_template=body.use_template)
        put_prefs(user,{'roboticsProfile':selection})
        return selection
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc
    except Exception as exc:raise HTTPException(502,'Could not install Pi setup. Check its URL and connection.') from exc
