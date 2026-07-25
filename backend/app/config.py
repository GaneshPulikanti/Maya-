import os
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    """
    Application settings class using Pydantic Settings management.
    Loads and validates environment variables from the .env file.
    """
    ENV: str = "development"
    PORT: int = 8000
    DEBUG: bool = True

    # Database Configuration
    DATABASE_URL: str

    # Security Configuration
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 525600

    # LLM API Config
    GROQ_API_KEY: str
    PRIMARY_LLM: str = "openai/gpt-oss-120b"
    BACKUP_LLM: str = "openai/gpt-oss-120b"

    # RAG / Semantic Memory Config
    EMBEDDING_MODE: str = "api"  # "api" or "local"
    HF_API_TOKEN: str = ""
    CHROMA_DB_PATH: str = "./app/vector_db/chroma_db"

    # Upload Configuration
    UPLOAD_DIR: str = "./app/uploads"

    # Pydantic Settings Configuration
    model_config = SettingsConfigDict(
        # Load from .env one directory above 'app/' (i.e. 'backend/.env')
        env_file=os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @field_validator("DATABASE_URL")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """
        Ensures the database connection URL is formatted correctly for SQLAlchemy's asyncpg driver.
        Automatically converts standard postgresql:// schemes to postgresql+asyncpg://.
        Safely URL-encodes passwords containing special characters like '@' to prevent connection URL failures.
        """
        if not v:
            raise ValueError("DATABASE_URL environment variable is required.")
        
        import urllib.parse
        
        # Determine current scheme
        scheme = ""
        rest = ""
        for s in ["postgresql+asyncpg://", "postgres+asyncpg://", "postgresql://", "postgres://"]:
            if v.startswith(s):
                scheme = s
                rest = v[len(s):]
                break
                
        if not scheme:
            raise ValueError("DATABASE_URL must be a PostgreSQL connection string (postgresql:// or postgresql+asyncpg://).")
            
        # Parse based on the last '@' to isolate host details from username/password credentials
        # (hostnames cannot contain '@', whereas passwords frequently do)
        if "@" in rest:
            creds_part, host_part = rest.rsplit("@", 1)
            # Parse user and password by first ':' in credentials
            if ":" in creds_part:
                user, password = creds_part.split(":", 1)
                # URL encode password to handle special characters (e.g. Princegani@123 -> Princegani%40123)
                # We use safe="" to ensure '@', '/', and ':' are fully encoded
                quoted_password = urllib.parse.quote_plus(password)
                creds_part = f"{user}:{quoted_password}"
            rest = f"{creds_part}@{host_part}"
            
        # Always output using the asyncpg driver
        return f"postgresql+asyncpg://{rest}"

# Instantiate settings globally for imports across the app
settings = Settings()
