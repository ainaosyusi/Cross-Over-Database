#!/usr/bin/env python3
"""プレイリストから全動画のメタデータを一括取得"""

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from keion_stats.config import RAW_DIR, get_playlist_url
from keion_stats.fetcher import (
    extract_playlists_from_file,
    fetch_all_playlists,
    fetch_playlist,
)


def main():
    parser = argparse.ArgumentParser(description="YouTubeプレイリストからメタデータ取得")
    parser.add_argument("--url", help="プレイリストURL（単一）")
    parser.add_argument("--from-file", help="プレイリストURLリストファイル（playlist_URL.md等）")
    parser.add_argument("--force", action="store_true", help="キャッシュを無視して再取得")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    if args.force:
        import glob as globmod
        for f in globmod.glob(str(RAW_DIR / "pl_*.json")):
            Path(f).unlink()
            logging.info("キャッシュ削除: %s", f)
        cache = RAW_DIR / "playlist_cache.json"
        if cache.exists():
            cache.unlink()
            logging.info("キャッシュ削除: %s", cache)

    if args.from_file:
        # ファイルから複数プレイリストを取得
        filepath = Path(args.from_file)
        if not filepath.exists():
            print(f"エラー: {filepath} が見つかりません")
            sys.exit(1)

        playlists = extract_playlists_from_file(filepath)
        print(f"検出されたプレイリスト: {len(playlists)} 件")
        for i, pl in enumerate(playlists, 1):
            print(f"  {i:2d}. {pl.get('title') or '(タイトルなし)'}")

        videos = fetch_all_playlists(playlists)
    elif args.url:
        videos = fetch_playlist(args.url)
    else:
        try:
            url = get_playlist_url()
            videos = fetch_playlist(url)
        except ValueError:
            print("エラー: --url か --from-file を指定するか、.envにPLAYLIST_URLを設定してください")
            sys.exit(1)

    print(f"\n取得完了: {len(videos)} 動画")

    # サマリー表示
    for v in videos[:5]:
        title = v.get("title", "")[:40]
        desc_len = len(v.get("description", ""))
        pl_title = v.get("playlist_title", "")
        print(f"  - [{pl_title}] {title}... (概要欄: {desc_len}文字)")
    if len(videos) > 5:
        print(f"  ... 他 {len(videos) - 5} 動画")


if __name__ == "__main__":
    # .envファイルの読み込み
    env_file = Path(__file__).parent.parent / ".env"
    if env_file.exists():
        import os
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())

    main()
