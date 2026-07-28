import os
import sys
import threading
import subprocess
import json
from flask import Flask, jsonify, send_from_directory, request, Response, stream_with_context
from flask_cors import CORS

# Ensure the root directory is in sys.path for relative imports
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(os.path.join(BASE_DIR, "src"))

from cli.indexer import index_markdown_files
from tools.scan_keywords import scan_posts
from viz.extract_viz_data import extract_visualization_data
from core.config import DB_DEFAULT_PATH, POSTS_DIR, RAG_RELEVANCE_THRESHOLD, SYNC_TOKEN, MASTER_IP
from core.vector_db import SimpleVectorDB, clean_markdown
from core.llm import OllamaClient

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


def _deduplicate(results, top_k):
    """Deduplicates results by rel_path and limits to top_k."""
    unique, seen = [], set()
    for res in results:
        path = res["metadata"].get("rel_path")
        if path not in seen:
            unique.append(res)
            seen.add(path)
            if len(unique) >= top_k:
                break
    return unique

def get_client_ip():
    """Extracts client IP considering proxy headers."""
    if request.headers.get('X-Forwarded-For'):
        return request.headers.get('X-Forwarded-For').split(',')[0].strip()
    return request.remote_addr or "127.0.0.1"

def is_sync_authorized():
    """Checks if the current client request is authorized to perform sync."""
    if SYNC_TOKEN:
        auth_header = request.headers.get("Authorization", "")
        token_header = request.headers.get("X-Sync-Token", "")
        provided_token = auth_header.replace("Bearer ", "").strip() if auth_header.startswith("Bearer ") else token_header
        if provided_token == SYNC_TOKEN:
            return True

    client_ip = get_client_ip()
    # Always allow local loopback requests
    if client_ip in ("127.0.0.1", "::1", "localhost"):
        return True

    if MASTER_IP:
        allowed_ips = [ip.strip() for ip in MASTER_IP.split(",") if ip.strip()]
        if "0.0.0.0" in allowed_ips or "*" in allowed_ips:
            return True
        return client_ip in allowed_ips

    return False

def log_security_event(query, client_ip):
    """Logs prompt injection or suspicious security attempts to data/security_logs.json."""
    from datetime import datetime
    data_dir = os.path.join(BASE_DIR, "data")
    os.makedirs(data_dir, exist_ok=True)
    log_file = os.path.join(data_dir, "security_logs.json")

    records = []
    if os.path.exists(log_file):
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                records = json.load(f)
                if not isinstance(records, list):
                    records = []
        except Exception:
            records = []

    records.append({
        "event": "prompt_injection_attempt",
        "query": query,
        "client_ip": client_ip,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })

    try:
        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"LOGI: [Server] Logged security event for IP {client_ip}")
    except Exception as e:
        print(f"LOGE: [Server] Failed to write security log: {e}")

def log_unknown_query_if_needed(query, response_text, client_ip="127.0.0.1"):
    """지식 부재(답변 불가능) 질문을 data/unknown_queries.json에 기록합니다."""
    keywords = [
        "정보가 없습니다", 
        "답변할 수 없습니다", 
        "알 수 없습니다", 
        "찾을 수 없습니다", 
        "언급되어 있지 않습니다", 
        "언급되지 않았습니다",
        "제시된 문서에는",
        "제공된 문서에는"
    ]
    
    is_unknown = any(kw in response_text for kw in keywords)
    if not is_unknown:
        return
        
    from datetime import datetime
    import json
    
    data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    os.makedirs(data_dir, exist_ok=True)
    log_file = os.path.join(data_dir, "unknown_queries.json")
    
    records = []
    if os.path.exists(log_file):
        try:
            with open(log_file, "r", encoding="utf-8") as f:
                records = json.load(f)
                if not isinstance(records, list):
                    records = []
        except Exception:
            records = []
            
    normalized_query = query.strip().lower()
    existing_record = next((r for r in records if r.get("query", "").strip().lower() == normalized_query), None)

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if existing_record:
        existing_record["count"] = existing_record.get("count", 1) + 1
        existing_record["timestamp"] = now_str
        existing_record["client_ip"] = client_ip
    else:
        records.append({
            "query": query,
            "client_ip": client_ip,
            "count": 1,
            "timestamp": now_str,
            "response_snippet": response_text[:100] + "..." if len(response_text) > 100 else response_text
        })
    
    try:
        with open(log_file, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"LOGI: [Server] Logged unknown query: '{query}'")
    except Exception as e:
        print(f"LOGE: [Server] Failed to write unknown query log: {e}")

