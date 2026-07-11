import os
from pathlib import Path

# Project Root
BASE_DIR = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = BASE_DIR / "models"

# Set HuggingFace Cache to local models directory
os.environ["HF_HOME"] = str(MODELS_DIR)
os.environ["TRANSFORMERS_CACHE"] = str(MODELS_DIR)

# Default AI Model (can be overridden by environment variable)
EMBEDDING_MODEL = os.getenv("THOUGHT_SEARCH_MODEL", "jhgan/ko-sroberta-multitask")

# Database Pathing
DB_DEFAULT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "thought-search-db.json"
)

# Posts Directory (can be overridden by environment variable)
POSTS_DIR = os.getenv(
    "THOUGHT_SEARCH_POSTS",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "posts")
)

# Reranking Model
RERANK_MODEL = os.getenv("THOUGHT_SEARCH_RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")

# Indexing Configuration
# Directories to skip entirely during indexing
EXCLUDED_DIRS = [".git", ".venv", "__pycache__"]

# Specific filenames to skip
EXCLUDED_FILENAMES = ["README.md", "TEMPLATE.md"]

# File extensions to index
SUPPORTED_EXTENSIONS = [".md"]

# Chunking Configuration
MAX_CHUNK_SIZE = int(os.getenv("THOUGHT_SEARCH_MAX_CHUNK", "800"))
CHUNKING_OVERLAP = int(os.getenv("THOUGHT_SEARCH_OVERLAP", "200"))

# Ollama LLM Configuration for RAG
OLLAMA_HOST = os.getenv("THOUGHT_SEARCH_OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("THOUGHT_SEARCH_OLLAMA_MODEL", "qwen2.5-coder:14b")
