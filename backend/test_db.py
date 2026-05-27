import asyncio
from app.database import get_db
from app.models import PDFDocument
from sqlalchemy import select

async def main():
    async for session in get_db():
        stmt = select(PDFDocument)
        result = await session.execute(stmt)
        docs = result.scalars().all()
        for doc in docs:
            print(f"ID: {doc.id}, Filename: {doc.filename}, Path: {doc.file_path}")
        break

if __name__ == "__main__":
    asyncio.run(main())