def _run_sync_background():
    global sync_status
    success = False
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
        
        success = True
        print("LOGE: [Server] Background sync completed successfully.")
    except Exception as e:
        print(f"LOGE: [Server] Background sync error: {e}")
    finally:
        with sync_lock:
            sync_status = "idle" if success else "error"

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


@app.route('/api/auth/status', methods=['GET'])
def auth_status():
    """Endpoint to check permissions for UI features (e.g. sync button visibility)."""
    return jsonify({
        "can_sync": is_sync_authorized(),
        "client_ip": get_client_ip()
    })

@app.route('/api/sync', methods=['POST'])
def sync_db():
    """API endpoint to trigger asynchronous manual re-indexing and data extraction."""
    global sync_status
    if not is_sync_authorized():
        return jsonify({"status": "error", "message": "Forbidden: Sync access denied for this IP address."}), 403

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
            "message": "Failed to start sync process."
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
        # Increase initial k for hybrid search before reranking
        initial_k = max(top_k * 2, 5)
        results = db.search_hybrid(query, top_k=initial_k)

        if rerank and len(results) > 1:
            results = db.rerank(query, results)

        unique_results = _deduplicate(results, top_k)

        for res in unique_results:
            res["snippet"] = clean_markdown(res["text"])

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

@app.route('/api/answers', methods=['POST'])
def rag_search():
    """API endpoint for RAG (Retrieval-Augmented Generation) search with SSE streaming."""
    body = request.get_json(silent=True) or {}
    query = body.get('query', '')
    top_k = int(body.get('k', 5))
    rerank = body.get('rerank', True)

    if not query:
        return jsonify({"error": "Query is required"}), 400
        
    try:
        # Perform hybrid search for context
        initial_k = max(top_k * 2, 5)
        results = db.search_hybrid(query, top_k=initial_k)
        
        if rerank and len(results) > 1:
            results = db.rerank(query, results)
            
        unique_results = _deduplicate(results, top_k)

        for res in unique_results:
            res["snippet"] = clean_markdown(res["text"])

        # Filter out low-relevance results below rerank score threshold
        unique_results = [
            res for res in unique_results
            if res.get("rerank_score", res.get("score", 0)) >= RAG_RELEVANCE_THRESHOLD or (
                res.get("type") == "keyword" and res.get("score", 0) >= 3.0
            )
        ]

        client = OllamaClient()
        prompt = client.build_rag_prompt(query, unique_results)

        def generate():
            # Send search results metadata first
            meta_payload = {
                "type": "metadata",
                "results": [
                    {
                        "score": res.get("rerank_score", res["score"]),
                        "metadata": res["metadata"],
                        "snippet": res["snippet"]
                    }
                    for res in unique_results
                ]
            }
            yield f"data: {json.dumps(meta_payload)}\n\n"

            client_ip = get_client_ip()

            if prompt is None:
                log_security_event(query, client_ip)
                rejection_msg = "죄송합니다. 제공된 컨텍스트 외의 질문이나 시스템 지시사항을 무시하라는 요청은 수행할 수 없습니다."
                yield f"data: {json.dumps({'type': 'content', 'text': rejection_msg})}\n\n"
                yield "data: [DONE]\n\n"
                return

            # Stream response content from Ollama
            full_response = ""
            for token in client.generate_stream(prompt):
                full_response += token
                content_payload = {
                    "type": "content",
                    "text": token
                }
                yield f"data: {json.dumps(content_payload)}\n\n"

            try:
                log_unknown_query_if_needed(query, full_response, client_ip)
            except Exception as log_err:
                print(f"LOGE: [Server] RAG response log error: {log_err}")
                
            yield "data: [DONE]\n\n"

        return Response(stream_with_context(generate()), content_type='text/event-stream')
    except Exception as e:
        print(f"LOGE: [Server] RAG search error: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/<path:path>')
def serve_visualize(path):
    """Serve static files from the visualize directory."""
    if path.startswith('api/'):
        return jsonify({"error": "Not Found"}), 404
    return send_from_directory(os.path.join(BASE_DIR, 'visualize'), path)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    print(f"LocalMind Server starting at http://localhost:{port}")
    app.run(host='0.0.0.0', port=port)
