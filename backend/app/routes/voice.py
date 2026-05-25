import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response, status, Header, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from jose import jwt
import uuid
from app.config import settings
from app.database import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        logger.error(f"Text-to-speech route failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate speech audio: {str(e)}"
        )

async def get_user_from_token(token: str, db: AsyncSession) -> User:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        user_id_str = payload.get("sub")
        if not user_id_str:
            raise Exception()
        user_id = uuid.UUID(user_id_str)
        stmt = select(User).where(User.id == user_id)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            raise Exception()
        return user
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )

@router.get("/speak")
async def speak_text_stream(
    text: str = Query(...),
    voice: Optional[str] = "diana",
    token: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Streams text synthesized into speech chunk-by-chunk for minimal latency.
    """
    actual_token = None
    if authorization and authorization.startswith("Bearer "):
        actual_token = authorization.split(" ")[1]
    elif token:
        actual_token = token

    if not actual_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization token required"
        )

    # Verify the user
    await get_user_from_token(actual_token, db)

    if not text.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text content cannot be empty"
        )

    # Return a StreamingResponse using the SpeechService chunk generator
    async def chunk_generator():
        try:
            response = await speech_service.client.audio.speech.create(
                model="canopylabs/orpheus-v1-english",
                voice=voice,
                input=text,
                response_format="wav"
            )
            async for chunk in response.iter_bytes(chunk_size=4096):
                yield chunk
        except Exception as e:
            logger.error(f"Error in speak streaming generator: {str(e)}")

    return StreamingResponse(chunk_generator(), media_type="audio/wav")
