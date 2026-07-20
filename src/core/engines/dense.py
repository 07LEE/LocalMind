import numpy as np
import faiss
import torch
import threading
from sentence_transformers import SentenceTransformer

class DenseIndex:
    """Handles Vector-based dense search logic using sentence-transformers and FAISS.

    This class manages the lifecycle of document embeddings and provides
    high-performance similarity search capabilities using FAISS.

    Attributes:
        model (SentenceTransformer): The model used for generating embeddings.
        vectors (np.ndarray): The stored document vectors.
        index (faiss.Index): The FAISS index for fast similarity search.
    """
    
    def __init__(self, model_name):
        """Initializes the DenseIndex with a specific sentence-transformer model.

        Args:
            model_name (str): Name or path of the sentence-transformer model.
        """
        self.model_name = model_name
        self.model = None
        self.vectors = None
        self.index = None
        self.lock = threading.Lock()

    def _load_model(self):
        """Initializes the sentence-transformer model lazily."""
        if self.model is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            self.model = SentenceTransformer(self.model_name, device=device)

    def embed(self, texts, batch_size=32):
        """Calculates normalized embeddings for a list of texts.

        Args:
            texts (list[str]): List of texts to embed.
            batch_size (int, optional): Number of texts to process in parallel. Defaults to 32.

        Returns:
            np.ndarray: Normalized embedding vectors of shape (n_texts, dimension).
        """
        self._load_model()
        with torch.inference_mode():
            embeddings = self.model.encode(texts, batch_size=batch_size, show_progress_bar=False)
        # L2 Normalization for cosine similarity
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        return embeddings / (norms + 1e-10)

    def _build_index(self):
        """Builds or rebuilds the FAISS index from the current internal vectors.

        Uses IndexIDMap2 over IndexFlatIP to support ID-based removal and differential updates.
        """
        with self.lock:
            if self.vectors is None or len(self.vectors) == 0:
                self.index = None
                return

            dimension = self.vectors.shape[1]
            base_index = faiss.IndexFlatIP(dimension)
            id_index = faiss.IndexIDMap2(base_index)

            ids = np.arange(len(self.vectors), dtype=np.int64)
            id_index.add_with_ids(self.vectors.astype('float32'), ids)
            self.index = id_index

    def remove_ids(self, ids_to_remove):
        """Removes specific vector IDs from the FAISS index without a full rebuild.

        Args:
            ids_to_remove (list[int]): List of vector indices to remove.
        """
        with self.lock:
            if self.index is None or not ids_to_remove:
                return
            ids_arr = np.array(ids_to_remove, dtype=np.int64)
            self.index.remove_ids(ids_arr)

    def add_vectors(self, new_vectors):
        """Adds pre-calculated vectors to the index and updates the search index.

        Args:
            new_vectors (np.ndarray): New embedding vectors to be added.
        """
        if self.vectors is None:
            self.vectors = new_vectors
        else:
            self.vectors = np.vstack((self.vectors, new_vectors))
        
        self._build_index()

    def search(self, query, documents, metadata, top_k=3):
        """Searches the index for the most similar documents to the query.

        Args:
            query (str): The search query text.
            documents (list[str]): The document text pool.
            metadata (list[dict]): Metadata associated with each document.
            top_k (int, optional): Number of top results to return. Defaults to 3.

        Returns:
            list[dict]: A list of result dictionaries containing score, text, and metadata.
        """
        with self.lock:
            if self.index is None or len(documents) == 0:
                return []

            self._load_model()
            # 1. Encode and normalize query
            with torch.inference_mode():
                query_vector = self.model.encode(query).reshape(1, -1).astype('float32')
            faiss.normalize_L2(query_vector)

            # 2. Search FAISS index
            # search() returns (distances, indices)
            # For IndexFlatIP, distances are inner products (scores)
            scores, indices = self.index.search(query_vector, top_k)

            results = []
            for i, idx in enumerate(indices[0]):
                if idx == -1: continue # No more results found
                
                results.append({
                    "score": float(scores[0][i]),
                    "text": documents[idx],
                    "metadata": metadata[idx],
                    "index": int(idx),
                    "type": "vector"
                })
            return results

    def set_vectors(self, vectors):
        """Sets the internal vector pool and rebuilds the search index.

        Used typically when loading a saved database from disk.

        Args:
            vectors (np.ndarray): The complete set of vectors to load.
        """
        self.vectors = vectors
        self._build_index()

    def get_vectors(self):
        """Retrieves the internal vector pool for persistence.

        Returns:
            np.ndarray: The stored document vectors, or None if empty.
        """
        return self.vectors
