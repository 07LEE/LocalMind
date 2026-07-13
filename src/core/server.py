import os
import sys
import threading
import subprocess
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS

# Ensure the root directory is in sys.path for relative imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(BASE_DIR, "src"))

from cli.indexer import index_markdown_files
from tools.scan_keywords import scan_posts
from viz.extract_viz_data import extract_visualization_data
from core.config import DB_DEFAULT_PATH, POSTS_DIR
from core.vector_db import SimpleVectorDB

app = Flask(__name__)
CORS(app)

# Initialize and load Vector DB
db = SimpleVectorDB()
if os.path.exists(DB_DEFAULT_PATH):
    db.load(DB_DEFAULT_PATH)

# Global states for asynchronous background sync
sync_lock = threading.Lock()
sync_status = "idle"  # States: "idle", "processing", "error: <msg>"

# Models will be lazy-loaded on the first search request

def _run_sync_background():
    global sync_status
    try:
        print("\nLOGE: [Server] Background sync started.")
        # 1. Run Indexer
        print("LOGE: [Server] Running indexer in background...")
        index_markdown_files(POSTS_DIR, DB_DEFAULT_PATH)
        
        # 2. Run Visualization Data Extractor
        print("LOGE: [Server] Running viz data extractor in background...")
        extract_visualization_data()
        
        # 3. Run Keyword Scanner
        print("LOGE: [Server] Running keyword scanner in background...")
        cmd = [
            sys.executable,
            os.path.join(BASE_DIR, "src", "tools", "scan_keywords.py"),
            "--dir", POSTS_DIR,
            "--min", "5"
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"LOGE: [Server] Keyword scanner failed: {result.stderr}")
        else:
            print("LOGE: [Server] Keyword scanner completed successfully.")
        
        # 4. Reload Database to sync memory with disk
        print("LOGE: [Server] Reloading database in background...")
        db.load(DB_DEFAULT_PATH)
        
        with sync_lock:
            sync_status = "idle"
        print("LOGE: [Server] Background sync completed successfully.")
    except Exception as e:
        print(f"LOGE: [Server] Background sync error: {e}")
        with sync_lock:
            sync_status = f"error: {str(e)}"

@app.after_request
def add_header(response):
    """Add cache control headers to disable client-side caching."""
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response

@app.route('/')
def root():
    """Serve the visualization index."""
    return send_from_directory(os.path.join(BASE_DIR, 'visualize'), 'index.html')

@app.route('/data/<path:path>')
def serve_data(path):
    """Serve files from the data directory."""
    return send_from_directory(os.path.join(BASE_DIR, 'data'), path)

@app.route('/posts/<path:path>')
def serve_posts(path):
    """Serve files from the posts directory."""
    return send_from_directory(POSTS_DIR, path)

@app.route('/<path:path>')
def serve_visualize(path):
    """Serve static files from the visualize directory."""
    return send_from_directory(os.path.join(BASE_DIR, 'visualize'), path)

@app.route('/api/sync', methods=['POST'])
def sync_db():
    """API endpoint to trigger asynchronous manual re-indexing and data extraction."""
    global sync_status
    try:
        with sync_lock:
            if sync_status == "processing":
                return jsonify({
                    "status": "error",
                    "message": "Sync is already in progress."
                }), 409
            sync_status = "processing"

        # Spawn background thread
        thread = threading.Thread(target=_run_sync_background)
        thread.daemon = True
        thread.start()

        return jsonify({
            "status": "processing",
            "message": "Database sync started in the background."
        })
    except Exception as e:
        print(f"LOGE: [Server] Sync initiation error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/sync/status', methods=['GET'])
def sync_db_status():
    """API endpoint to query current background sync status."""
    global sync_status
    return jsonify({
        "status": sync_status
    })

@app.route('/api/search', methods=['GET'])
def search():
    """API endpoint for vector search."""
    query = request.args.get('q', '')
    top_k = int(request.args.get('k', 5))
    rerank = request.args.get('rerank', 'true').lower() == 'true'
    
    if not query:
        return jsonify({"results": []})
        
    try:
        # Lazy load models if they are not loaded yet
        if not hasattr(db, 'models_loaded') or not db.models_loaded:
            print("LOGE: [Server] Lazy-loading models on first search request...")
            db.pre_load_models()
            db.models_loaded = True

        # Increase initial k for hybrid search before reranking
        initial_k = max(top_k * 5, 10)
        results = db.search_hybrid(query, top_k=initial_k)
        
        if rerank and len(results) > 1:
            results = db.rerank(query, results)
            
        # Deduplicate and limit to top_k
        unique_results = []
        seen_paths = set()
        for res in results:
            path = res["metadata"].get("rel_path")
            if path not in seen_paths:
                unique_results.append(res)
                seen_paths.add(path)
                if len(unique_results) >= top_k:
                    break
        
        return jsonify({
            "status": "success",
            "results": unique_results
        })
    except Exception as e:
        print(f"LOGE: [Server] Search error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f"Thought-Search Server starting at http://localhost:{port}")
    app.run(host='0.0.0.0', port=port)
