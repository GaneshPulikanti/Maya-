import logging
from io import BytesIO
from groq import AsyncGroq, GroqError
from app.config import settings

logger = logging.getLogger(__name__)

class SpeechService:
    def __init__(self):
        self.client = AsyncGroq(api_key=settings.GROQ_API_KEY)

    async def transcribe_audio(self, audio_bytes: bytes, filename: str = "voice.wav") -> str:
        """
        Transcribes the given audio bytes using Groq's whisper-large-v3-turbo model.
        """
        try:
            # Determine content type based on the uploaded file extension
            ext = filename.split(".")[-1].lower() if "." in filename else "wav"
            mime_type = "audio/wav"
            if ext == "webm":
                mime_type = "audio/webm"
            elif ext == "ogg":
                mime_type = "audio/ogg"
            elif ext == "m4a":
                mime_type = "audio/mp4"
            elif ext == "mp3":
                mime_type = "audio/mpeg"
                
            audio_file = (filename, audio_bytes, mime_type)
            
            response = await self.client.audio.transcriptions.create(
                file=audio_file,
                model="whisper-large-v3-turbo",
                response_format="json"
            )
            return response.text.strip()
        except GroqError as ge:
            logger.error(f"Groq Speech-to-Text API error: {str(ge)}")
            raise Exception(f"Failed to transcribe audio with Groq: {str(ge)}")
        except Exception as e:
            logger.error(f"Unexpected error in Speech Service STT: {str(e)}")
            raise Exception(f"Failed to transcribe audio: {str(e)}")

    async def text_to_speech(self, text: str, voice: str = "diana") -> bytes:
        """
        Generates speech audio bytes from text using Groq's Orpheus model.
        """
        try:
            response = await self.client.audio.speech.create(
                model="canopylabs/orpheus-v1-english",
                voice=voice,
                input=text,
                response_format="wav"
            )
            # Response is a binary stream, use read() to get the bytes
            return await response.read()
        except GroqError as ge:
            logger.error(f"Groq Text-to-Speech API error: {str(ge)}")
            raise Exception(f"Failed to generate speech with Groq Orpheus: {str(ge)}")
        except Exception as e:
            logger.error(f"Unexpected error in Speech Service TTS: {str(e)}")
            raise Exception(f"Failed to generate speech: {str(e)}")

speech_service = SpeechService()
