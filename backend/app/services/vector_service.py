import logging
from typing import List, Dict, Any, Optional
import chromadb
from app.config import settings
from app.services.embedding_service import embedding_service

logger = logging.getLogger(__name__)

class VectorService:
    """
    Service responsible for interacting with ChromaDB.
    Handles persistent database storage, custom embedding submissions, similarity searches, and collection cleanups.
    """
    def __init__(self):
        self.db_path = settings.CHROMA_DB_PATH
        logger.info(f"Initializing ChromaDB connection at persistent path: {self.db_path}")
        
        try:
            # Initialize persistent disk client
            self.client = chromadb.PersistentClient(path=self.db_path)
            logger.info("✓ ChromaDB connection established successfully.")
        except Exception as e:
            logger.critical(f"Failed to initialize ChromaDB Persistent Client: {str(e)}")
            raise e

    def _get_or_create_collection(self, collection_name: str):
        """
        Retrieves or creates a ChromaDB collection by name.
        """
        try:
            # We don't supply a default embedding function here, since we generate
            # embeddings uniformly using our EmbeddingService and supply them directly.
            return self.client.get_or_create_collection(name=collection_name)
        except Exception as e:
            logger.error(f"Error fetching/creating ChromaDB collection '{collection_name}': {str(e)}")
            raise e

    async def add_texts(
        self,
        collection_name: str,
        texts: List[str],
        ids: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """
        Computes vector embeddings for textual passages and records them inside a ChromaDB collection.
        
        :param collection_name: Destination collection identifier (e.g. 'user_memories_uuid')
        :param texts: List of string payloads
        :param ids: Unique string keys matching each text
        :param metadatas: Optional dictionaries providing filtering tags (e.g. user_id, source)
        """
        if not texts or not ids:
            logger.warning("Empty text list or id list provided to vector database. Skipping transaction.")
            return False
            
        assert len(texts) == len(ids), "Text array and ID array lengths must correspond exactly."
        if metadatas:
            assert len(texts) == len(metadatas), "Text array and metadata array lengths must correspond exactly."
            
        try:
            collection = self._get_or_create_collection(collection_name)
            
            # Generate embeddings asynchronously using our centralized service
            embeddings = await embedding_service.get_embeddings(texts)
            
            # Upsert into ChromaDB
            # ChromaDB supports upsert to avoid duplicate key failures
            collection.upsert(
                ids=ids,
                embeddings=embeddings,
                documents=texts,
                metadatas=metadatas
            )
            logger.info(f"Successfully upserted {len(texts)} chunks into vector collection '{collection_name}'.")
            return True
            
        except Exception as e:
            logger.error(f"Failed to add documents to vector store: {str(e)}")
            return False

    async def query_similarity(
        self,
        collection_name: str,
        query_text: str,
        limit: int = 4,
        where_filter: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Queries ChromaDB for records resembling the semantic payload of the query string.
        
        :param collection_name: Targeted collection
        :param query_text: User search phrase or chat topic
        :param limit: Maximum neighbors to return
        :param where_filter: Optional dictionary dictating metadata matching (e.g., {"source": "pdf"})
        """
        if not query_text or not query_text.strip():
            return []
            
        try:
            # Query might fail if collection doesn't exist
            # Check if collection exists first to prevent warning prints
            collections = [c.name for c in self.client.list_collections()]
            if collection_name not in collections:
                logger.info(f"Vector collection '{collection_name}' does not exist yet. Returning empty search results.")
                return []
                
            collection = self.client.get_collection(name=collection_name)
            
            # Form query vector asynchronously
            query_vector = await embedding_service.get_embedding(query_text)
            
            # Perform vector distance search
            results = collection.query(
                query_embeddings=[query_vector],
                n_results=limit,
                where=where_filter
            )
            
            # Restructure ChromaDB nested query output into a clean list of dictionaries
            # Format: [{"text": "content", "metadata": {...}, "distance": 0.2, "id": "uuid"}]
            formatted_results = []
            
            if results and "documents" in results and results["documents"]:
                documents = results["documents"][0]
                ids = results["ids"][0]
                metadatas = results["metadatas"][0] if "metadatas" in results and results["metadatas"] else [None] * len(documents)
                distances = results["distances"][0] if "distances" in results and results["distances"] else [0.0] * len(documents)
                
                for doc, uid, meta, dist in zip(documents, ids, metadatas, distances):
                    formatted_results.append({
                        "id": uid,
                        "text": doc,
                        "metadata": meta or {},
                        "distance": dist
                    })
                    
            return formatted_results
            
        except Exception as e:
            logger.error(f"Error querying similarity in vector store: {str(e)}")
            return []

    def delete_texts(self, collection_name: str, ids: List[str]) -> bool:
        """
        Deletes vector records by their ID keys.
        """
        try:
            collection = self._get_or_create_collection(collection_name)
            collection.delete(ids=ids)
            logger.info(f"Successfully deleted {len(ids)} items from collection '{collection_name}'.")
            return True
        except Exception as e:
            logger.error(f"Failed to delete items from vector store: {str(e)}")
            return False

    def delete_collection(self, collection_name: str) -> bool:
        """
        Deletes an entire vector collection.
        """
        try:
            self.client.delete_collection(name=collection_name)
            logger.info(f"Successfully deleted entire collection '{collection_name}' from ChromaDB.")
            return True
        except Exception as e:
            logger.warning(f"Could not delete collection '{collection_name}': {str(e)}")
            return False

# Instantiate global service singleton
vector_service = VectorService()
