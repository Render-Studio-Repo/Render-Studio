"""Status observed from the existing Pi socket; never open a second control client."""
import json,time
from urllib.parse import urlsplit
STATES={}
def note_status(target,payload):
    try:
        row=json.loads(payload)
        if row.get('type')=='teleop_status' and isinstance(row.get('armed'),bool):
            STATES[urlsplit(target).hostname]={'status':row,'at':time.monotonic()}
    except (TypeError,ValueError,AttributeError):pass
def clear_status(target):STATES.pop(urlsplit(target).hostname,None)
def get_status(target):
    row=STATES.get(urlsplit(target).hostname)
    return dict(row['status']) if row else None
