import os
import sys
import argparse
import base64
from pathlib import Path
from typing import Tuple
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

# ==============================
# AES-GCM 解密工具（支援檔案或字串）
# 使用方式：
#   1) 設定金鑰（base64 url-safe 編碼的 16/24/32 bytes）：
#        Linux/Mac:  export ENCRYPT_KEY='你的金鑰字串'
#        Windows PS: $Env:ENCRYPT_KEY = "你的金鑰字串"
#   2) 解密「密文字串」：
#        python decrypt_tool.py "lW10lw-...（很長的字串）"
#   3) 解密「密文檔案」：
#        python decrypt_tool.py outputs/分析報告_xxx.json
#      （檔案內容為一行 base64url 密文）
#   4) 指定輸出檔名：
#        python decrypt_tool.py outputs/分析報告_xxx.json --out result.json
# ==============================

def get_key() -> bytes:
    key_b64 = os.environ.get("ENCRYPT_KEY")
    if not key_b64:
        print("❌ 錯誤：未設定環境變數 ENCRYPT_KEY。")
        print("請設定後再試：")
        print("  PowerShell → $Env:ENCRYPT_KEY = '你的金鑰字串'")
        print("  Linux/Mac → export ENCRYPT_KEY='你的金鑰字串'")
        sys.exit(1)

    try:
        key = base64.urlsafe_b64decode(key_b64)
    except Exception as e:
        print(f"❌ 金鑰格式錯誤（需為 base64 url-safe）：{e}")
        sys.exit(1)

    if len(key) not in (16, 24, 32):
        print(f"❌ 金鑰長度錯誤 ({len(key)} bytes)，需為 16/24/32 bytes。")
        sys.exit(1)
    return key


def read_token_from_file(path: Path) -> str:
    try:
        text = path.read_text(encoding="utf-8").strip()
        # 有些編輯器可能在最前/最後加了引號或 BOM；這裡做清理
        if text.startswith(("\"", "'")) and text.endswith(("\"", "'")) and len(text) >= 2:
            text = text[1:-1].strip()
        return text
    except Exception as e:
        print(f"❌ 讀取檔案失敗：{e}")
        sys.exit(1)


def decrypt_base64url_token(token_b64: str, key: bytes) -> str:
    try:
        blob = base64.urlsafe_b64decode(token_b64)
        nonce, ct = blob[:12], blob[12:]
        aesgcm = AESGCM(key)
        pt = aesgcm.decrypt(nonce, ct, associated_data=None)
        return pt.decode("utf-8")
    except Exception as e:
        print(f"❌ 解密失敗：{e}")
        sys.exit(1)


def detect_input(arg: str) -> Tuple[bool, Path | None, str]:
    """
    回傳 (is_file, path, token_candidate)
    - 若參數是存在的檔案路徑 -> (True, Path, "")
    - 否則視為密文字串 -> (False, None, arg)
    """
    p = Path(arg)
    if p.exists() and p.is_file():
        return True, p, ""
    return False, None, arg.strip()


def write_output(content: str, out_path: Path | None, src_path: Path | None) -> Path:
    if out_path is not None:
        out_file = out_path
    else:
        # 預設輸出：<原檔名去副檔>_decrypted.json；若輸入是字串則用 decrypted.json
        if src_path is not None:
            stem = src_path.stem  # 不含副檔名
            out_file = src_path.with_name(f"{stem}_decrypted.json")
        else:
            out_file = Path("decrypted.json")

    try:
        out_file.write_text(content, encoding="utf-8")
        return out_file
    except Exception as e:
        print(f"❌ 寫入輸出檔失敗：{e}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="AES-GCM 解密工具（支援輸入密文字串或密文檔案）"
    )
    parser.add_argument(
        "input",
        nargs="?",
        help="密文字串或密文檔案路徑（若省略則會互動式輸入）"
    )
    parser.add_argument(
        "--out", "-o",
        dest="out",
        help="指定解密後輸出檔名（預設：<原檔名>_decrypted.json 或 decrypted.json）"
    )
    args = parser.parse_args()

    key = get_key()

    # 取得來源
    if args.input:
        is_file, path, token = detect_input(args.input)
    else:
        # 互動式輸入：可貼密文字串或檔案路徑
        raw = input("請輸入密文字串或檔案路徑：").strip()
        is_file, path, token = detect_input(raw)

    # 讀取密文
    if is_file:
        token = read_token_from_file(path)
    else:
        path = None  # 字串輸入時沒有來源檔

    # 若不小心把明文 JSON 傳進來，友善提示
    if token.startswith("{") and token.endswith("}"):
        print("⚠️ 看起來你提供的是明文 JSON，而不是密文字串。解密步驟將不處理，直接輸出原文。")
        plaintext = token
    else:
        plaintext = decrypt_base64url_token(token, key)

    # 嘗試判斷是否是 JSON；不是也照寫
    out_path = Path(args.out) if args.out else None
    out_file = write_output(plaintext, out_path, path)

    print(f"✅ 解密完成，已輸出：{out_file.resolve()}")


if __name__ == "__main__":
    main()
