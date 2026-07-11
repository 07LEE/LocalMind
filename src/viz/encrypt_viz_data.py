import os
import base64

def main():
    # Get the project base directory (Thought-Search root)
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    source_path = os.path.join(base_dir, 'data', 'viz-data.json')
    target_path = os.path.join(base_dir, 'data', 'viz-data.enc.json')
    key = 'thought-search-monochrome-key-2026'

    if not os.path.exists(source_path):
        print(f"Error: Source file {source_path} not found.")
        return

    print(f"Reading source data from {source_path}...")
    with open(source_path, 'r', encoding='utf-8') as f:
        plain_text = f.read()

    print("Encrypting data using XOR + Base64...")
    plain_bytes = plain_text.encode('utf-8')
    key_bytes = key.encode('utf-8')
    
    encrypted_bytes = bytearray(len(plain_bytes))
    for i in range(len(plain_bytes)):
        encrypted_bytes[i] = plain_bytes[i] ^ key_bytes[i % len(key_bytes)]
        
    encoded_str = base64.b64encode(encrypted_bytes).decode('utf-8')

    print(f"Writing encrypted data to {target_path}...")
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    with open(target_path, 'w', encoding='utf-8') as f:
        f.write(encoded_str)

    print("Encryption completed successfully.")

if __name__ == '__main__':
    main()
