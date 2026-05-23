import asyncio
import os
from dotenv import load_dotenv
import asyncpg
from datetime import datetime

load_dotenv()
db_url = os.getenv("DATABASE_URL")

async def main():
    conn = await asyncpg.connect(db_url)
    
    print("--- Checking Sessions Order ---")
    rows = await conn.fetch("SELECT id, title, updated_at FROM chat_sessions WHERE user_id = 'a6e6f7b2-4851-4dec-936c-b8035501c867' ORDER BY updated_at DESC LIMIT 5")
    
    for row in rows:
        print(f"{row['id']} | {row['title']} | {row['updated_at']}")
        
    await conn.close()

asyncio.run(main())
