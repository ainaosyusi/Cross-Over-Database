#!/usr/bin/env python3
"""
新ライブデータの追加を一括で行うスクリプト

使い方:
  python scripts/update_live.py --url "https://youtube.com/playlist?list=PLxxx"

処理の流れ:
  1. プレイリストの動画を取得（yt-dlp）
  2. 全キャッシュを統合（playlist_cache.json）
  3. 統計を再計算（generate_stats.py相当）
  4. meta.jsonの更新日時を更新
  5. ニュースエントリを追加（index.html）
  6. サーバーアップロード対象ファイルを表示
"""

import argparse
import json
import logging
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "src"))

RAW_DIR = ROOT / "data" / "raw"
WEB_DATA_DIR = ROOT / "web" / "data"
INDEX_HTML = ROOT / "web" / "index.html"


def step(msg):
    print(f"\n{'='*50}")
    print(f"  {msg}")
    print(f"{'='*50}")


def fetch_playlist(url, force=False):
    """プレイリストを取得"""
    step("1. プレイリスト取得")
    cmd = [sys.executable, str(ROOT / "scripts" / "fetch_all.py"), "--url", url]
    if force:
        cmd.append("--force")
    result = subprocess.run(cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(1)


def rebuild_cache():
    """全キャッシュを統合"""
    step("2. キャッシュ統合")
    combined = []
    seen = set()
    for f in sorted(RAW_DIR.glob("pl_*.json")):
        if f.name == "playlist_cache.json":
            continue
        with open(f) as fh:
            vids = json.load(fh)
        for v in vids:
            vid_id = v.get("video_id", "")
            if vid_id and vid_id not in seen:
                combined.append(v)
                seen.add(vid_id)

    cache_path = RAW_DIR / "playlist_cache.json"
    with open(cache_path, "w") as f:
        json.dump(combined, f, ensure_ascii=False, indent=2)

    pl_count = len(list(RAW_DIR.glob("pl_*.json"))) - 1
    print(f"  統合: {len(combined)}動画 ({pl_count}プレイリスト)")
    return len(combined)


def regenerate_stats():
    """統計を再計算"""
    step("3. 統計再計算")
    cmd = [sys.executable, str(ROOT / "scripts" / "generate_stats.py")]
    result = subprocess.run(cmd, capture_output=True, text=True)
    # 重要な行だけ表示
    for line in result.stdout.split("\n"):
        if any(k in line for k in ["動画数", "上書き", "TOP", "===", "バンド数"]):
            print(f"  {line}")
    if result.returncode != 0:
        print(result.stderr)
        sys.exit(1)


def get_event_summary():
    """最新イベントのサマリーを取得"""
    with open(WEB_DATA_DIR / "rankings.json") as f:
        r = json.load(f)
    with open(WEB_DATA_DIR / "videos.json") as f:
        v = json.load(f)

    latest = r["event_stats"][0]
    total_videos = len(v["videos"])
    has_views = sum(1 for vid in v["videos"] if vid.get("view_count", 0) > 0)
    total_views = sum(vid.get("view_count", 0) for vid in v["videos"])

    return {
        "event": latest["event"],
        "date": latest["date"],
        "bands": latest.get("bands", 0),
        "songs": latest.get("songs", 0),
        "total_videos": total_videos,
        "total_views": total_views,
        "has_views": has_views,
    }


def update_meta():
    """meta.jsonを更新"""
    step("4. meta.json更新")
    meta_path = WEB_DATA_DIR / "meta.json"
    with open(meta_path) as f:
        meta = json.load(f)

    meta["generated_at"] = datetime.now().isoformat(timespec="seconds")

    with open(meta_path, "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print(f"  generated_at: {meta['generated_at']}")
    print(f"  version: {meta['version']}")


def add_news(event_name, bands, songs):
    """index.htmlのニュースに追記"""
    step("5. ニュース追記")
    today = datetime.now().strftime("%Y-%m-%d")

    new_entry = (
        f'                    <div class="news-item">\n'
        f'                        <span class="news-date">{today}</span>\n'
        f'                        <span class="news-badge new">NEW</span>\n'
        f'                        <p class="news-text">{event_name}（{bands}バンド・{songs}曲）のデータを追加しました。</p>\n'
        f'                    </div>'
    )

    html = INDEX_HTML.read_text()

    # 既存のNEWバッジを削除
    html = html.replace(
        '                        <span class="news-badge new">NEW</span>\n',
        ''
    )

    # news-listの直後に新エントリを挿入
    marker = '<div class="news-list">'
    if marker in html:
        html = html.replace(marker, marker + "\n" + new_entry)
        INDEX_HTML.write_text(html)
        print(f"  追加: {event_name}（{bands}バンド・{songs}曲）")
    else:
        print("  ⚠ news-listが見つかりません。手動で追加してください。")


def show_upload_list():
    """サーバーアップロード対象を表示"""
    step("6. サーバーアップロード対象")
    files = [
        "web/data/videos.json",
        "web/data/members.json",
        "web/data/rankings.json",
        "web/data/meta.json",
        "web/data/genre_map.json",
        "web/data/department_map.json",
        "web/index.html",
    ]
    for f in files:
        print(f"  {f}")


def main():
    parser = argparse.ArgumentParser(
        description="新ライブデータの追加を一括で行う",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="例:\n  python scripts/update_live.py --url 'https://youtube.com/playlist?list=PLxxx'",
    )
    parser.add_argument("--url", required=True, help="プレイリストURL")
    parser.add_argument("--force", action="store_true", help="キャッシュを無視して再取得")
    parser.add_argument("--no-news", action="store_true", help="ニュース追記をスキップ")
    args = parser.parse_args()

    print("=" * 50)
    print("  ライブデータ更新スクリプト")
    print("=" * 50)

    # 1. フェッチ
    fetch_playlist(args.url, force=args.force)

    # 2. キャッシュ統合
    rebuild_cache()

    # 3. 統計再計算
    regenerate_stats()

    # 4. meta.json更新
    update_meta()

    # 5. サマリー取得
    summary = get_event_summary()
    print(f"\n  最新イベント: {summary['event']}")
    print(f"  日付: {summary['date']}")
    print(f"  バンド数: {summary['bands']} / 曲数: {summary['songs']}")
    print(f"  総動画数: {summary['total_videos']}")
    print(f"  視聴回数: {summary['total_views']:,}（{summary['has_views']}/{summary['total_videos']}取得済）")

    # 6. ニュース追記
    if not args.no_news:
        add_news(summary["event"], summary["bands"], summary["songs"])

    # 7. アップロード対象表示
    show_upload_list()

    print(f"\n{'='*50}")
    print("  完了！上記ファイルをサーバーにアップロードしてください。")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
