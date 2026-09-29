import os
import sys
import json
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def get_key() -> bytes:
    """從環境變數 ENCRYPT_KEY 取得 AES 金鑰 (與後端完全相同的邏輯)"""
    key_b64 = os.environ.get("ENCRYPT_KEY")
    if not key_b64:
        print("❌ 錯誤：沒有設定 ENCRYPT_KEY 環境變數", file=sys.stderr)
        sys.exit(1)
    try:
        return base64.urlsafe_b64decode(key_b64)
    except Exception as e:
        print(f"❌ 錯誤：無法解析 ENCRYPT_KEY：{e}", file=sys.stderr)
        sys.exit(1)


def decrypt_blob(token_b64: str, key: bytes) -> str:
    """
    解密一個後端產生的密文字串：
    - token_b64 = urlsafe-base64(nonce + ciphertext+tag)
    - 回傳解密後的 UTF-8 字串
    """
    blob = base64.urlsafe_b64decode(token_b64)
    nonce, ct = blob[:12], blob[12:]
    aesgcm = AESGCM(key)
    pt = aesgcm.decrypt(nonce, ct, associated_data=None)
    return pt.decode("utf-8")


def main():
    if len(sys.argv) < 2:
        print(f"用法：python {os.path.basename(sys.argv[0])} encrypted_batch.json [輸出檔名]", file=sys.stderr)
        sys.exit(1)

    in_path = sys.argv[1]
    if not os.path.exists(in_path):
        print(f"❌ 找不到檔案：{in_path}", file=sys.stderr)
        sys.exit(1)

    # 若沒給第二個參數，就用「原檔名 + _decrypted」當輸出檔名
    if len(sys.argv) >= 3:
        out_path = sys.argv[2]
    else:
        base, ext = os.path.splitext(in_path)
        out_path = f"{base}_decrypted{ext or '.json'}"

    key = get_key()

    # 讀入加密 JSON array
    with open(in_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, list):
        print("❌ 輸入檔內容不是 JSON array，請確認是批次匯出的檔案。", file=sys.stderr)
        sys.exit(1)

    decrypted_records = []

    for idx, rec in enumerate(data, start=1):
        if not isinstance(rec, dict):
            print(f"⚠️ 第 {idx} 筆不是物件，已略過。", file=sys.stderr)
            continue

        enc_id = rec.get("encrypted_medical_id") or ""
        enc_payload = rec.get("encrypted_payload") or ""

        # 解密病歷號（可能為空）
        try:
            decrypted_id = decrypt_blob(enc_id, key) if enc_id else ""
        except Exception as e:
            print(f"⚠️ 第 {idx} 筆 encrypted_medical_id 解密失敗：{e}", file=sys.stderr)
            decrypted_id = None

        # 解密整份 payload（裡面原本是 JSON 字串）
        try:
            payload_str = decrypt_blob(enc_payload, key) if enc_payload else ""
            payload_obj = json.loads(payload_str) if payload_str else None
        except Exception as e:
            print(f"⚠️ 第 {idx} 筆 encrypted_payload 解密失敗：{e}", file=sys.stderr)
            payload_obj = None

        decrypted_records.append({
            "medical_id": decrypted_id,   # 還原後的病歷號
            "payload": payload_obj        # 還原後的完整 JSON 內容
        })

    # 輸出成新的 JSON array
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(decrypted_records, f, ensure_ascii=False, indent=2)

    print(f"✅ 解密完成，共處理 {len(decrypted_records)} 筆資料")
    print(f"📄 已輸出到：{out_path}")


if __name__ == "__main__":
    main()
