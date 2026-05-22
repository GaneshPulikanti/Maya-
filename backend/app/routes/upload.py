import logging
import os
import uuid
import shutil
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User, PDFDocument, ChatMessage
from app.schemas import PDFDocumentResponse
from app.routes.auth import get_current_user
from app.utils.helpers import clean_filename
from app.services.pdf_service import pdf_service
from app.services.vector_service import vector_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/upload", tags=["Document Upload & RAG Indexing"])


@router.post("/pdf", response_model=PDFDocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_pdf(
    file: UploadFile = File(...),
    session_id: Optional[uuid.UUID] = Query(None, description="Active chat session ID to link the upload to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Uploads a document, extracts text, generates embeddings, indexes it into ChromaDB, 
    and saves document metadata in PostgreSQL for Retrieval-Augmented Generation (RAG).
    Logs the upload event into the conversation history if a session_id is provided.
    """
    # 1. Validate file extension
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    allowed_extensions = ["pdf", "csv", "docx", "pptx", "xlsx", "txt", "md", "log", "json", "jsonl", "xml", "html", "js", "ts", "py", "css"]
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file format. Supported documents are: {', '.join(allowed_extensions)}"
        )
        
    # 2. Sanitize and prepare paths
    safe_filename = clean_filename(file.filename)
    doc_id = uuid.uuid4()
    
    # Ensure upload directory exists
    pdf_upload_dir = os.path.join(settings.UPLOAD_DIR, "pdfs")
    os.makedirs(pdf_upload_dir, exist_ok=True)
    
    # Save path named after UUID to prevent file clashes on disk
    file_extension = os.path.splitext(safe_filename)[1]
    saved_file_path = os.path.join(pdf_upload_dir, f"{doc_id.hex}{file_extension}")
    
    try:
        # Save file to disk
        with open(saved_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        logger.info(f"Document saved physically to disk at: {saved_file_path}")
        
    except Exception as e:
        logger.error(f"Failed to save uploaded file to disk: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save uploaded file on host server."
        )
        
    # 3. Create database entry
    chroma_collection = f"doc_{doc_id.hex}"
    
    new_doc = PDFDocument(
        id=doc_id,
        user_id=current_user.id,
        filename=safe_filename,
        file_path=saved_file_path,
        chroma_collection=chroma_collection
    )
    
    try:
        # 4. Extract and chunk document content
        if file_ext == "pdf":
            chunks = pdf_service.process_and_chunk(saved_file_path)
        else:
            from app.routes.vision import (
                extract_text_from_csv,
                extract_text_from_docx,
                extract_text_from_pptx,
                extract_text_from_generic
            )
            if file_ext == "csv":
                full_text = extract_text_from_csv(saved_file_path)
            elif file_ext == "docx":
                full_text = extract_text_from_docx(saved_file_path)
            elif file_ext == "pptx":
                full_text = extract_text_from_pptx(saved_file_path)
            else:
                full_text = extract_text_from_generic(saved_file_path)
                
            chunks = pdf_service.chunk_pdf_text(full_text)
        
        if not chunks:
            raise ValueError("No extractable text segments found in the uploaded document. Empty document.")
            
        # 5. Insert into ChromaDB
        chunk_ids = [f"chunk_{doc_id.hex}_{idx}" for idx in range(len(chunks))]
        chunk_metadatas = [{
            "user_id": str(current_user.id),
            "doc_id": str(doc_id),
            "filename": safe_filename,
            "chunk_index": idx
        } for idx in range(len(chunks))]
        
        vector_success = await vector_service.add_texts(
            collection_name=chroma_collection,
            texts=chunks,
            ids=chunk_ids,
            metadatas=chunk_metadatas
        )
        
        if not vector_success:
            raise RuntimeError("ChromaDB indexing transaction failed.")
            
        # Save SQL metadata record only if vector indexing succeeded
        db.add(new_doc)
        
        # If session_id is active, inject a clean upload logs event directly into the conversation history
        if session_id:
            user_msg = ChatMessage(
                session_id=session_id,
                role="user",
                content=f"[Uploaded Document: {safe_filename}]"
            )
            ai_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=f"*Maya smiles warmly, brushing a strand of hair behind her ear* \"I have processed and successfully indexed your document: **{safe_filename}**! I've tucked it safe in my mind space. Feel free to ask me anything about its contents anytime you want!\""
            )
            db.add(user_msg)
            db.add(ai_msg)

        await db.commit()
        await db.refresh(new_doc)
        
        logger.info(f"✓ Document RAG index compiled successfully: {safe_filename}")
        return new_doc
        
    except Exception as e:
        logger.error(f"Error compiling RAG indexing for {safe_filename}: {str(e)}")
        # Clean up saved disk file if indexing fails
        if os.path.exists(saved_file_path):
            os.remove(saved_file_path)
        # Clear vector collection if partially written
        vector_service.delete_collection(chroma_collection)
        
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process and index document: {str(e)}"
        )


@router.post("/image", response_model=PDFDocumentResponse, status_code=status.HTTP_201_CREATED)
async def upload_image(
    file: UploadFile = File(...),
    session_id: Optional[uuid.UUID] = Query(None, description="Active chat session ID to link the upload to"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Uploads an image, extracts its semantic content using the Groq Llama-4 Vision model,
    saves the image metadata in PostgreSQL, and indexes the description in ChromaDB for RAG.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Only image files are accepted."
        )
    # Sanitize and prepare paths
    safe_filename = clean_filename(file.filename)
    doc_id = uuid.uuid4()
    
    # Save the physical image locally
    static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
    uploads_dir = os.path.join(static_dir, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    
    file_ext = os.path.splitext(safe_filename)[1] or ".jpg"
    unique_filename = f"{doc_id.hex}{file_ext}"
    saved_file_path = os.path.join(uploads_dir, unique_filename)
    
    try:
        image_bytes = await file.read()
        with open(saved_file_path, "wb") as buffer:
            buffer.write(image_bytes)
            
        logger.info(f"Image saved physically at: {saved_file_path}")
        
    except Exception as e:
        logger.error(f"Failed to save uploaded image: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save image on host server."
        )

    # Call vision service to analyze the image
    try:
        from app.services.vision_service import vision_service
        explanation = await vision_service.analyze_image(image_bytes, file.content_type)
    except Exception as e:
        logger.error(f"Vision analysis failed for uploaded doc-image: {str(e)}")
        if os.path.exists(saved_file_path):
            os.remove(saved_file_path)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to analyze image: {str(e)}"
        )

    # Index the analyzed text in ChromaDB and SQL database
    chroma_collection = f"doc_{doc_id.hex}"
    
    new_doc = PDFDocument(
        id=doc_id,
        user_id=current_user.id,
        filename=safe_filename,
        file_path=saved_file_path,
        chroma_collection=chroma_collection
    )
    
    try:
        # We index the explanation text in vector database for RAG
        chunks = [explanation]
        chunk_ids = [f"chunk_{doc_id.hex}_0"]
        chunk_metadatas = [{
            "user_id": str(current_user.id),
            "doc_id": str(doc_id),
            "filename": safe_filename,
            "chunk_index": 0
        }]
        
        vector_success = await vector_service.add_texts(
            collection_name=chroma_collection,
            texts=chunks,
            ids=chunk_ids,
            metadatas=chunk_metadatas
        )
        
        if not vector_success:
            raise RuntimeError("ChromaDB indexing failed.")
            
        db.add(new_doc)
        
        if session_id:
            user_msg = ChatMessage(
                session_id=session_id,
                role="user",
                content=f"[Uploaded Image Document: {safe_filename}]"
            )
            ai_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=f"*Maya smiles softly, locking eyes with you* \"I've added the image **{safe_filename}** to my mind space and analyzed it. I see: {explanation[:150]}... I will remember this and use it to help you in other chats too!\""
            )
            db.add(user_msg)
            db.add(ai_msg)
            
        await db.commit()
        await db.refresh(new_doc)
        
        logger.info(f"✓ Image RAG index compiled successfully: {safe_filename}")
        return new_doc
    except Exception as e:
        logger.error(f"Error indexing image: {str(e)}")
        if os.path.exists(saved_file_path):
            os.remove(saved_file_path)
        vector_service.delete_collection(chroma_collection)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Failed to process and index image: {str(e)}"
        )


@router.get("/documents", response_model=List[PDFDocumentResponse])
async def list_documents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Lists all uploaded documents and RAG indices owned by the authenticated user.
    """
    stmt = select(PDFDocument).where(PDFDocument.user_id == current_user.id).order_by(PDFDocument.created_at.desc())
    result = await db.execute(stmt)
    documents = result.scalars().all()
    return documents


@router.delete("/documents/{doc_id}", status_code=status.HTTP_200_OK)
async def delete_document(
    doc_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Deletes an uploaded document, cleans up the disk file, and wipes its semantic ChromaDB vector index.
    """
    stmt = select(PDFDocument).where(PDFDocument.id == doc_id)
    result = await db.execute(stmt)
    document = result.scalar_one_or_none()
    
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
        
    if document.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this document.")
        
    # A. Delete vector database index collection
    vector_service.delete_collection(document.chroma_collection)
    
    # B. Delete physical file from disk
    if os.path.exists(document.file_path):
        try:
            os.remove(document.file_path)
            logger.info(f"Cleaned up document disk file: {document.file_path}")
        except Exception as e:
            logger.error(f"Failed to delete disk file {document.file_path}: {str(e)}")
            
    # C. Delete database metadata entry
    await db.delete(document)
    await db.commit()
    
    return {"detail": "Document record, disk file, and vector indices deleted successfully."}
