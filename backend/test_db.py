import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.future import select
from app.config import settings
from app.models import User, ChatSession, JoinedSession

async def test():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as db:
        stmt = select(User).limit(1)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()
        if not user:
            print("No users")
            return
            
        print(f"Testing for user {user.email}")
        
        stmt = select(ChatSession).where(
            (ChatSession.user_id == user.id) |
            (ChatSession.id.in_(
                select(JoinedSession.session_id).where(JoinedSession.user_id == user.id)
            ))
        ).order_by(ChatSession.updated_at.desc())
        
        result = await db.execute(stmt)
        sessions = result.scalars().all()
        print(f"Found {len(sessions)} sessions")
        
        response_sessions = []
        for session in sessions:
            owner = await db.get(User, session.user_id)
            participants = [owner.email] if owner else []
            
            join_stmt = select(User.email).join(JoinedSession, JoinedSession.user_id == User.id).where(JoinedSession.session_id == session.id)
            join_res = await db.execute(join_stmt)
            joined_emails = join_res.scalars().all()
            participants.extend(joined_emails)
            
            response_sessions.append({
                "id": str(session.id),
                "title": session.title,
                "owner_email": owner.email if owner else None,
                "participants": list(set(participants))
            })
            
        print("Success!", len(response_sessions))

asyncio.run(test())
