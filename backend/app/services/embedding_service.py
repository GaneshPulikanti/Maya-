import logging
import httpx
from typing import List
from app.config import settings

logger = logging.getLogger(__name__)

class EmbeddingService:
    """
    Service responsible for converting textual passages into high-dimensional vector embeddings.
    Supports a lightweight Serverless API mode (Hugging Face) and a robust offline Local mode.
    """
    def __init__(self):
        self.mode = settings.EMBEDDING_MODE.lower()
        self.api_token = settings.HF_API_TOKEN
        self.model_name = "sentence-transformers/all-MiniLM-L6-v2"
        self.local_model = None

        logger.info(f"Embedding Service initialized in [{self.mode.upper()}] mode using model: {self.model_name}")

        # Pre-load local model if set to local mode on boot
        if self.mode == "local":
            self._init_local_model()

    def _init_local_model(self):
        """
        Dynamically imports and initializes the local SentenceTransformer model.
        Dynamic loading prevents dependency crashes for environments running in API-only mode.
        """
        if self.local_model is not None:
            return
            
        logger.info("Initializing offline sentence-transformers model (requires PyTorch)...")
        try:
            from sentence_transformers import SentenceTransformer
            self.local_model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("✓ Local embedding model loaded successfully.")
        except ImportError as ie:
            logger.critical(
                "Failed to import 'sentence_transformers'. "
                "Ensure torch and sentence-transformers are installed when using local embedding mode."
            )
            raise ie
        except Exception as e:
            logger.error(f"Error loading local embedding model: {str(e)}")
            raise e

    async def get_embedding(self, text: str) -> List[float]:
        """
        Generates a 384-dimensional vector embedding for the provided text string.
        """
        if not text or not text.strip():
            # Return zero-vector if text is empty
            return [0.0] * 384
            
        if self.mode == "local":
            return await self._get_embedding_local(text)
        else:
            return await self._get_embedding_api(text)

    async def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generates embeddings for a batch of strings.
        """
        if not texts:
            return []
            
        if self.mode == "local":
            self._init_local_model()
            # Run local inference in a threadpool to avoid blocking event loop
            import asyncio
            loop = asyncio.get_event_loop()
            embeddings = await loop.run_in_executor(None, self.local_model.encode, texts)
            return [emb.tolist() for emb in embeddings]
        else:
            # Generate sequentially or concurrently via API
            # For simplicity, sequential with httpx client connection reuse
            results = []
            for text in texts:
                emb = await self._get_embedding_api(text)
                results.append(emb)
            return results

    async def _get_embedding_local(self, text: str) -> List[float]:
        """
        Computes embedding locally using the loaded SentenceTransformer model.
        Runs in an executor thread to ensure FastAPI's async loop remains unblocked.
        """
        self._init_local_model()
        import asyncio
        loop = asyncio.get_event_loop()
        # encode returns numpy array, convert to list of floats
        embedding = await loop.run_in_executor(None, self.local_model.encode, text)
        return embedding.tolist()

    async def _get_embedding_api(self, text: str) -> List[float]:
        """
        Calls Hugging Face's serverless Inference API to extract features.
        Zero local RAM required, keeping deployment memory footprints miniature.
        """
        url = f"https://api-inference.huggingface.co/pipeline/feature-extraction/{self.model_name}"
        headers = {}
        if self.api_token and not self.api_token.startswith("hf_your"):
            headers["Authorization"] = f"Bearer {self.api_token}"
            
        payload = {
            "inputs": [text],
            "options": {"wait_for_model": True}
        }
        
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(url, headers=headers, json=payload)
                
                if response.status_code == 200:
                    result = response.json()
                    # The response is usually a list containing the vector: [[val1, val2, ...]]
                    if isinstance(result, list) and len(result) > 0:
                        emb = result[0]
                        # Sometimes nested deeply based on pipeline output
                        if isinstance(emb, list) and isinstance(emb[0], list):
                            emb = emb[0][0]
                        elif isinstance(emb, list) and isinstance(emb[0], float):
                            pass
                        return emb
                    raise ValueError(f"Unexpected response format from HF API: {result}")
                
                else:
                    logger.error(f"HF API embedding error ({response.status_code}): {response.text}")
                    # If rate limited or API key invalid, fall back to generating a pseudo-random stable vector
                    # so the system degrades gracefully instead of hard-crashing
                    return self._generate_fallback_vector(text)
                    
        except Exception as e:
            logger.error(f"Failed to generate embedding via Hugging Face API: {str(e)}")
            return self._generate_fallback_vector(text)

    def _generate_fallback_vector(self, text: str) -> List[float]:
        """
        Generates a stable, reproducible pseudo-random vector for fallback situations.
        Ensures the system continues running gracefully when offline or rate-limited.
        """
        import hashlib
        logger.warning(f"Generating pseudo-random stable fallback vector for text of size: {len(text)}")
        hash_obj = hashlib.sha256(text.encode("utf-8"))
        hash_digest = hash_obj.digest()
        
        vector = []
        for i in range(384):
            # Create floats based on hash bytes
            byte_val = hash_digest[i % 32]
            # Map byte value [0, 255] to float [-1.0, 1.0]
            val = (byte_val / 127.5) - 1.0
            # Add some variability based on dimension index
            val += (i / 384.0) * 0.1
            vector.append(val)
        return vector

# Instantiate global service singleton
embedding_service = EmbeddingService()
