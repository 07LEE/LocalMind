import re
import os
import math
import numpy as np
import torch
from collections import Counter
from kiwipiepy import Kiwi
from personal_dict.manager import DictionaryManager

# C++ extension import attempt
try:
    from .bm25_extension import BM25Kernel
    HAS_CPP_EXTENSION = True
except ImportError:
    HAS_CPP_EXTENSION = False

try:
    from .markdown_extension import clean_chunk as cpp_clean_chunk
    HAS_MARKDOWN_CPP = True
except ImportError:
    HAS_MARKDOWN_CPP = False


class SparseIndex:
    """Handles BM25-based sparse search logic for keyword-based retrieval.

    This class implements the BM25 (Best Matching 25) ranking function, 
    which is widely used for estimating the relevance of documents to a 
    given search query.

    Attributes:
        tf (list[Counter]): Term frequencies for each document in the index.
        idf (dict[str, float]): Inverse document frequency scores for each term.
        avgdl (float): Average length of all documents in the index.
        doc_lengths (list[int]): Length (word count) of each document.
        k1 (float): BM25 parameter for term frequency scaling.
        b (float): BM25 parameter for document length normalization.
    """
    
    def __init__(self):
        """Initializes the SparseIndex with default BM25 parameters."""
        self.tf = []          # Term frequencies per document
        self.idf = {}         # Inverse document frequency
        self.avgdl = 0        # Average document length
        self.doc_lengths = []  # Length of each document
        self.k1 = 1.5
        self.b = 0.75
        
        # Determine computing device
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.tf_tensors = {}
        self.idf_tensors = {}
        self.doc_lengths_tensor = None
        
        # Initialize Kiwi with Custom Dictionary Manager
        self.dict_manager = DictionaryManager()
        # Automatically load dictionaries from the package or environment override
        self.dict_manager.load_dict()
        
        self.kiwi = self.dict_manager.get_kiwi()
        self.cpp_engine = BM25Kernel(self.k1, self.b) if HAS_CPP_EXTENSION else None

    def _tokenize(self, text):
        """Morphological tokenizer for BM25 using Kiwi.

        Args:
            text (str): The raw text to tokenize.

        Returns:
            list[str]: A list of meaningful tokens (nouns, verbs, etc.).
        """
        if not text:
            return []

        # Remove markdown alert tags like [!NOTE], [!WARNING], etc.
        if HAS_MARKDOWN_CPP:
            text = cpp_clean_chunk(text)
        else:
            text = re.sub(r'\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]', '', text, flags=re.IGNORECASE)

        # Using Kiwi for high-quality Korean tokenization
        tokens = self.kiwi.tokenize(text.lower())
        
        # Extract only meaningful tags:
        # N: Nouns, V: Verbs/Adjectives, SL: Foreign words, SN: Numbers
        result = [t.form for t in tokens if t.tag.startswith('N') or t.tag.startswith('V') or t.tag in ['SL', 'SN']]
        
        # Fallback for short texts or non-Korean snippets that Kiwi might skip
        if not result:
            return re.findall(r'\w+', text.lower())
            
        return result

    def rebuild(self, documents):
        """Rebuilds the BM25 index from the provided document collection.

        Args:
            documents (list[str]): List of raw document texts.
        """
        if not documents:
            self.tf = []
            self.idf = {}
            self.avgdl = 0
            self.doc_lengths = []
            self.tf_tensors = {}
            self.idf_tensors = {}
            self.doc_lengths_tensor = None
            return

        doc_tokens = [self._tokenize(doc) for doc in documents]
        self.doc_lengths = [len(tokens) for tokens in doc_tokens]
        self.avgdl = sum(self.doc_lengths) / len(documents)
        
        if HAS_CPP_EXTENSION and self.cpp_engine is not None:
            self.cpp_engine.rebuild(doc_tokens)
            self.tf = doc_tokens
            return

        # Calculate TF
        self.tf = [Counter(tokens) for tokens in doc_tokens]
        
        # Pre-build TF vector arrays for tensor execution
        num_docs = len(documents)
        tf_arrays = {}
        for i, counter in enumerate(self.tf):
            for term, val in counter.items():
                if term not in tf_arrays:
                    tf_arrays[term] = np.zeros(num_docs, dtype=np.float32)
                tf_arrays[term][i] = val
        
        self.tf_tensors = {term: torch.tensor(arr, device=self.device) for term, arr in tf_arrays.items()}
        self.doc_lengths_tensor = torch.tensor(self.doc_lengths, device=self.device, dtype=torch.float32)

        # Calculate IDF
        all_terms = set()
        for counter in self.tf:
            all_terms.update(counter.keys())
            
        self.idf = {}
        self.idf_tensors = {}
        for term in all_terms:
            # Number of documents containing the term
            doc_freq = sum(1 for counter in self.tf if term in counter)
            # Standard BM25 IDF formula
            self.idf[term] = math.log((num_docs - doc_freq + 0.5) / (doc_freq + 0.5) + 1.0)
            self.idf_tensors[term] = torch.tensor(self.idf[term], device=self.device, dtype=torch.float32)

    def search(self, query, documents, metadata, top_k=3):
        """Calculates BM25 scores for the query and returns ranked results.

        Args:
            query (str): The search query text.
            documents (list[str]): The document pool to search in.
            metadata (list[dict]): Metadata associated with each document.
            top_k (int, optional): Number of results to return. Defaults to 3.

        Returns:
            list[dict]: Ranked results with scores and document info.
        """
        if not self.tf or not documents:
            return []

        query_tokens = self._tokenize(query)
        
        if HAS_CPP_EXTENSION and self.cpp_engine is not None:
            cpp_results = self.cpp_engine.search(query_tokens, top_k)
            results = []
            for score, idx in cpp_results:
                results.append({
                    "score": score,
                    "text": documents[idx],
                    "metadata": metadata[idx],
                    "index": idx,
                    "type": "keyword"
                })
            return results

        scores = torch.zeros(len(self.tf), device=self.device, dtype=torch.float32)
        
        for term in query_tokens:
            if term not in self.idf_tensors:
                continue
            
            idf_val = self.idf_tensors[term]
            tf_val = self.tf_tensors[term]
            
            # BM25 scoring formula
            numerator = tf_val * (self.k1 + 1)
            denominator = tf_val + self.k1 * (1 - self.b + self.b * self.doc_lengths_tensor / self.avgdl)
            scores += idf_val * (numerator / denominator)

        scores_np = scores.cpu().numpy()

        # Handle cases where all scores might be 0
        if np.all(scores_np == 0):
            return []

        # Rank and filter
        top_k_indices = scores_np.argsort()[::-1][:top_k]
        
        results = []
        for idx in top_k_indices:
            if scores_np[idx] <= 0: continue
            results.append({
                "score": float(scores_np[idx]),
                "text": documents[idx],
                "metadata": metadata[idx],
                "index": int(idx),
                "type": "keyword"
            })
        return results
