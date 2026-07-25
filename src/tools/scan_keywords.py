import os
import argparse
import re
import logging
from collections import Counter
from kiwipiepy import Kiwi

from concurrent.futures import ThreadPoolExecutor

# Try to import custom dictionary manager, but don't fail if missing
try:
    from personal_dict import DictionaryManager
    HAS_DICT_MANAGER = True
except ImportError:
    HAS_DICT_MANAGER = False

def _process_single_file(file_path, kiwi):
    """Processes a single markdown file and finds morphology analysis failures."""
    local_failures = Counter()
    local_details = {}
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        clean_text = re.sub(r'[#*`\[\]\(\)>-]', ' ', content)
        chunks = clean_text.split()

        for chunk in chunks:
            word = chunk.strip('.,?!:;\'"()')
            if len(word) < 2: continue

            results = kiwi.analyze(word, top_n=1)
            if not results: continue

            tokens, score = results[0]

            # FAILURE DEFINITION: Split into multiple nouns/fragments
            if len(tokens) > 1:
                is_failed_compound = all(t.tag.startswith('N') or t.tag in ('SL', 'SN') for t in tokens)

                if is_failed_compound:
                    local_failures[word] += 1
                    if word not in local_details:
                        detail = " + ".join([f"{t.form}/{t.tag}" for t in tokens])
                        local_details[word] = detail
    except Exception as e:
        print(f"Error reading {file_path}: {e}")

    return local_failures, local_details

def scan_posts(posts_dir, min_count=5):
    """
    Surgical Failure Detector: Finds words that Kiwi splits into multiple NOUNS.
    Clean Version: No emojis in logs. Multi-threaded processing enabled.
    """
    kiwi = None

    # 1. Initialize Kiwi (with or without custom dict)
    if HAS_DICT_MANAGER:
        try:
            dict_manager = DictionaryManager()
            dict_manager.load_dict()
            kiwi = dict_manager.get_kiwi()
            print("[DictionaryManager] Custom dictionary loaded successfully.")
        except Exception as e:
            print(f"Failed to load custom dictionary: {e}")

    if not kiwi:
        print("Using base Kiwi model (Custom dictionary system not found or failed).")
        kiwi = Kiwi()

    analysis_failures = Counter()
    failure_details = {}

    print(f"Detecting analysis failures (split tokens) in: {posts_dir}")

    target_files = []
    for root, _, files in os.walk(posts_dir):
        for file in files:
            if file.endswith('.md') and not file.lower().startswith('readme'):
                target_files.append(os.path.join(root, file))

    max_workers = min(32, (os.cpu_count() or 4) + 4)
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(_process_single_file, file_path, kiwi) for file_path in target_files]
        for future in futures:
            local_failures, local_details = future.result()
            analysis_failures.update(local_failures)
            for word, detail in local_details.items():
                if word not in failure_details:
                    failure_details[word] = detail

    print(f"Scanned {len(target_files)} files using {max_workers} threads.")
    
    suggestions = [(word, count) for word, count in analysis_failures.most_common() if count >= min_count]

    output_path = os.path.join(os.path.dirname(posts_dir), "data", "suggested_keywords.txt")
    try:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(f"# [ANALYSIS FAILURES] Words split into multiple nouns/fragments. (Min Count: {min_count})\n")
            f.write(f"# FORMAT: Word {' ' * 30} | Count | [Kiwi Analysis Result]\n")
            f.write("-" * 100 + "\n")
            for word, count in suggestions:
                detail = failure_details.get(word, "N/A")
                f.write(f"{word:<35} | {count:<5} | {detail}\n")
        print(f"Saved detailed failures to: {output_path}")
    except Exception as e:
        print(f"Error saving suggestions: {e}")

    return suggestions

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Find true morphological analysis failures without icons.")
    parser.add_argument("--dir", default=os.getenv("LOCAL_MIND_POSTS", os.getenv("THOUGHT_SEARCH_POSTS", "posts")), help="Directory to scan")
    parser.add_argument("--min", type=int, default=5, help="Minimum occurrence count")
    
    args = parser.parse_args()
    if os.path.isdir(args.dir):
        scan_posts(args.dir, args.min)
    else:
        print(f"Error: Directory '{args.dir}' not found.")
