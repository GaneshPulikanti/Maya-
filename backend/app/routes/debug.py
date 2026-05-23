from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/debug", tags=["Debug"])

@router.get("/db")
async def debug_db(db: AsyncSession = Depends(get_db)):
    res = await db.execute(text("SELECT id, session_id, role, content FROM chat_messages WHERE content ILIKE '%pollutions%'"))
    messages = [{"id": str(r[0]), "session_id": str(r[1]), "role": r[2], "content": r[3]} for r in res]
    
    orphans = []
    for msg in messages:
        s_res = await db.execute(text(f"SELECT id FROM chat_sessions WHERE id = '{msg['session_id']}'"))
        if not s_res.scalar_one_or_none():
            orphans.append(msg)
            
    return {"found_messages": messages, "orphans": orphans}
