import json
import logging
import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, SessionLocal
from app.models import User, ChatSession, ChatMessage, PDFDocument, JoinedSession
from app.schemas import ChatSessionCreate, ChatSessionResponse, ChatMessageCreate, ChatMessageResponse
from app.routes.auth import get_current_user
from app.services.llm_service import llm_service
from app.services.memory_service import memory_service
from app.services.vector_service import vector_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat & Conversations"])

def get_clean_message_content(content: str) -> str:
    if content and content.startswith('{"versions":'):
        try:
            data = json.loads(content)
            curr_idx = data.get("current", 0)
            pairs = data.get("versions", [])
            if curr_idx < len(pairs):
                return pairs[curr_idx].get("user", "")
        except Exception:
            pass
    return content

# ==============================================================================
# CHAT SESSIONS CRUD
# ==============================================================================

async def verify_session_access(session: ChatSession, current_user: User, db: AsyncSession):
    if session.user_id == current_user.id:
        return True
    check_stmt = select(JoinedSession).where(
        JoinedSession.user_id == current_user.id,
        JoinedSession.session_id == session.id
    )
    check_result = await db.execute(check_stmt)
    if not check_result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this chat session.")
    return True


@router.post("/sessions", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    session_data: ChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Creates a new chat session for the authenticated user.
    """
    title = session_data.title or "New Conversation"
    new_session = ChatSession(
        user_id=current_user.id,
        title=title
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    return new_session


@router.post("/sessions/clone/{shared_session_id}", response_model=ChatSessionResponse, status_code=status.HTTP_201_CREATED)
async def clone_shared_session(
    shared_session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Clones a shared chat session and all its messages into a new session for the authenticated user.
    """
    # 1. Fetch the shared session
    stmt = select(ChatSession).where(ChatSession.id == shared_session_id)
    result = await db.execute(stmt)
    shared_session = result.scalar_one_or_none()
    
    if not shared_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared chat session not found.")
        
    # 2. Fetch all messages in the shared session
    msg_stmt = select(ChatMessage).where(ChatMessage.session_id == shared_session_id).order_by(ChatMessage.created_at.asc())
    msg_result = await db.execute(msg_stmt)
    shared_messages = msg_result.scalars().all()
    
    # 3. Create a new session for the current user
    new_session = ChatSession(
        user_id=current_user.id,
        title=f"{shared_session.title} (Copy)"
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)
    
    # 4. Clone messages
    for msg in shared_messages:
        cloned_msg = ChatMessage(
            session_id=new_session.id,
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at
        )
        db.add(cloned_msg)
        
    await db.commit()
    await db.refresh(new_session)
    return new_session



@router.post("/sessions/join/{shared_session_id}", response_model=ChatSessionResponse, status_code=status.HTTP_200_OK)
async def join_shared_session(
    shared_session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Records that the current user has joined a shared chat session,
    allowing it to appear in their sidebar and stay perfectly synced.
    """
    stmt = select(ChatSession).where(ChatSession.id == shared_session_id)
    result = await db.execute(stmt)
    shared_session = result.scalar_one_or_none()
    
    if not shared_session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared chat session not found.")
        
    if shared_session.user_id == current_user.id:
        return shared_session # Already the owner

    # Check if already joined
    check_stmt = select(JoinedSession).where(
        JoinedSession.user_id == current_user.id,
        JoinedSession.session_id == shared_session_id
    )
    check_result = await db.execute(check_stmt)
    if not check_result.scalar_one_or_none():
        new_join = JoinedSession(user_id=current_user.id, session_id=shared_session_id)
        db.add(new_join)
        await db.commit()
        
    return shared_session


@router.get("/sessions", response_model=List[ChatSessionResponse])
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves all chat sessions for the authenticated user, sorted by most recently updated.
    Auto-corrects any historical default titles using their first user message.
    Cleans up empty chat sessions that are uninitialized and older than 30 seconds.
    """
    from datetime import datetime, timezone
    from sqlalchemy import func
    
    # 1. Fetch all raw sessions for the user to evaluate them
    stmt = select(ChatSession).where(
        (ChatSession.user_id == current_user.id) |
        (ChatSession.id.in_(
            select(JoinedSession.session_id).where(JoinedSession.user_id == current_user.id)
        ))
    )
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    
    now = datetime.now(timezone.utc)
    any_deleted = False
    
    # 2. Get message count for all user's sessions in a single query to identify empty ones
    session_ids = [s.id for s in sessions]
    msg_counts = {}
    if session_ids:
        count_stmt = select(ChatMessage.session_id, func.count(ChatMessage.id)).where(
            ChatMessage.session_id.in_(session_ids)
        ).group_by(ChatMessage.session_id)
        count_res = await db.execute(count_stmt)
        msg_counts = {r[0]: r[1] for r in count_res.all()}
        
    for session in sessions:
        msg_count = msg_counts.get(session.id, 0)
        if msg_count == 0:
            created_at = session.created_at
            if created_at.tzinfo is None:
                now_comp = datetime.utcnow()
            else:
                now_comp = datetime.now(timezone.utc)
                
            age_seconds = (now_comp - created_at).total_seconds()
            if age_seconds > 30:
                await db.delete(session)
                any_deleted = True
                
    if any_deleted:
        await db.commit()
        
    # 3. Retrieve remaining sessions sorted by most recently updated
    stmt = select(ChatSession).where(
        (ChatSession.user_id == current_user.id) |
        (ChatSession.id.in_(
            select(JoinedSession.session_id).where(JoinedSession.user_id == current_user.id)
        ))
    ).order_by(ChatSession.updated_at.desc())
    result = await db.execute(stmt)
    sessions = result.scalars().all()
    
    any_updated = False
    for session in sessions:
        title_val = session.title.strip() if session.title else ""
        is_generic = (
            not title_val or 
            title_val in ("", "New Conversation", "Conversation", "Empty Chat", "New Chat") or
            title_val.startswith("Mixed:") or
            title_val.startswith("Mixed-") or
            "mixed-hey" in title_val.lower() or
            "mixed:" in title_val.lower()
        )
        if is_generic:
            # Fetch the first user message for this session
            msg_stmt = select(ChatMessage).where(
                ChatMessage.session_id == session.id,
                ChatMessage.role == "user"
            ).order_by(ChatMessage.created_at.asc()).limit(1)
            msg_res = await db.execute(msg_stmt)
            first_msg = msg_res.scalar_one_or_none()
            
            if first_msg:
                content_preview = first_msg.content.strip()
                clean_content = get_clean_message_content(content_preview)
                if clean_content.startswith("[Reply to:"):
                    end_idx = clean_content.find("]")
                    if end_idx != -1:
                        clean_content = clean_content[end_idx+1:].strip()
                
                import re
                img_match = re.match(r"^\[Look at this image:\s*(.*?)\]\s*(.*)$", clean_content, re.DOTALL)
                file_match = re.match(r"^\[Look at this file:\s*(.*?)\]\s*(.*)$", clean_content, re.DOTALL)
                if img_match:
                    inner = img_match.group(1)
                    user_text = img_match.group(2).strip()
                    explanation = inner
                    if "|" in inner:
                        parts = inner.split("|")
                        explanation = parts[1] if len(parts) > 1 else parts[0]
                    
                    if user_text:
                        session.title = await llm_service.generate_conversation_title(user_text)
                    else:
                        session.title = await llm_service.generate_conversation_title(f"Image: {explanation}")
                elif file_match:
                    inner = file_match.group(1)
                    user_text = file_match.group(2).strip()
                    file_name = "Document"
                    if "|" in inner:
                        parts = inner.split("|")
                        if len(parts) >= 2:
                            file_name = parts[1]
                    if user_text:
                        session.title = await llm_service.generate_conversation_title(user_text)
                    else:
                        session.title = f"File: {file_name}"[:50]
                elif clean_content.startswith("[Uploaded Document:"):
                    try:
                        parts = clean_content.split("Uploaded Document:")
                        filename = parts[1].strip(" ]")
                        session.title = f"Doc: {filename}"[:50]
                    except Exception:
                        session.title = "Document Upload"
                else:
                    session.title = await llm_service.generate_conversation_title(clean_content)
                
                db.add(session)
                any_updated = True
                
    if any_updated:
        await db.commit()
        # Re-fetch sessions to make sure we return updated titles and correct sorting
        stmt = select(ChatSession).where(
            (ChatSession.user_id == current_user.id) |
            (ChatSession.id.in_(
                select(JoinedSession.session_id).where(JoinedSession.user_id == current_user.id)
            ))
        ).order_by(ChatSession.updated_at.desc())
        result = await db.execute(stmt)
        sessions = result.scalars().all()
        
    # Pre-fetch all user emails and joined participants in bulk to avoid N+1 queries
    session_ids = [s.id for s in sessions]
    owner_ids = list(set(s.user_id for s in sessions))
    owner_emails = {}
    if owner_ids:
        owner_stmt = select(User.id, User.email).where(User.id.in_(owner_ids))
        owner_res = await db.execute(owner_stmt)
        owner_emails = {r[0]: r[1] for r in owner_res.all()}
        
    joined_emails_by_session = {}
    if session_ids:
        joined_stmt = select(JoinedSession.session_id, User.email).join(User, JoinedSession.user_id == User.id).where(
            JoinedSession.session_id.in_(session_ids)
        )
        joined_res = await db.execute(joined_stmt)
        for s_id, email in joined_res.all():
            if s_id not in joined_emails_by_session:
                joined_emails_by_session[s_id] = []
            joined_emails_by_session[s_id].append(email)

    response_sessions = []
    for session in sessions:
        owner_email = owner_emails.get(session.user_id)
        participants = [owner_email] if owner_email else []
        joined_emails = joined_emails_by_session.get(session.id, [])
        participants.extend(joined_emails)
        
        response_sessions.append({
            "id": session.id,
            "user_id": session.user_id,
            "title": session.title,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "participants": list(set(participants)),
            "shared_url": None
        })
        
    return response_sessions


@router.get("/sessions/{session_id}/messages", response_model=List[ChatMessageResponse])
async def get_message_history(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves chronological message history for a specific chat session.
    Verifies that the session belongs to the requesting user.
    """
    # Fetch session to verify ownership
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
        
    await verify_session_access(session, current_user, db)
        
    # Get all messages associated with this session
    msg_stmt = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc())
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()
    
    return messages


@router.delete("/sessions/{session_id}", status_code=status.HTTP_200_OK)
async def delete_session(
    session_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Deletes a specific chat session and all its messages.
    """
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
        
    if session.user_id == current_user.id:
        await db.delete(session)
        await db.commit()
        return {"detail": "Chat session and all related conversation history deleted successfully."}
        
    check_stmt = select(JoinedSession).where(
        JoinedSession.user_id == current_user.id,
        JoinedSession.session_id == session.id
    )
    check_result = await db.execute(check_stmt)
    joined = check_result.scalar_one_or_none()
    if joined:
        await db.delete(joined)
        await db.commit()
        return {"detail": "Successfully left the shared chat session."}
        
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this chat session.")


@router.put("/sessions/{session_id}", response_model=ChatSessionResponse)
async def update_session_title(
    session_id: uuid.UUID,
    session_data: ChatSessionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Updates the title of a specific chat session.
    """
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
        
    await verify_session_access(session, current_user, db)
        
    if session_data.title:
        session.title = session_data.title.strip()
        
    await db.commit()
    await db.refresh(session)
    return session

# ==============================================================================
# CHAT MESSAGE STREAMING
# ==============================================================================

@router.post("/sessions/{session_id}/send")
async def send_message_stream(
    session_id: uuid.UUID,
    payload: ChatMessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Receives a message, saves it, and opens a Server-Sent Events (SSE) connection to stream 
    the empathetic companion response chunk-by-chunk using the Groq LLM service.
    """
    # 1. Verify session exists and belongs to the current user
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
        
    await verify_session_access(session, current_user, db)
        
    # 2. Check if we need to auto-update the title BEFORE adding the user message to DB
    should_update_title = False
    title_val = session.title.strip() if session.title else ""
    is_generic = (
        not title_val or 
        title_val in ("", "New Conversation", "Conversation", "Empty Chat", "New Chat") or
        title_val.startswith("Mixed:") or
        title_val.startswith("Mixed-") or
        "mixed-hey" in title_val.lower() or
        "mixed:" in title_val.lower()
    )
    if is_generic:
        should_update_title = True

    # 3. Save user message to database immediately
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.content
    )
    db.add(user_msg)
    
    if should_update_title:
        content_preview = payload.content.strip()
        clean_content = content_preview
        if clean_content.startswith("[Reply to:"):
            end_idx = clean_content.find("]")
            if end_idx != -1:
                clean_content = clean_content[end_idx+1:].strip()
        
        import re
        img_match = re.match(r"^\[Look at this image:\s*(.*?)\]\s*(.*)$", clean_content, re.DOTALL)
        file_match = re.match(r"^\[Look at this file:\s*(.*?)\]\s*(.*)$", clean_content, re.DOTALL)
        if img_match:
            inner = img_match.group(1)
            user_text = img_match.group(2).strip()
            explanation = inner
            if "|" in inner:
                parts = inner.split("|")
                explanation = parts[1] if len(parts) > 1 else parts[0]
            
            if user_text:
                session.title = await llm_service.generate_conversation_title(user_text)
            else:
                session.title = await llm_service.generate_conversation_title(f"Image: {explanation}")
        elif file_match:
            inner = file_match.group(1)
            user_text = file_match.group(2).strip()
            file_name = "Document"
            if "|" in inner:
                parts = inner.split("|")
                if len(parts) >= 2:
                    file_name = parts[1]
            if user_text:
                session.title = await llm_service.generate_conversation_title(user_text)
            else:
                session.title = f"File: {file_name}"[:50]
        elif clean_content.startswith("[Uploaded Document:"):
            try:
                parts = clean_content.split("Uploaded Document:")
                filename = parts[1].strip(" ]")
                session.title = f"Doc: {filename}"[:50]
            except Exception:
                session.title = "Document Upload"
        else:
            session.title = await llm_service.generate_conversation_title(clean_content)
    
    # 4. Update session updated_at timestamp
    from datetime import datetime, timezone
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    
    # 4. Fetch last 10 messages for conversational context (reduced from 20 to safeguard rate limits)
    msg_stmt = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.desc()).limit(10)
    msg_result = await db.execute(msg_stmt)
    history_reversed = msg_result.scalars().all()
    history = list(reversed(history_reversed))
    
    # Format messages array for LLM client: [{"role": "user", "content": "..."}]
    formatted_messages = [{"role": m.role, "content": get_clean_message_content(m.content)} for m in history]
    
    # 5. Retrieve long-term memories and PDF context
    # Fetch user specific memories matching the query
    memory_context = await memory_service.retrieve_relevant_memories(
        user_id=current_user.id,
        query_text=payload.content,
        limit=4
    )
    if memory_context and len(memory_context) > 1000:
        memory_context = memory_context[:1000] + "..."
    
    # Query across all user PDF collections for RAG context
    doc_stmt = select(PDFDocument).where(PDFDocument.user_id == current_user.id)
    doc_res = await db.execute(doc_stmt)
    user_docs = doc_res.scalars().all()
    
    # Identify targeted documents mentioned via @filename or @filename_without_extension in prompt
    import os
    targeted_docs = []
    content_lower = payload.content.lower()
    for doc in user_docs:
        base_name = os.path.splitext(doc.filename)[0]
        mention_with_ext = f"@{doc.filename}".lower()
        mention_no_ext = f"@{base_name}".lower()
        if mention_with_ext in content_lower or mention_no_ext in content_lower:
            targeted_docs.append(doc)
            
    pdf_snippets = []
    targeted_full_texts = []
    targeted_file_content = ""
    
    if targeted_docs:
        logger.info(f"Targeted full-text / RAG extraction activated for: {[d.filename for d in targeted_docs]}")
        
        # Clean query text by stripping targeted mentions so they do not pollute embedding similarity
        rag_query = payload.content
        for doc in targeted_docs:
            base_name = os.path.splitext(doc.filename)[0]
            mention_with_ext = f"@{doc.filename}"
            mention_no_ext = f"@{base_name}"
            import re
            rag_query = re.sub(re.escape(mention_with_ext), "", rag_query, flags=re.IGNORECASE)
            rag_query = re.sub(re.escape(mention_no_ext), "", rag_query, flags=re.IGNORECASE)
            
        rag_query = rag_query.strip()
        if not rag_query:
            rag_query = payload.content
            
        for doc in targeted_docs:
            doc_text = ""
            file_ext = doc.filename.split(".")[-1].lower() if "." in doc.filename else ""
            image_extensions = ["png", "jpg", "jpeg", "webp", "gif", "bmp"]
            
            if file_ext in image_extensions:
                try:
                    collections = [c.name for c in vector_service.client.list_collections()]
                    if doc.chroma_collection in collections:
                        coll = vector_service.client.get_collection(name=doc.chroma_collection)
                        res = coll.get()
                        if res and "documents" in res and res["documents"]:
                            doc_text = "\n\n".join(res["documents"])
                except Exception as e:
                    logger.error(f"Failed to fetch image description from ChromaDB for {doc.filename}: {str(e)}")
            else:
                if os.path.exists(doc.file_path):
                    try:
                        from app.routes.vision import (
                            extract_text_from_csv,
                            extract_text_from_docx,
                            extract_text_from_pptx,
                            extract_text_from_generic
                        )
                        from app.services.pdf_service import pdf_service
                        
                        if file_ext == "pdf":
                            doc_text = pdf_service.extract_text_from_pdf(doc.file_path)
                        elif file_ext == "csv":
                            doc_text = extract_text_from_csv(doc.file_path)
                        elif file_ext == "docx":
                            doc_text = extract_text_from_docx(doc.file_path)
                        elif file_ext == "pptx":
                            doc_text = extract_text_from_pptx(doc.file_path)
                        else:
                            doc_text = extract_text_from_generic(doc.file_path)
                    except Exception as e:
                        logger.error(f"Failed to extract full text from disk file {doc.file_path}: {str(e)}")
                        doc_text = f"[Failed to read document content: {str(e)}]"
                else:
                    doc_text = f"[File not found on server disk: {doc.filename}]"
            
            # Check if text length is under the safe limit for full-text injection (40,000 characters)
            if doc_text and len(doc_text) <= 40000:
                targeted_full_texts.append(
                    f"--- START OF FILE CONTENT: {doc.filename} ---\n"
                    f"{doc_text}\n"
                    f"--- END OF FILE CONTENT: {doc.filename} ---"
                )
            else:
                # If too large, fall back to RAG top-6 search chunks
                logger.info(f"Targeted doc {doc.filename} size ({len(doc_text) if doc_text else 0} chars) exceeds full-text threshold. Falling back to dense RAG.")
                targeted_full_texts.append(
                    f"--- FILE INFO: {doc.filename} (Large File - Using Similarity Search) ---\n"
                    f"Note: This file is too large for full injection. Top semantic matches are included in the RAG section below."
                )
                
                snippet_results = await vector_service.query_similarity(
                    collection_name=doc.chroma_collection,
                    query_text=rag_query,
                    limit=6
                )
                for snip in snippet_results:
                    text = snip['text'].strip()
                    if len(text) > 1200:
                        text = text[:1200] + "..."
                    pdf_snippets.append(f"[{doc.filename}]: \"{text}\"")
                    
        pdf_context = "\n".join(pdf_snippets) if pdf_snippets else ""
        if len(pdf_context) > 6000:
            pdf_context = pdf_context[:6000] + "\n... (context truncated for rate-limit protection) ..."
            
        targeted_file_content = "\n\n".join(targeted_full_texts)
    else:
        for doc in user_docs:
            if len(pdf_snippets) >= 3:
                break
            snippet_results = await vector_service.query_similarity(
                collection_name=doc.chroma_collection,
                query_text=payload.content,
                limit=1 if len(user_docs) > 2 else 2
            )
            for snip in snippet_results:
                text = snip['text'].strip()
                # Defensive truncation for individual snippet size to fit rate limits
                if len(text) > 600:
                    text = text[:600] + "..."
                pdf_snippets.append(f"[{doc.filename}]: \"{text}\"")
                if len(pdf_snippets) >= 3:
                    break
                
        pdf_context = "\n".join(pdf_snippets) if pdf_snippets else ""
        if len(pdf_context) > 1800:
            pdf_context = pdf_context[:1800] + "\n... (context truncated for rate-limit protection) ..."
    
    # Compile the full list of files stored in the user's Mind Space (Document Hub)
    mind_space_docs = "\n".join([f"- {doc.filename}" for doc in user_docs]) if user_docs else ""
    
    # 6. Build the dynamic custom persona prompt for Maya
    system_prompt = llm_service.build_system_prompt(
        user_email=current_user.email,
        conversation_title=session.title,
        memory_context=memory_context,
        pdf_context=pdf_context,
        mind_space_docs=mind_space_docs,
        targeted_file_content=targeted_file_content
    )
    
    if getattr(payload, "is_voice", False):
        system_prompt += "\n\nCRITICAL INSTRUCTION: The user is speaking to you using Voice Mode. You MUST reply strictly in 1 or 2 short, conversational sentences. Keep it extremely brief and natural for spoken dialogue. DO NOT use markdown formatting, lists, or long explanations."
        
    
    # 7. Asynchronous SSE Generator function
    async def event_generator():
        complete_ai_response = []
        
        # Start streaming from Groq
        async for token in llm_service.generate_response_stream(formatted_messages, system_prompt):
            complete_ai_response.append(token)
            
            # Format SSE payload: "data: {json_content}\n\n"
            yield f"data: {json.dumps({'token': token})}\n\n"
            
        full_response_text = "".join(complete_ai_response)
        
        # Save companion's complete response to database in an isolated session
        # Streaming runs outside the request's HTTP scope, so we use a dedicated SessionLocal context
        async with SessionLocal() as db_session:
            ai_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_response_text
            )
            db_session.add(ai_msg)
            
            # Touch updated_at for session
            stmt_sess = select(ChatSession).where(ChatSession.id == session_id)
            sess_res = await db_session.execute(stmt_sess)
            s_obj = sess_res.scalar_one_or_none()
            if s_obj:
                s_obj.title = s_obj.title  # Triggers updated_at automatically via SQLAlchemy onupdate
                db_session.add(s_obj)
            
            await db_session.commit()
            
        # 8. Asynchronously analyze and extract new semantic memories in the background
        try:
            await memory_service.extract_and_save_memories(
                user_id=current_user.id,
                user_message=payload.content,
                assistant_response=full_response_text
            )
        except Exception as e:
            logger.error(f"Error in background memory extraction: {str(e)}")
            
        # Send closing SSE message to inform frontend that generation is complete
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/shared/{session_id}")
async def get_shared_session_history(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Public read-only endpoint to retrieve session title and message logs
    for sharing purposes, without requiring authentication.
    """
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared chat session not found.")
        
    msg_stmt = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.asc())
    msg_result = await db.execute(msg_stmt)
    messages = msg_result.scalars().all()
    
    return {
        "title": session.title,
        "messages": [
            {
                "id": str(msg.id),
                "role": msg.role,
                "content": msg.content,
                "created_at": msg.created_at.isoformat() if msg.created_at else None
            }
            for msg in messages
        ]
    }


@router.post("/shared/{session_id}/send")
async def send_shared_message_stream(
    session_id: uuid.UUID,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Public endpoint to send a message to a shared chat session (group chat room) 
    and stream back the response.
    """
    # 1. Verify session exists
    stmt = select(ChatSession).where(ChatSession.id == session_id)
    result = await db.execute(stmt)
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found.")
        
    # 2. Save user message to database immediately
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=payload.content
    )
    db.add(user_msg)
    
    # Touch session to trigger update
    from datetime import datetime, timezone
    session.updated_at = datetime.now(timezone.utc)
    await db.commit()
    
    # 3. Fetch last 10 messages for conversational context
    msg_stmt = select(ChatMessage).where(ChatMessage.session_id == session_id).order_by(ChatMessage.created_at.desc()).limit(10)
    msg_result = await db.execute(msg_stmt)
    history_reversed = msg_result.scalars().all()
    history = list(reversed(history_reversed))
    
    # Format messages array for LLM client: [{"role": "user", "content": "..."}]
    formatted_messages = [{"role": m.role, "content": get_clean_message_content(m.content)} for m in history]
    
    # 4. Retrieve long-term memories and PDF context of the session owner
    memory_context = await memory_service.retrieve_relevant_memories(
        user_id=session.user_id,
        query_text=payload.content,
        limit=4
    )
    if memory_context and len(memory_context) > 1000:
        memory_context = memory_context[:1000] + "..."
    
    # Query across session owner's PDF collections for RAG context
    doc_stmt = select(PDFDocument).where(PDFDocument.user_id == session.user_id)
    doc_res = await db.execute(doc_stmt)
    user_docs = doc_res.scalars().all()
    
    pdf_snippets = []
    for doc in user_docs:
        if len(pdf_snippets) >= 3:
            break
        snippet_results = await vector_service.query_similarity(
            collection_name=doc.chroma_collection,
            query_text=payload.content,
            limit=1 if len(user_docs) > 2 else 2
        )
        for snip in snippet_results:
            text = snip['text'].strip()
            if len(text) > 600:
                text = text[:600] + "..."
            pdf_snippets.append(f"[{doc.filename}]: \"{text}\"")
            if len(pdf_snippets) >= 3:
                break
                
    pdf_context = "\n".join(pdf_snippets) if pdf_snippets else ""
    if len(pdf_context) > 1800:
        pdf_context = pdf_context[:1800] + "\n... (context truncated for rate-limit protection) ..."
    
    # Compile list of files in session owner's Mind Space
    mind_space_docs = "\n".join([f"- {doc.filename}" for doc in user_docs]) if user_docs else ""
    
    # Get session owner's email to pass to build_system_prompt
    from app.models import User as DBUser
    owner_stmt = select(DBUser).where(DBUser.id == session.user_id)
    owner_res = await db.execute(owner_stmt)
    owner = owner_res.scalar_one_or_none()
    owner_email = owner.email if owner else "shared@maya.ai"
    
    # 5. Build prompt
    system_prompt = llm_service.build_system_prompt(
        user_email=owner_email,
        conversation_title=session.title,
        memory_context=memory_context,
        pdf_context=pdf_context,
        mind_space_docs=mind_space_docs,
        targeted_file_content=""
    )
    
    if getattr(payload, "is_voice", False):
        system_prompt += "\n\nCRITICAL INSTRUCTION: The user is speaking to you using Voice Mode. You MUST reply strictly in 1 or 2 short, conversational sentences. Keep it extremely brief and natural for spoken dialogue. DO NOT use markdown formatting, lists, or long explanations."
        
    
    # 6. Asynchronous SSE Generator function
    async def event_generator():
        complete_ai_response = []
        
        async for token in llm_service.generate_response_stream(formatted_messages, system_prompt):
            complete_ai_response.append(token)
            yield f"data: {json.dumps({'token': token})}\n\n"
            
        full_response_text = "".join(complete_ai_response)
        
        # Save companion's complete response to database
        async with SessionLocal() as db_session:
            ai_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_response_text
            )
            db_session.add(ai_msg)
            
            stmt_sess = select(ChatSession).where(ChatSession.id == session_id)
            sess_res = await db_session.execute(stmt_sess)
            s_obj = sess_res.scalar_one_or_none()
            if s_obj:
                s_obj.title = s_obj.title
                db_session.add(s_obj)
            
            await db_session.commit()
            
        # Extract new memories for the session owner
        try:
            await memory_service.extract_and_save_memories(
                user_id=session.user_id,
                user_message=payload.content,
                assistant_response=full_response_text
            )
        except Exception as e:
            logger.error(f"Error in background memory extraction: {str(e)}")
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_message(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Deletes a specific chat message if the current user owns its session.
    """
    stmt = select(ChatMessage).where(ChatMessage.id == message_id)
    result = await db.execute(stmt)
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    
    session_stmt = select(ChatSession).where(ChatSession.id == message.session_id)
    session_result = await db.execute(session_stmt)
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    
    await verify_session_access(session, current_user, db)
    
    await db.delete(message)
    await db.commit()
    return None


@router.put("/messages/{message_id}", response_model=ChatMessageResponse)
async def edit_chat_message(
    message_id: uuid.UUID,
    payload: ChatMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Edits a specific chat message's content if the current user owns its session.
    """
    stmt = select(ChatMessage).where(ChatMessage.id == message_id)
    result = await db.execute(stmt)
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")
    
    session_stmt = select(ChatSession).where(ChatSession.id == message.session_id)
    session_result = await db.execute(session_stmt)
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    
    await verify_session_access(session, current_user, db)
    
    message.content = payload.content
    await db.commit()
    await db.refresh(message)
    return message


@router.post("/messages/{message_id}/regenerate")
async def regenerate_after_edit(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Regenerates Maya's response for an already-edited user message.
    Steps:
      1. Verify the user message exists and the session is owned by the caller.
      2. Delete the assistant reply that immediately follows it (if any).
      3. Fetch session history UP TO and INCLUDING the edited user message.
      4. Stream a fresh AI response and persist it to the database.
    """
    # 1. Fetch the user message and verify ownership
    stmt = select(ChatMessage).where(ChatMessage.id == message_id)
    result = await db.execute(stmt)
    user_msg = result.scalar_one_or_none()
    if not user_msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

    session_stmt = select(ChatSession).where(ChatSession.id == user_msg.session_id)
    session_result = await db.execute(session_stmt)
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    await verify_session_access(session, current_user, db)

    # 2. Find and delete the assistant message that immediately follows this user message
    next_msg_stmt = (
        select(ChatMessage)
        .where(
            ChatMessage.session_id == user_msg.session_id,
            ChatMessage.created_at > user_msg.created_at,
            ChatMessage.role == "assistant"
        )
        .order_by(ChatMessage.created_at.asc())
        .limit(1)
    )
    next_msg_result = await db.execute(next_msg_stmt)
    old_reply = next_msg_result.scalar_one_or_none()
    if old_reply:
        await db.delete(old_reply)
        await db.commit()

    # 3. Fetch conversation history up to and including the edited user message (max 10)
    history_stmt = (
        select(ChatMessage)
        .where(
            ChatMessage.session_id == user_msg.session_id,
            ChatMessage.created_at <= user_msg.created_at
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_result = await db.execute(history_stmt)
    history_reversed = history_result.scalars().all()
    history = list(reversed(history_reversed))
    formatted_messages = [{"role": m.role, "content": get_clean_message_content(m.content)} for m in history]

    # 4. Build full LLM context (memories, RAG, persona) — mirrors send_message_stream
    memory_context = await memory_service.retrieve_relevant_memories(
        user_id=current_user.id,
        query_text=get_clean_message_content(user_msg.content),
        limit=4
    )
    if memory_context and len(memory_context) > 1000:
        memory_context = memory_context[:1000] + "..."

    doc_stmt = select(PDFDocument).where(PDFDocument.user_id == current_user.id)
    doc_res = await db.execute(doc_stmt)
    user_docs = doc_res.scalars().all()

    pdf_snippets = []
    for doc in user_docs:
        if len(pdf_snippets) >= 3:
            break
        snippet_results = await vector_service.query_similarity(
            collection_name=doc.chroma_collection,
            query_text=get_clean_message_content(user_msg.content),
            limit=1 if len(user_docs) > 2 else 2
        )
        for snip in snippet_results:
            text = snip['text'].strip()
            if len(text) > 600:
                text = text[:600] + "..."
            pdf_snippets.append(f"[{doc.filename}]: \"{text}\"")
            if len(pdf_snippets) >= 3:
                break

    pdf_context = "\n".join(pdf_snippets) if pdf_snippets else ""
    if len(pdf_context) > 1800:
        pdf_context = pdf_context[:1800] + "\n... (context truncated) ..."

    mind_space_docs = "\n".join([f"- {doc.filename}" for doc in user_docs]) if user_docs else ""

    system_prompt = llm_service.build_system_prompt(
        user_email=current_user.email,
        conversation_title=session.title,
        memory_context=memory_context,
        pdf_context=pdf_context,
        mind_space_docs=mind_space_docs,
        targeted_file_content=""
    )

    session_id = user_msg.session_id
    user_content = get_clean_message_content(user_msg.content)

    # 5. Stream the fresh regenerated response
    async def event_generator():
        complete_ai_response = []

        async for token in llm_service.generate_response_stream(formatted_messages, system_prompt):
            complete_ai_response.append(token)
            yield f"data: {json.dumps({'token': token})}\n\n"

        full_response_text = "".join(complete_ai_response)

        # Persist the new assistant message in an isolated DB session
        async with SessionLocal() as db_session:
            ai_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_response_text
            )
            db_session.add(ai_msg)

            stmt_sess = select(ChatSession).where(ChatSession.id == session_id)
            sess_res = await db_session.execute(stmt_sess)
            s_obj = sess_res.scalar_one_or_none()
            if s_obj:
                s_obj.title = s_obj.title
                db_session.add(s_obj)

            await db_session.commit()

        try:
            await memory_service.extract_and_save_memories(
                user_id=current_user.id,
                user_message=user_content,
                assistant_response=full_response_text
            )
        except Exception as e:
            logger.error(f"Memory extraction error on regenerate: {str(e)}")

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
