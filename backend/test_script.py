import asyncio
import json
import httpx
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

async def test():
    async with httpx.AsyncClient() as client:
        # Generate a test user or login to get a token?
        # Let's just create a token for a user that has joined sessions.
        pass

if __name__ == "__main__":
    asyncio.run(test())
