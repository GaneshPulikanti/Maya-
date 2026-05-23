from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/debug2", tags=["Debug2"])

@router.get("/db")
async def debug_db2(db: AsyncSession = Depends(get_db)):
    sess_res = await db.execute(text("SELECT id, user_id, title FROM chat_sessions WHERE id = 'fa2a9c27-36ba-4312-830b-aa2a0c926d48'"))
    sess = sess_res.fetchone()
    if not sess: return {"error": "session not found"}
    
    owner_id = str(sess[1])
    owner_res = await db.execute(text(f"SELECT email FROM users WHERE id = '{owner_id}'"))
    owner = owner_res.fetchone()
    
    join_res = await db.execute(text("SELECT user_id FROM joined_sessions WHERE session_id = 'fa2a9c27-36ba-4312-830b-aa2a0c926d48'"))
    joins = [{"user_id": str(r[0])} for r in join_res]
    
    for j in joins:
        j_email = await db.execute(text(f"SELECT email FROM users WHERE id = '{j['user_id']}'"))
        e = j_email.fetchone()
        j['email'] = e[0] if e else "unknown"
        
    return {
        "session_id": str(sess[0]),
        "title": sess[2],
        "owner_id": owner_id,
        "owner_email": owner[0] if owner else "unknown",
        "joins": joins
    }
