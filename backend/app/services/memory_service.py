import logging
import uuid
import re
from datetime import datetime, timezone
from typing import List
from app.config import settings
from app.services.vector_service import vector_service
from app.services.llm_service import llm_service

logger = logging.getLogger(__name__)

class MemoryService:
    """
    Service responsible for manages the companion's "Long-Term Memory".
    Asynchronously extracts facts from conversations using LLM summarization,
    embeds them, and retrieves relevant historical context to maintain dialogue continuity.
    """
    
    def _get_collection_name(self, user_id: uuid.UUID) -> str:
        """
        Generates a standard collection name for a user.
        ChromaDB collections must be 3-63 chars, alphanumeric or underscores.
        UUID hex is 32 chars, so f"user_mem_{hex}" is exactly 41 chars and highly secure.
        """
        return f"user_mem_{user_id.hex}"

    async def retrieve_relevant_memories(self, user_id: uuid.UUID, query_text: str, limit: int = 5) -> str:
        """
        Performs semantic search on the user's memory vector space.
        Returns a formatted bullet-point string of context.
        """
        collection_name = self._get_collection_name(user_id)
        
        # Query matching items in ChromaDB
        results = await vector_service.query_similarity(
            collection_name=collection_name,
            query_text=query_text,
            limit=limit
        )
        
        if not results:
            return ""
            
        # Format bullet list
        bullets = []
        for item in results:
            text = item["text"].strip()
            # De-duplicate or cleanup
            if text and text not in bullets:
                bullets.append(f"- {text}")
                
        context = "\n".join(bullets)
        logger.debug(f"Retrieved {len(bullets)} long-term memories for user {user_id}: {context}")
        return context

    async def extract_and_save_memories(self, user_id: uuid.UUID, user_message: str, assistant_response: str) -> List[str]:
        """
        Analyzes a single conversational turn, extracts core biographical/pref facts, 
        and updates ChromaDB.
        Designed to be run as an asynchronous background task so it doesn't delay chat responses.
        """
        # Skip extremely short messages to save tokens and avoid noise
        if len(user_message.strip()) < 5:
            return []

        # Prompt Groq to extract facts using the faster, cost-efficient backup model
        extraction_prompt = (
            "You are an analytical sub-system of an AI companion. Your job is to extract long-term facts "
            "about the user from a single dialogue exchange. \n\n"
            "INSTRUCTIONS:\n"
            "1. Extract ONLY key biographical facts, life events, preferences, emotional conditions, "
            "hobbies, jobs, relationships, names, or clear habits of the USER.\n"
            "2. Represent each fact as a simple, objective, third-person declarative sentence starting with 'User' "
            "(e.g., 'User works as a React developer', 'User's dog is named Max', 'User feels stressed about exams').\n"
            "3. Do NOT extract temporary statements ('User is saying hello') or facts about the assistant.\n"
            "4. Avoid duplicates or redundant phrases.\n"
            "5. If no important biographical user facts or preferences are shared, output exactly 'NONE'. Do not write anything else.\n\n"
            f"DIALOGUE EXCHANGE:\n"
            f"User: \"{user_message}\"\n"
            f"Companion: \"{assistant_response}\"\n\n"
            "EXTRACTED FACTS:"
        )

        messages = [{"role": "user", "content": extraction_prompt}]
        logger.info(f"Extracting user facts for user {user_id}...")
        
        extracted_text = ""
        try:
            # Query Groq. We request a direct token stream and collect it
            # We use settings.BACKUP_LLM to run this quickly and cost-effectively
            async for token in llm_service.generate_response_stream(
                messages=messages, 
                system_prompt="You are a precise, objective data-extraction sub-service.",
                use_backup=True  # Use smaller model
            ):
                extracted_text += token
                
            extracted_text = extracted_text.strip()
            
            if "NONE" in extracted_text.upper() or len(extracted_text) < 5:
                logger.info(f"No long-term memories extracted for user {user_id}.")
                return []
                
            # Split facts by newlines and sanitize bullet formatting
            raw_facts = re.split(r'\n+', extracted_text)
            sanitized_facts = []
            
            for fact in raw_facts:
                # Remove common list headers like "1. ", "- ", "* "
                cleaned = re.sub(r'^[\s\d\.\-\*]+', '', fact).strip()
                if cleaned and len(cleaned) > 8 and (cleaned.lower().startswith("user") or "user" in cleaned.lower()):
                    sanitized_facts.append(cleaned)
                    
            if not sanitized_facts:
                return []
                
            # Save to ChromaDB
            collection_name = self._get_collection_name(user_id)
            ids = [f"mem_{uuid.uuid4().hex}" for _ in sanitized_facts]
            metadatas = [{
                "user_id": str(user_id),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "source": "dialogue"
            } for _ in sanitized_facts]
            
            success = await vector_service.add_texts(
                collection_name=collection_name,
                texts=sanitized_facts,
                ids=ids,
                metadatas=metadatas
            )
            
            if success:
                logger.info(f"✓ Successfully stored {len(sanitized_facts)} new facts in memory for user {user_id}.")
                return sanitized_facts
            else:
                logger.error(f"Failed to write extracted facts to vector database for user {user_id}.")
                return []
                
        except Exception as e:
            logger.error(f"Failed to perform background memory extraction: {str(e)}")
            return []

# Instantiate global service singleton
memory_service = MemoryService()
