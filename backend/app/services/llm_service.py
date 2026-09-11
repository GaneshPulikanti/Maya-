import os
import logging
from typing import AsyncGenerator, List, Dict
from groq import AsyncGroq, GroqError
from app.config import settings

logger = logging.getLogger(__name__)

class LLMService:
    """
    Service responsible for interacting with the Groq API.
    Handles loading prompts, formatting conversations, streaming responses, and primary/backup failover.
    """
    def __init__(self):
        # Initialize the asynchronous Groq client
        # It picks up GROQ_API_KEY from environment or our settings
        self.client = AsyncGroq(api_key=settings.GROQ_API_KEY)
        
        # Paths to prompt files
        base_dir = os.path.dirname(os.path.dirname(__file__))
        self.system_prompt_path = os.path.join(base_dir, "ai", "prompts", "system_prompt.txt")
        self.girlfriend_prompt_path = os.path.join(base_dir, "ai", "prompts", "girlfriend_prompt.txt")

    def _read_prompt_file(self, filepath: str) -> str:
        """
        Helper method to safely read prompt templates from disk.
        """
        if not os.path.exists(filepath):
            logger.error(f"Prompt file not found at path: {filepath}")
            return ""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error reading prompt file {filepath}: {str(e)}")
            return ""

    def build_system_prompt(
        self, 
        user_email: str, 
        conversation_title: str, 
        memory_context: str = "", 
        pdf_context: str = "",
        mind_space_docs: str = "",
        targeted_file_content: str = ""
    ) -> str:
        """
        Reads system prompts and dynamically formats placeholders with session parameters.
        """
        system_base = self._read_prompt_file(self.system_prompt_path)
        companion_base = self._read_prompt_file(self.girlfriend_prompt_path)
        
        # Format the girlfriend template with active variables
        formatted_companion = companion_base.format(
            user_email=user_email,
            conversation_title=conversation_title,
            memory_context=memory_context or "No long-term memories recorded yet. Start forming connection.",
            pdf_context=pdf_context or "No relevant document references loaded.",
            mind_space_docs=mind_space_docs or "No files currently uploaded in your Mind Space (Document Hub).",
            targeted_file_content=targeted_file_content or "No document is explicitly targeted right now."
        )
        
        # Combine base system guidelines and the formatted persona details
        full_system_prompt = f"{system_base}\n\n=== COMPANION PERSONA (MAYA) ===\n{formatted_companion}"
        return full_system_prompt

    async def generate_response_stream(
        self,
        messages: List[Dict[str, str]],
        system_prompt: str,
        use_backup: bool = False
    ) -> AsyncGenerator[str, None]:
        """
        Queries the Groq API and streams the response tokens back asynchronously.
        Automatically maps deprecated model names and tries multiple candidate models in sequence.
        
        :param messages: List of conversation history dicts: [{"role": "user", "content": "..."}]
        :param system_prompt: Fully compiled system instructions
        :param use_backup: Toggles starting with the backup LLM model
        """
        deprecated_map = {
            "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
            "llama-3.1-8b-instant": "openai/gpt-oss-20b",
            "llama3-70b-8192": "openai/gpt-oss-120b",
            "llama3-8b-8192": "openai/gpt-oss-20b",
            "mixtral-8x7b-32768": "openai/gpt-oss-120b",
        }
        
        primary_req = settings.BACKUP_LLM if use_backup else settings.PRIMARY_LLM
        secondary_req = settings.PRIMARY_LLM if use_backup else settings.BACKUP_LLM
        
        raw_candidates = [
            primary_req,
            secondary_req,
            "openai/gpt-oss-120b",
            "openai/gpt-oss-20b",
            "qwen/qwen3.6-27b",
            "groq/compound-mini"
        ]
        
        candidate_models = []
        for m in raw_candidates:
            resolved = deprecated_map.get(m, m)
            if resolved not in candidate_models:
                candidate_models.append(resolved)

        full_payload = [{"role": "system", "content": system_prompt}] + messages

        for model_to_use in candidate_models:
            logger.info(f"Initiating completion stream with candidate model: {model_to_use}")
            try:
                chat_completion = await self.client.chat.completions.create(
                    messages=full_payload,
                    model=model_to_use,
                    temperature=0.75,
                    max_tokens=2048,
                    top_p=0.9,
                    stream=True
                )
                
                has_yielded = False
                async for chunk in chat_completion:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        has_yielded = True
                        yield delta
                        
                if has_yielded:
                    return
            except GroqError as ge:
                logger.warning(f"Groq API error on candidate model {model_to_use}: {str(ge)}. Attempting next fallback model...")
                continue
            except Exception as e:
                logger.error(f"Unexpected error in LLM service on candidate model {model_to_use}: {str(e)}")
                continue

        # Safe user-facing fallback if all models fail
        yield "\n\n*(System Note: I am having a little trouble connecting right now. Please try saying that again in a second!)*"

    async def generate_conversation_title(self, first_message: str) -> str:
        """
        Uses the Groq LLM to generate a short, descriptive topic-based title (2-5 words)
        based on the user's first message, avoiding simple generic greetings.
        """
        prompt = (
            "You are a helpful assistant. Generate a highly concise, descriptive conversation title (2 to 5 words maximum) "
            "summarizing the following user's opening message. The title should represent the main topic or intention. "
            "If the message is just a simple greeting like 'hey', 'hello', 'hi', 'howdy', generate a warm general title like 'Cozy Hello' or 'Friendly Introduction' instead of repeating the greeting. "
            "Do NOT include any quotation marks, bullet points, prefix, or extra explanation. Return ONLY the title itself.\n\n"
            f"User message: {first_message}"
        )
        
        deprecated_map = {
            "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
            "llama-3.1-8b-instant": "openai/gpt-oss-20b",
        }
        
        raw_candidates = [settings.PRIMARY_LLM, settings.BACKUP_LLM, "openai/gpt-oss-120b", "openai/gpt-oss-20b"]
        models_to_try = []
        for m in raw_candidates:
            resolved = deprecated_map.get(m, m)
            if resolved not in models_to_try:
                models_to_try.append(resolved)
        
        for model in models_to_try:
            try:
                chat_completion = await self.client.chat.completions.create(
                    messages=[{"role": "user", "content": prompt}],
                    model=model,
                    temperature=0.7,
                    max_tokens=20,
                    top_p=0.9,
                    stream=False
                )
                title = chat_completion.choices[0].message.content.strip()
                title = title.strip('"' + "'" + ".")
                if title.strip():
                    return title[:50]
            except Exception as e:
                logger.warning(f"Failed to generate conversation title with model {model}: {str(e)}")
                
        # Safe fallback if all models fail or return empty values
        return first_message.strip()[:40] + ("..." if len(first_message) > 40 else "")

# Instantiate global service singleton
llm_service = LLMService()
