import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response, status
from pydantic import BaseModel
from typing import Optional
from app.routes.auth import get_current_user
from app.models import User
from app.services.speech_service import speech_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["Voice Services"])

class SpeakRequest(BaseModel):
    text: str
    voice: Optional[str] = "diana"

@router.post("/transcribe", status_code=status.HTTP_200_OK)
async def transcribe_audio(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Transcribes uploaded audio file using Groq's whisper-large-v3-turbo model.
    """
    # Accept standard audio mime types
    if not file.content_type.startswith("audio/") and not file.filename.endswith((".wav", ".mp3", ".m4a", ".webm")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file must be a valid audio file."
        )

    try:
        audio_bytes = await file.read()
        transcription = await speech_service.transcribe_audio(audio_bytes, file.filename)
        return {"text": transcription}
    except Exception as e:
        logger.error(f"Audio transcription route failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to transcribe audio: {str(e)}"
        )

@router.post("/speak", status_code=status.HTTP_200_OK)
async def speak_text(
    payload: SpeakRequest,
    current_user: User = Depends(get_current_user)
):
    """
    Synthesizes text into speech audio bytes using Groq's Orpheus model.
    """
    if not payload.text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text content for speech generation cannot be empty."
        )

    try:
        audio_bytes = await speech_service.text_to_speech(payload.text, payload.voice)
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as e:
        logger.error(f"Text-to-speech route failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate speech audio: {str(e)}"
        )
