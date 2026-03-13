#!/usr/bin/env python3
"""YouTube Data API v3 を使ったメタデータ取得スクリプト

既存の fetch_all.py（yt-dlp版）の代替。
APIキーのみで動作し、GitHub Actions等のCI環境でも使用可能。

使い方:
  # 単一動画の概要欄を取得（管理者UIのプレビュー用途）
  python scripts/fetch_api.py --video "https://www.youtube.com/watch?v=XXXXX"

  # プレイリストURLリストから全動画を取得
  python scripts/fetch_api.py --from-file playlist_URL.md

  # 単一プレイリスト
  python scripts/fetch_api.py --url "https://www.youtube.com/playlist?list=XXXXX"

  # キャッシュを無視して再取得
  python scripts/fetch_api.py --from-file playlist_URL.md --force
"""

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from keion_stats.config import RAW_DIR, get_youtube_api_key
from keion_stats.fetcher import extract_playlists_from_file
from keion_stats.youtube_api import (
    estimate_quota_cost,
    fetch_all_playlists_api,
    fetch_playlist_full,
    fetch_single_video,
)


def main():
    parser = argparse.ArgumentParser(
        description="YouTube Data API v3 でメタデータ取得"
    )
    parser.add_argument("--video", help="単一動画URL（概要欄プレビュー用）")
    parser.add_argument("--url", help="プレイリストURL（単一）")
    parser.add_argument("--from-file", help="プレイリストURLリストファイル（playlist_URL.md等）")
    parser.add_argument("--force", action="store_true", help="キャッシュを無視して再取得")
    parser.add_argument("--dry-run", action="store_true", help="APIクォータ見積もりのみ表示")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    # APIキー取得
    try:
        api_key = get_youtube_api_key()
    except ValueError as e:
        print(f"エラー: {e}")
        sys.exit(1)

    # --- 単一動画モード ---
    if args.video:
        print(f"動画取得中: {args.video}")
        try:
            video = fetch_single_video(api_key, args.video)
        except ValueError as e:
            print(f"エラー: {e}")
            sys.exit(1)

        print(f"\n=== 動画情報 ===")
        print(f"  タイトル: {video['title']}")
        print(f"  動画ID: {video['video_id']}")
        print(f"  投稿日: {video['upload_date']}")
        print(f"  再生回数: {video['view_count']}")
        print(f"  概要欄 ({len(video['description'])}文字):")
        print(f"  ---")
        for line in video["description"].split("\n"):
            print(f"  {line}")
        print(f"  ---")

        # パース結果のプレビュー
        from keion_stats.parser import parse_description
        parsed = parse_description(
            description=video["description"],
            video_id=video["video_id"],
            video_url=video["url"],
            video_title=video["title"],
            upload_date=video["upload_date"],
        )
        print(f"\n=== パース結果 ===")
        print(f"  日付: {parsed.date}")
        print(f"  バンド名: {parsed.band_name}")
        print(f"  曲数: {len(parsed.songs)}")
        for s in parsed.songs:
            print(f"    - {s.title} / {s.artist}")
        print(f"  メンバー数: {len(parsed.members)}")
        for m in parsed.members:
            print(f"    - {m.grade}年 {m.part} {m.name}")
        if parsed.parse_warnings:
            print(f"  警告: {len(parsed.parse_warnings)}件")
            for w in parsed.parse_warnings:
                print(f"    ⚠ {w}")
        return

    # --- プレイリストモード ---
    if args.from_file:
        filepath = Path(args.from_file)
        if not filepath.exists():
            print(f"エラー: {filepath} が見つかりません")
            sys.exit(1)

        playlists = extract_playlists_from_file(filepath)
        print(f"検出されたプレイリスト: {len(playlists)} 件")
        for i, pl in enumerate(playlists, 1):
            print(f"  {i:2d}. {pl.get('title') or '(タイトルなし)'}")

        # dry-run: クォータ見積もり
        if args.dry_run:
            # 既存キャッシュから概算動画数を計算
            estimated = len(playlists) * 15  # 平均15動画/プレイリスト
            cache_file = RAW_DIR / "playlist_cache.json"
            if cache_file.exists():
                with open(cache_file, encoding="utf-8") as f:
                    estimated = len(json.load(f))
            quota = estimate_quota_cost(len(playlists), estimated)
            print(f"\n=== APIクォータ見積もり ===")
            print(f"  プレイリスト取得: {quota['playlist_requests']} リクエスト")
            print(f"  動画詳細取得: {quota['video_requests']} リクエスト")
            print(f"  合計: {quota['total_units']} units / {quota['daily_quota']} (日次上限)")
            print(f"  消費率: {quota['usage_percent']}%")
            return

        videos = fetch_all_playlists_api(
            api_key,
            [{"url": pl["url"], "title": pl.get("title", "")} for pl in playlists],
            force=args.force,
        )

    elif args.url:
        if args.dry_run:
            quota = estimate_quota_cost(1, 20)
            print(f"APIクォータ見積もり: 約 {quota['total_units']} units")
            return

        videos = fetch_playlist_full(api_key, args.url, force=args.force)

    else:
        print("エラー: --video, --url, --from-file のいずれかを指定してください")
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
