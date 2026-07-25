import os
from pathlib import Path

# Project Root
BASE_DIR = Path(__file__).resolve().parent.parent.parent
MODELS_DIR = BASE_DIR / "models"

# Set HuggingFace Cache to local models directory
os.environ["HF_HOME"] = str(MODELS_DIR)
os.environ["TRANSFORMERS_CACHE"] = str(MODELS_DIR)
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

def get_env_fallback(new_key, old_key, default):
    return os.getenv(new_key, os.getenv(old_key, default))

# Default AI Model (can be overridden by environment variable)
EMBEDDING_MODEL = get_env_fallback("LOCAL_MIND_MODEL", "THOUGHT_SEARCH_MODEL", "jhgan/ko-sroberta-multitask")

# Reranking Model
RERANK_MODEL = get_env_fallback("LOCAL_MIND_RERANK_MODEL", "THOUGHT_SEARCH_RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")

# Check if local cache exists to determine offline mode dynamically
def check_local_cache(model_name):
    # HF Hub cache structure: hub/models--author--model-name
    friendly_name = f"models--{model_name.replace('/', '--')}"
    cache_path = MODELS_DIR / "hub" / friendly_name
    return cache_path.exists()

if check_local_cache(EMBEDDING_MODEL) and check_local_cache(RERANK_MODEL):
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
else:
    # Disable offline mode to allow automatic download
    os.environ.pop("TRANSFORMERS_OFFLINE", None)
    os.environ.pop("HF_DATASETS_OFFLINE", None)


# Database Pathing
# Migrate old thought-search-db files if they exist and new files do not
OLD_DB_PATH = BASE_DIR / "data" / "thought-search-db.json"
NEW_DB_PATH = BASE_DIR / "data" / "localmind-db.json"
if OLD_DB_PATH.exists() and not NEW_DB_PATH.exists():
    try:
        import shutil
        OLD_VEC_PATH = BASE_DIR / "data" / "thought-search-db.vectors.npy"
        NEW_VEC_PATH = BASE_DIR / "data" / "localmind-db.vectors.npy"
        
        NEW_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(OLD_DB_PATH), str(NEW_DB_PATH))
        if OLD_VEC_PATH.exists():
            shutil.move(str(OLD_VEC_PATH), str(NEW_VEC_PATH))
    except Exception:
        pass

DB_DEFAULT_PATH = str(NEW_DB_PATH)

# Posts Directory (can be overridden by environment variable)
POSTS_DIR = get_env_fallback(
    "LOCAL_MIND_POSTS",
    "THOUGHT_SEARCH_POSTS",
    str(BASE_DIR / "posts")
)

# Indexing Configuration
# Directories to skip entirely during indexing
EXCLUDED_DIRS = [".git", ".venv", "__pycache__"]

# Specific filenames to skip
EXCLUDED_FILENAMES = ["README.md", "TEMPLATE.md"]

# File extensions to index
SUPPORTED_EXTENSIONS = [".md"]

# Chunking Configuration
MAX_CHUNK_SIZE = int(get_env_fallback("LOCAL_MIND_MAX_CHUNK", "THOUGHT_SEARCH_MAX_CHUNK", "800"))
CHUNKING_OVERLAP = int(get_env_fallback("LOCAL_MIND_OVERLAP", "THOUGHT_SEARCH_OVERLAP", "200"))

# Ollama LLM Configuration for RAG
OLLAMA_HOST = get_env_fallback("LOCAL_MIND_OLLAMA_HOST", "THOUGHT_SEARCH_OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = get_env_fallback("LOCAL_MIND_OLLAMA_MODEL", "THOUGHT_SEARCH_OLLAMA_MODEL", "qwen2.5-coder:14b")

# RAG relevance threshold for filtering low-quality search results
RAG_RELEVANCE_THRESHOLD = float(get_env_fallback("LOCAL_MIND_RELEVANCE_THRESHOLD", "THOUGHT_SEARCH_RELEVANCE_THRESHOLD", "0.5"))

# Sync Authorization Token (optional)
SYNC_TOKEN = get_env_fallback("LOCAL_MIND_SYNC_TOKEN", "THOUGHT_SEARCH_SYNC_TOKEN", "")

