"""Natural speech for turn-based Astra using the same voice IDs as live Talk."""
from __future__ import annotations

import base64
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from . import voice_mold_service as voices

SPEECH_STYLE = "Speak naturally and conversationally, with a calm, warm, clear delivery. Use normal pacing and light expression. Avoid an announcer voice, exaggerated enthusiasm, or a robotic cadence."

class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=4096)
    voice: str = Field('marin', max_length=40)
    project_id: str | None = Field(None, max_length=64)


def speech_payload(text: str, voice: str) -> dict:
    if not text.strip() or len(text) > 4096:
        raise ValueError('Speech must contain 1–4096 characters')
    return {'model': voices.TTS_PREVIEW_MODEL, 'voice': voices.normalize_realtime_voice(voice),
            'input': text, 'response_format': 'pcm', 'instructions': SPEECH_STYLE, 'speed': 1.0}


async def synthesize_speech(api_key: str, text: str, voice: str) -> bytes:
    import httpx
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(voices.TTS_PREVIEW_URL,
            headers={'Authorization': f'Bearer {api_key}'}, json=speech_payload(text, voice))
    if response.status_code >= 400:
        raise RuntimeError('Speech provider could not generate audio')
    audio = response.content
    if not audio or len(audio) % 2 or len(audio) > 24 * 1024 * 1024:
        raise RuntimeError('Speech provider returned invalid audio')
    return audio


def speech_router(get_current_user):
    router = APIRouter()
    @router.post('/api/voice-mold/speech')
    async def speech(body: SpeechRequest, user=Depends(get_current_user)):
        key = voices.resolve_openai_api_key(user, project_id=body.project_id)
        if not key:
            raise HTTPException(400, 'Add an OpenAI API key to hear the selected voice. The text reply is still available.')
        try:
            audio = await synthesize_speech(key, body.text, body.voice)
        except Exception:
            raise HTTPException(502, 'Voice audio is unavailable. The text reply is still available; retry Talk.') from None
        return {'audio': base64.b64encode(audio).decode(), 'format': 'pcm16', 'sample_rate': 24000,
                'voice': voices.normalize_realtime_voice(body.voice)}
    return router
