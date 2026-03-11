"""設定管理"""

import os
from pathlib import Path

# プロジェクトルート
PROJECT_ROOT = Path(__file__).parent.parent.parent

# データディレクトリ
DATA_DIR = PROJECT_ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PARSED_DIR = DATA_DIR / "parsed"
OUTPUT_DIR = PROJECT_ROOT / "output"
WEB_DATA_DIR = PROJECT_ROOT / "web" / "data"

# 名前エイリアスファイル
NAME_ALIASES_FILE = DATA_DIR / "name_aliases.json"
ARTIST_ALIASES_FILE = DATA_DIR / "artist_aliases.json"


def get_playlist_url() -> str:
    """環境変数またはコマンドライン引数からプレイリストURLを取得"""
    url = os.environ.get("PLAYLIST_URL", "")
    if not url:
        raise ValueError(
            "PLAYLIST_URL が設定されていません。"
            ".env ファイルまたは環境変数で設定してください。"
        )
    return url


def get_cookie_option() -> dict:
    """yt-dlp用のcookie設定を返す"""
    cookie_file = os.environ.get("COOKIE_FILE")
    if cookie_file:
        return {"cookiefile": cookie_file}

    cookie_browser = os.environ.get("COOKIE_BROWSER")
    if cookie_browser:
        return {"cookiesfrombrowser": (cookie_browser,)}

    return {}
