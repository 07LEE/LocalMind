import json
import urllib.request
import urllib.error
from .config import OLLAMA_HOST, OLLAMA_MODEL

class OllamaClient:
    def __init__(self, host=None, model=None):
        self.host = host or OLLAMA_HOST
        self.model = model or OLLAMA_MODEL

    def generate_stream(self, prompt):
        """Sends a prompt to the local Ollama instance and yields response tokens.

        Args:
            prompt (str): The prompt message.

        Yields:
            str: Text response chunks.
        """
        url = f"{self.host.rstrip('/')}/api/generate"
        data = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": True
        }).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        try:
            with urllib.request.urlopen(req) as response:
                for line in response:
                    if line.strip():
                        chunk = json.loads(line.decode("utf-8"))
                        yield chunk.get("response", "")
        except urllib.error.URLError as e:
            print(f"\nLOGE: [LLM] Error: Failed to connect to Ollama server at {self.host} ({e.reason})")
            yield f"\n[Error: Failed to connect to Ollama server at {self.host}]"
        except Exception as e:
            print(f"\nLOGE: [LLM] Unexpected error: {e}")
            yield f"\n[Error: {e}]"

    def build_rag_prompt(self, query, results):
        """Formats the context from search results and constructs the final system prompt.

        Args:
            query (str): The user's query.
            results (list[dict]): The search results.

        Returns:
            str: The constructed prompt.
        """
        contexts = []
        for i, res in enumerate(results, 1):
            meta = res.get("metadata", {})
            title = meta.get("title", meta.get("filename", "Unknown"))
            categories = meta.get("categories", [])
            cat_str = " > ".join(categories) if categories else "General"
            
            context_item = f"Document #{i} [{cat_str} - {title}]\n{res['text'].strip()}"
            contexts.append(context_item)

        context_text = "\n\n".join(contexts)

        prompt = (
            "You are a helpful knowledge assistant. Answer the user's question based strictly on the provided Context.\n"
            "Note that the user query may contain Korean phonetic transliterations of English terms (e.g., '아이작심' representing 'Isaac Sim'). Map them intelligently to the context.\n"
            "If the answer cannot be found in the Context, state clearly that you do not know. Do not hallucinate or make things up.\n"
            "You MUST write the response in Korean. Under no circumstances should you answer in English.\n\n"
            f"=== Context ===\n{context_text}\n\n"
            f"=== Question ===\n{query}\n\n"
            "=== Answer ===\n"
        )
        return prompt
