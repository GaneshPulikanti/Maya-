import logging
from typing import List, Dict, Any
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

# pyrefly: ignore [missing-import]
from app.database import get_db 
# pyrefly: ignore [missing-import]
from app.models import User
# pyrefly: ignore [missing-import]
from app.routes.auth import get_current_user
# pyrefly: ignore [missing-import]
from app.services.vector_service import vector_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/memory", tags=["Companion Memory Management"])


@router.get("", response_model=List[Dict[str, Any]])
async def get_all_memories(current_user: User = Depends(get_current_user)):
    """
    Retrieves all biographical facts and semantic memories currently stored 
    for the authenticated user.
    """
    collection_name = f"user_mem_{current_user.id.hex}"
    
    try:
        collections = [c.name for c in vector_service.client.list_collections()]
        if collection_name not in collections:
            return []
            
        collection = vector_service.client.get_collection(name=collection_name)
        
        # Get all records from ChromaDB collection
        memories_data = collection.get()
        
        formatted_memories = []
        if memories_data and "documents" in memories_data and memories_data["documents"]:
            ids = memories_data["ids"]
            documents = memories_data["documents"]
            metadatas = memories_data["metadatas"] or [{}] * len(documents)
            
            for uid, doc, meta in zip(ids, documents, metadatas):
                # Clean timestamp if present
                timestamp = meta.get("timestamp", "")
                
                formatted_memories.append({
                    "id": uid,
                    "text": doc,
                    "timestamp": timestamp
                })
                
        # Sort memories by timestamp or text for readability
        return formatted_memories
        
    except Exception as e:
        logger.error(f"Failed to fetch memories for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve semantic memories."
        )


@router.delete("/items/{memory_id}", status_code=status.HTTP_200_OK)
async def delete_memory_item(
    memory_id: str,
    current_user: User = Depends(get_current_user)
):
    """
    Deletes a specific memory item from the companion's long-term database.
    """
    collection_name = f"user_mem_{current_user.id.hex}"
    
    try:
        # Check if collection exists
        collections = [c.name for c in vector_service.client.list_collections()]
        if collection_name not in collections:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory store empty or not initialized.")
            
        collection = vector_service.client.get_collection(name=collection_name)
        
        # Verify the record exists and belongs to the user
        record = collection.get(ids=[memory_id])
        if not record or not record["ids"]:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Memory item not found.")
            
        # Delete item
        success = vector_service.delete_texts(collection_name=collection_name, ids=[memory_id])
        if not success:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete memory item.")
            
        return {"detail": "Memory item deleted successfully."}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete memory item {memory_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error executing deletion."
        )


@router.delete("/clear", status_code=status.HTTP_200_OK)
async def clear_all_memories(current_user: User = Depends(get_current_user)):
    """
    Wipes the entire vector collection containing the companion's memories about the user.
    Warning: This resets conversational context and partner intimacy completely.
    """
    collection_name = f"user_mem_{current_user.id.hex}"
    
    try:
        collections = [c.name for c in vector_service.client.list_collections()]
        if collection_name not in collections:
            return {"detail": "Memory store is already empty."}
            
        success = vector_service.delete_collection(collection_name=collection_name)
        if not success:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to clear memory database.")
            
        return {"detail": "Companion long-term memory wiped completely. Intimacy reset."}
        
    except Exception as e:
        logger.error(f"Failed to clear memories for user {current_user.id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error clearing memory."
        )
