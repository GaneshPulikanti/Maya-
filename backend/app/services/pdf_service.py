import os
import logging
from typing import List, Dict, Any
import pypdf
from app.utils.helpers import RecursiveCharacterTextSplitter

logger = logging.getLogger(__name__)

class PDFService:
    """
    Service responsible for reading, cleaning, and chunking uploaded PDF documents.
    Operates using pure-Python pypdf parsing and integrates with the custom RecursiveCharacterTextSplitter.
    """
    def __init__(self):
        # Initialize the custom text splitter with typical boundaries optimized for RAG
        # 1000 character chunks with 200 character overlap guarantees semantic containment
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=300
        )

    def extract_text_from_pdf(self, file_path: str) -> str:
        """
        Reads all pages of a PDF from disk and extracts plain text.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"PDF file not found at path: {file_path}")
            
        logger.info(f"Extracting text from PDF: {file_path}")
        text_content = []
        
        try:
            reader = pypdf.PdfReader(file_path)
            total_pages = len(reader.pages)
            logger.info(f"PDF has {total_pages} pages.")
            
            for page_num, page in enumerate(reader.pages):
                page_text = page.extract_text()
                if page_text:
                    # Clean up basic spacing anomalies
                    cleaned_page_text = page_text.strip()
                    if cleaned_page_text:
                        text_content.append(cleaned_page_text)
                        
            full_text = "\n\n--- PAGE BREAK ---\n\n".join(text_content)
            logger.info(f"✓ Successfully extracted {len(full_text)} characters of text from PDF.")
            return full_text
            
        except Exception as e:
            logger.error(f"Error occurred while parsing PDF {file_path}: {str(e)}")
            raise RuntimeError(f"Failed to parse PDF document: {str(e)}")

    def chunk_pdf_text(self, text: str) -> List[str]:
        """
        Applies recursive text splitting to decompose the continuous text
        into overlapping semantic chunks.
        """
        return self.splitter.split_text(text)

    def process_and_chunk(self, file_path: str) -> List[str]:
        """
        Facilitates the complete extraction and chunking pipeline for a PDF document.
        """
        full_text = self.extract_text_from_pdf(file_path)
        chunks = self.chunk_pdf_text(full_text)
        logger.info(f"Decomposed PDF into {len(chunks)} overlapping semantic segments.")
        return chunks

# Instantiate global service singleton
pdf_service = PDFService()
