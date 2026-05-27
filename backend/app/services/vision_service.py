import base64
import logging
from groq import AsyncGroq, GroqError
from app.config import settings

logger = logging.getLogger(__name__)

class VisionService:
    def __init__(self):
        self.client = AsyncGroq(api_key=settings.GROQ_API_KEY)

    async def analyze_image(self, image_bytes: bytes, mime_type: str = "image/jpeg", prompt: str = None) -> str:
        """
        Sends the image to the Groq vision model meta-llama/llama-4-scout-17b-16e-instruct and returns a simple text explanation.
        """
        text_prompt = prompt if prompt else "Please provide a simple, clean, and caring explanation of what is in this image."
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        try:
            response = await self.client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": text_prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=1024,
                temperature=0.7
            )
            return response.choices[0].message.content.strip()
        except GroqError as ge:
            logger.error(f"Groq Vision API error: {str(ge)}")
            raise Exception(f"Failed to analyze image with Groq Vision: {str(ge)}")
        except Exception as e:
            logger.error(f"Unexpected error in Vision Service: {str(e)}")
            raise Exception(f"Failed to analyze image: {str(e)}")

vision_service = VisionService()
