from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
# pyrefly: ignore [missing-import]
from app.config import settings

# Initialize Async Engine with connection pooling settings optimized for PostgreSQL/Supabase
# pool_pre_ping=True prevents using disconnected/stale connections from the pool
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True
)

# Create an async session maker factory
SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

# Base class for SQLAlchemy declarative ORM models
class Base(DeclarativeBase):
    pass

# Async Database Dependency
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency injection function that yields an active async database session.
    Ensures rollback on exceptions and automatic closure of session when complete.
    """
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
