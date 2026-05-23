from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/debug_recover", tags=["DebugRecover"])

@router.get("/db")
async def recover_all(db: AsyncSession = Depends(get_db)):
    # 1. Get user id for ganeshpulikanti7@gmail.com
    u_res = await db.execute(text("SELECT id FROM users WHERE email = 'ganeshpulikanti7@gmail.com'"))
    user = u_res.fetchone()
    if not user: return {"error": "user not found"}
    user_id = str(user[0])
    
    # 2. Find all unique session_ids where this user sent a message
    msg_res = await db.execute(text("SELECT DISTINCT session_id FROM chat_messages WHERE content ILIKE '%[ganeshpulikanti7]:%'"))
    sessions_to_recover = [str(r[0]) for r in msg_res]
    
    recovered_count = 0
    for sid in sessions_to_recover:
        # Check if they are the owner
        s_res = await db.execute(text(f"SELECT user_id FROM chat_sessions WHERE id = '{sid}'"))
        sess = s_res.fetchone()
        if not sess: continue
        if str(sess[0]) == user_id: continue # They own it, no need to join
        
        # Check if they are already joined
        j_res = await db.execute(text(f"SELECT id FROM joined_sessions WHERE user_id = '{user_id}' AND session_id = '{sid}'"))
        if not j_res.fetchone():
            await db.execute(text(f"INSERT INTO joined_sessions (id, user_id, session_id) VALUES (gen_random_uuid(), '{user_id}', '{sid}')"))
            recovered_count += 1
            
    await db.commit()
    return {"recovered_count": recovered_count, "sessions": sessions_to_recover}
