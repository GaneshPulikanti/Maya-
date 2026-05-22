import logging
import os
import uuid
import csv
import zipfile
import xml.etree.ElementTree as ET
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from app.routes.auth import get_current_user
from app.models import User
from app.services.vision_service import vision_service
from app.services.pdf_service import pdf_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/vision", tags=["Vision & Universal File Analysis"])

MAX_EXTRACT_CHARS = 80000

def extract_text_from_csv(file_path: str) -> str:
    lines = []
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            for idx, row in enumerate(reader):
                if idx > 2000:  # Safety ceiling
                    lines.append("... [CSV content truncated due to length limits] ...")
                    break
                lines.append(", ".join(row))
        return "\n".join(lines)
    except Exception as e:
        return f"[Failed to extract CSV content: {str(e)}]"

def extract_text_from_docx(file_path: str) -> str:
    try:
        with zipfile.ZipFile(file_path) as docx:
            doc_xml = docx.read('word/document.xml')
            root = ET.fromstring(doc_xml)
            ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
            paragraphs = []
            for p in root.findall('.//w:p', ns):
                p_text = []
                for t in p.findall('.//w:t', ns):
                    if t.text:
                        p_text.append(t.text)
                if p_text:
                    paragraphs.append(''.join(p_text))
            return '\n\n'.join(paragraphs)
    except Exception as e:
        return f"[Failed to extract DOCX content: {str(e)}]"

def extract_text_from_pptx(file_path: str) -> str:
    try:
        with zipfile.ZipFile(file_path) as pptx:
            slide_files = sorted(
                [f for f in pptx.namelist() if f.startswith('ppt/slides/slide') and f.endswith('.xml')],
                key=lambda x: int(''.join(filter(str.isdigit, x)) or 0)
            )
            full_text = []
            ns = {
                'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
                'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'
            }
            for slide_file in slide_files:
                slide_xml = pptx.read(slide_file)
                root = ET.fromstring(slide_xml)
                slide_text = []
                for t in root.findall('.//a:t', ns):
                    if t.text:
                        slide_text.append(t.text)
                if slide_text:
                    full_text.append(f"--- Slide {os.path.basename(slide_file)} ---\n" + "\n".join(slide_text))
            return "\n\n".join(full_text)
    except Exception as e:
        return f"[Failed to extract PPTX content: {str(e)}]"

def extract_text_from_generic(file_path: str) -> str:
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return f.read()
    except Exception as e:
        return f"[Failed to extract text: {str(e)}]"

@router.post("/analyze", status_code=status.HTTP_200_OK)
async def analyze_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user)
):
    """
    Analyzes an uploaded file.
    If it is an image, it uses Llama Vision model for visual explanation.
    If it is a document (PDF, CSV, TXT, DOCX, PPTX), it extracts direct plain text for prompt injection.
    """
    file_ext = file.filename.split(".")[-1].lower() if "." in file.filename else ""
    
    try:
        # Save file physically to disk to serve in chat history download/preview
        static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
        uploads_dir = os.path.join(static_dir, "uploads")
        os.makedirs(uploads_dir, exist_ok=True)

        unique_filename = f"{uuid.uuid4()}.{file_ext}" if file_ext else str(uuid.uuid4())
        dest_path = os.path.join(uploads_dir, unique_filename)
        
        file_bytes = await file.read()
        with open(dest_path, "wb") as f:
            f.write(file_bytes)
            
        logger.info(f"File uploaded and saved: {file.filename} -> {unique_filename}")

        explanation = ""
        file_type = "other"

        # Determine file type and extract contents
        if file.content_type.startswith("image/"):
            file_type = "image"
            explanation = await vision_service.analyze_image(file_bytes, file.content_type)
        elif file_ext == "pdf":
            file_type = "pdf"
            explanation = pdf_service.extract_text_from_pdf(dest_path)
        elif file_ext == "csv":
            file_type = "csv"
            explanation = extract_text_from_csv(dest_path)
        elif file_ext == "docx":
            file_type = "docx"
            explanation = extract_text_from_docx(dest_path)
        elif file_ext == "pptx":
            file_type = "pptx"
            explanation = extract_text_from_pptx(dest_path)
        elif file_ext in ["txt", "md", "log", "json", "jsonl", "xml", "html", "js", "ts", "py", "css"]:
            file_type = "txt"
            explanation = extract_text_from_generic(dest_path)
        else:
            # Fallback: check if text-based by looking for null bytes
            is_binary = b'\x00' in file_bytes[:1024]
            if not is_binary:
                file_type = "txt"
                explanation = extract_text_from_generic(dest_path)
            else:
                file_type = "other"
                explanation = f"[Binary file: {file.filename}. Content cannot be directly extracted as text.]"

        # Truncate content if it exceeds the max allowed character count
        if len(explanation) > MAX_EXTRACT_CHARS:
            explanation = explanation[:MAX_EXTRACT_CHARS] + "\n\n... [File content truncated for size limits] ..."

        file_url = f"/api/static/uploads/{unique_filename}"
        
        return {
            "explanation": explanation,
            "image_url": file_url,
            "file_type": file_type,
            "file_name": file.filename
        }
        
    except Exception as e:
        logger.error(f"File analysis route failed: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to analyze file: {str(e)}"
        )

