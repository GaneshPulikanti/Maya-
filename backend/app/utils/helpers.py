import os
import re
import unicodedata
from typing import List

def clean_filename(filename: str) -> str:
    """
    Sanitizes a filename to make it secure against directory traversal attacks.
    Removes characters outside ASCII alphanumeric, hyphens, underscores, and dots.
    """
    # Normalize unicode characters to their closest ASCII equivalents
    filename = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode('ascii')
    # Remove directory path parts
    filename = os.path.basename(filename)
    # Replace non-alphanumeric/hyphen/underscore/dot characters with underscores
    filename = re.sub(r'[^a-zA-Z0-9._-]', '_', filename)
    return filename


class RecursiveCharacterTextSplitter:
    """
    A pure Python implementation of a recursive text splitter for document chunking.
    Avoids dragging in heavy LangChain packages while preserving sophisticated boundary checks.
    """
    def __init__(self, chunk_size: int = 1000, chunk_overlap: int = 200, separators: List[str] = None):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        # Standard separators ordered from largest logical block (paragraph) to smallest (characters)
        self.separators = separators or ["\n\n", "\n", " ", ""]

    def split_text(self, text: str) -> List[str]:
        """
        Splits text into chunks using recursive separator inspection.
        """
        if not text:
            return []
            
        chunks = []
        pending_text = text.strip()
        
        while len(pending_text) > 0:
            if len(pending_text) <= self.chunk_size:
                chunks.append(pending_text)
                break
                
            # Find the best separator to split on
            split_idx = -1
            chosen_separator = ""
            
            for sep in self.separators:
                # Look for separator within the chunk size boundary
                # We want to find the LAST occurrence of the separator within chunk_size
                if sep == "":
                    # Character level split as absolute fallback
                    split_idx = self.chunk_size
                    chosen_separator = ""
                    break
                
                idx = pending_text[:self.chunk_size].rfind(sep)
                if idx != -1:
                    split_idx = idx
                    chosen_separator = sep
                    break
            
            if split_idx == -1:
                # If no separator was found, force-cut at chunk_size
                split_idx = self.chunk_size
                chosen_separator = ""
                
            # Perform split
            chunk = pending_text[:split_idx].strip()
            chunks.append(chunk)
            
            # Move index forward, leaving overlap
            step_forward = split_idx + len(chosen_separator)
            # Apply overlap boundary
            overlap_start = max(0, step_forward - self.chunk_overlap)
            
            # If overlap start creates zero progress, force advance
            if step_forward <= self.chunk_overlap:
                overlap_start = step_forward
                
            pending_text = pending_text[overlap_start:].strip()
            
        return chunks
