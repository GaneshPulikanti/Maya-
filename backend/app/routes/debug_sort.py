from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/debug_sort", tags=["DebugSort"])

@router.get("/db")
async def sort_db(db: AsyncSession = Depends(get_db)):
    u_res = await db.execute(text("SELECT id FROM users WHERE email = 'ganeshpulikanti7@gmail.com'"))
    user = u_res.fetchone()
    if not user: return {"error": "user not found"}
    user_id = str(user[0])
    
    stmt = text(f"""
        SELECT id, title, updated_at 
        FROM chat_sessions 
        WHERE user_id = '{user_id}' 
           OR id IN (SELECT session_id FROM joined_sessions WHERE user_id = '{user_id}')
        ORDER BY updated_at DESC LIMIT 5
    """)
    rows = await db.execute(stmt)
    return [{"id": str(r[0]), "title": r[1], "updated_at": r[2]} for r in rows]
