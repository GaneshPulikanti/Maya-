import asyncio
import os
from dotenv import load_dotenv
import asyncpg

load_dotenv()
db_url = os.getenv("DATABASE_URL")

async def main():
    try:
        # Use asyncpg directly to bypass SQLAlchemy overhead and just do a raw query
        conn = await asyncpg.connect(db_url)
        
        print("--- Searching for 'pollutions' in messages ---")
        rows = await conn.fetch("SELECT id, session_id, role, content FROM chat_messages WHERE content ILIKE '%pollutions%'")
        
        if not rows:
            print("No messages found containing 'pollutions'.")
        else:
            for row in rows:
                print(f"Message ID: {row['id']} | Session ID: {row['session_id']} | Role: {row['role']}")
                print(f"Content: {row['content'][:50]}...")
                
                # Check if session exists
                sess = await conn.fetchrow("SELECT * FROM chat_sessions WHERE id = $1", row['session_id'])
                if sess:
                    print(f"  -> Linked to session: {sess['title']}")
                else:
                    print(f"  -> ORPHANED MESSAGE! Session does not exist!")
                    
        await conn.close()
    except Exception as e:
        print(f"Database error: {e}")

asyncio.run(main())
