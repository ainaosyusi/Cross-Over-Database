#!/usr/bin/env python3
"""統計計算 + Excel/JSON出力"""

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from keion_stats.config import OUTPUT_DIR, RAW_DIR, WEB_DATA_DIR
from keion_stats.excel_export import export_excel
from keion_stats.json_export import export_json
from keion_stats.parser import parse_all
from keion_stats.stats import StatsCalculator


def main():
    parser = argparse.ArgumentParser(description="統計計算とExcel/JSON出力")
    parser.add_argument("--input", help="入力JSONファイルパス（デフォルト: data/raw/playlist_cache.json）")
    parser.add_argument("--show-warnings", action="store_true", help="パース警告を表示")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s: %(message)s",
    )

    # データ読み込み
    input_path = Path(args.input) if args.input else RAW_DIR / "playlist_cache.json"
    if not input_path.exists():
        print(f"エラー: {input_path} が見つかりません。先に fetch_all.py を実行してください。")
        sys.exit(1)

    with open(input_path, encoding="utf-8") as f:
        raw_videos = json.load(f)

    print(f"入力: {len(raw_videos)} 動画")

    # パース
    parsed = parse_all(raw_videos)

    # 警告表示
    if args.show_warnings:
        for v in parsed:
            if v.parse_warnings:
                print(f"\n--- {v.title} ({v.video_id}) ---")
                for w in v.parse_warnings:
                    print(f"  {w}")

    # 統計計算
    calc = StatsCalculator(parsed, raw_videos=raw_videos)
    rankings = calc.all_rankings()
    overall = calc.overall_stats()

    print(f"\n=== 全体統計 ===")
    print(f"  動画数: {overall['total_videos']}")
    print(f"  メンバー数: {overall['total_members']}")
    print(f"  総演奏曲数: {overall['total_songs']}")
    print(f"  ユニーク曲数: {overall['unique_songs']}")
    print(f"  アーティスト数: {overall['total_artists']}")

    # Excel出力
    excel_path = OUTPUT_DIR / "keion_stats.xlsx"
    export_excel(parsed, calc, rankings, excel_path)
    print(f"\nExcel出力: {excel_path}")

    # JSON出力
    export_json(parsed, calc, rankings, WEB_DATA_DIR)
    print(f"JSON出力: {WEB_DATA_DIR}/")

    # ランキングプレビュー
    print(f"\n=== バンド数ランキング TOP5 ===")
    for i, item in enumerate(rankings.by_band_count[:5], 1):
        print(f"  {i}. {item['name']} ({item['count']}回)")

    print(f"\n=== 人気アーティスト TOP5 ===")
    for i, item in enumerate(rankings.popular_artists[:5], 1):
        print(f"  {i}. {item['artist']} (曲数: {item['song_count']}, バンド数: {item['band_count']})")

    print(f"\n=== ベストコンビ TOP5 ===")
    for i, item in enumerate(rankings.frequent_pairs[:5], 1):
        print(f"  {i}. {item['pair'][0]} & {item['pair'][1]} ({item['count']}回)")


if __name__ == "__main__":
    main()
