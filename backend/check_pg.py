import asyncio
import os
import json
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

load_dotenv()
db_url = os.getenv("DATABASE_URL").replace("postgresql://", "postgresql+asyncpg://")

async def main():
    engine = create_async_engine(db_url)
    async with engine.connect() as conn:
        user_res = await conn.execute(text("SELECT id, email FROM users WHERE email = 'ganeshpulikanti7@gmail.com'"))
        user = user_res.fetchone()
        
        if not user:
            print("User not found!")
            return
            
        user_id = user[0]
        print(f"User ID: {user_id}")
        
        print("\n--- Owned Sessions ---")
        owned_res = await conn.execute(text("SELECT id, title FROM chat_sessions WHERE user_id = :uid"), {"uid": user_id})
        for row in owned_res:
            msg_count = (await conn.execute(text("SELECT COUNT(*) FROM messages WHERE session_id = :sid"), {"sid": row[0]})).scalar()
            print(f"Session ID: {row[0]} | Title: {row[1]} | Messages: {msg_count}")
            
        print("\n--- Shared Sessions this user joined ---")
        shared_res = await conn.execute(text("SELECT session_id, role FROM shared_sessions WHERE user_id = :uid"), {"uid": user_id})
        for row in shared_res:
            sess_res = await conn.execute(text("SELECT id, title, user_id FROM chat_sessions WHERE id = :sid"), {"sid": row[0]})
            sess = sess_res.fetchone()
            if sess:
                msg_count = (await conn.execute(text("SELECT COUNT(*) FROM messages WHERE session_id = :sid"), {"sid": row[0]})).scalar()
                print(f"Session ID: {sess[0]} | Title: {sess[1]} | Owner: {sess[2]} | Role: {row[1]} | Messages: {msg_count}")
            else:
                print(f"Session {row[0]} NOT FOUND!")

        print("\n--- Looking for 'group' or 'shared' in title anywhere in DB ---")
        all_res = await conn.execute(text("SELECT id, title, user_id FROM chat_sessions WHERE title ILIKE '%group%' OR title ILIKE '%shared%'"))
        for row in all_res:
            msg_count = (await conn.execute(text("SELECT COUNT(*) FROM messages WHERE session_id = :sid"), {"sid": row[0]})).scalar()
            print(f"Session ID: {row[0]} | Title: {row[1]} | Owner: {row[2]} | Messages: {msg_count}")

asyncio.run(main())
