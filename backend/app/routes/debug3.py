from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/debug3", tags=["Debug3"])

@router.get("/db")
async def debug_db3(db: AsyncSession = Depends(get_db)):
    # Get user id for ganeshpulikanti7@gmail.com
    u_res = await db.execute(text("SELECT id FROM users WHERE email = 'ganeshpulikanti7@gmail.com'"))
    user = u_res.fetchone()
    if not user: return {"error": "user not found"}
    user_id = str(user[0])
    
    # Check if already joined
    j_res = await db.execute(text(f"SELECT id FROM joined_sessions WHERE user_id = '{user_id}' AND session_id = 'fa2a9c27-36ba-4312-830b-aa2a0c926d48'"))
    if not j_res.fetchone():
        await db.execute(text(f"INSERT INTO joined_sessions (id, user_id, session_id) VALUES (gen_random_uuid(), '{user_id}', 'fa2a9c27-36ba-4312-830b-aa2a0c926d48')"))
        await db.commit()
        return {"success": "Re-added ganeshpulikanti7 to the group chat!"}
    
    return {"status": "Already joined"}
