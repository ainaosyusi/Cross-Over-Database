"""YouTube Data API v3 を使った動画メタデータ取得

yt-dlp の代替として、公式APIで概要欄・統計情報を取得する。
GitHub Actions やサーバーレス環境でも動作可能。
"""

import json
import logging
import re
from pathlib import Path
from typing import Optional

from .config import RAW_DIR

logger = logging.getLogger(__name__)

# YouTube URL からID抽出用パターン
_PLAYLIST_ID_RE = re.compile(r'(?:list=)([\w-]+)')
_VIDEO_ID_RE = re.compile(r'(?:v=|youtu\.be/)([\w-]+)')


def _build_service(api_key: str):
    """YouTube Data API サービスオブジェクトを構築"""
    from googleapiclient.discovery import build
    return build("youtube", "v3", developerKey=api_key)


def extract_playlist_id(url: str) -> str:
    """URLからプレイリストIDを抽出"""
    m = _PLAYLIST_ID_RE.search(url)
    if not m:
        raise ValueError(f"プレイリストIDが見つかりません: {url}")
    return m.group(1)


def extract_video_id(url: str) -> str:
    """URLから動画IDを抽出"""
    m = _VIDEO_ID_RE.search(url)
    if not m:
        raise ValueError(f"動画IDが見つかりません: {url}")
    return m.group(1)


def fetch_playlist_items(api_key: str, playlist_id: str) -> list[dict]:
    """プレイリスト内の全動画IDとメタデータを取得

    Returns:
        [{"video_id": str, "title": str, "position": int, "playlist_id": str}, ...]
    """
    service = _build_service(api_key)
    items = []
    next_page = None

    while True:
        request = service.playlistItems().list(
            part="snippet",
            playlistId=playlist_id,
            maxResults=50,
            pageToken=next_page,
        )
        response = request.execute()

        for item in response.get("items", []):
            snippet = item["snippet"]
            video_id = snippet["resourceId"]["videoId"]
            items.append({
                "video_id": video_id,
                "title": snippet.get("title", ""),
                "position": snippet.get("position", 0),
                "playlist_id": playlist_id,
            })

        next_page = response.get("nextPageToken")
        if not next_page:
            break

    logger.info("プレイリスト %s: %d 動画取得", playlist_id, len(items))
    return items


def fetch_video_details(api_key: str, video_ids: list[str]) -> dict[str, dict]:
    """動画の詳細情報（概要欄・統計）を一括取得

    50件ずつバッチ処理（API制限）。

    Returns:
        {video_id: {"title", "description", "upload_date", "view_count", "channel_title"}, ...}
    """
    service = _build_service(api_key)
    results = {}

    # 50件ずつバッチ
    for i in range(0, len(video_ids), 50):
        batch_ids = video_ids[i:i + 50]
        request = service.videos().list(
            part="snippet,statistics",
            id=",".join(batch_ids),
        )
        response = request.execute()

        for item in response.get("items", []):
            vid = item["id"]
            snippet = item["snippet"]
            stats = item.get("statistics", {})

            # upload_date: "2024-02-25T..." → "20240225"
            published = snippet.get("publishedAt", "")
            upload_date = published[:10].replace("-", "") if published else ""

            results[vid] = {
                "title": snippet.get("title", ""),
                "description": snippet.get("description", ""),
                "upload_date": upload_date,
                "view_count": int(stats.get("viewCount", 0)),
                "channel_title": snippet.get("channelTitle", ""),
            }

    logger.info("動画詳細: %d / %d 件取得", len(results), len(video_ids))
    return results


def fetch_playlist_full(
    api_key: str,
    playlist_url: str,
    playlist_title: str = "",
    cache_dir: Optional[Path] = None,
    force: bool = False,
) -> list[dict]:
    """プレイリストURLから全動画の完全なメタデータを取得

    既存の fetcher.fetch_playlist() と同じ出力形式を返す。
    キャッシュ機構あり（cache_dir/api_pl_{playlist_id}.json）。

    Returns:
        [{"video_id", "title", "description", "upload_date", "url",
          "view_count", "playlist_index", "playlist_title", "playlist_id"}, ...]
    """
    playlist_id = extract_playlist_id(playlist_url)
    cache_dir = cache_dir or RAW_DIR
    cache_file = cache_dir / f"api_pl_{playlist_id}.json"

    # キャッシュチェック
    if not force and cache_file.exists():
        logger.info("キャッシュ使用: %s", cache_file)
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)

    # Step 1: プレイリスト内の動画一覧を取得
    pl_items = fetch_playlist_items(api_key, playlist_id)
    if not pl_items:
        logger.warning("プレイリスト %s に動画がありません", playlist_id)
        return []

    # Step 2: 動画の詳細情報を取得
    video_ids = [item["video_id"] for item in pl_items]
    details = fetch_video_details(api_key, video_ids)

    # Step 3: 統合
    videos = []
    for item in pl_items:
        vid = item["video_id"]
        detail = details.get(vid, {})
        videos.append({
            "video_id": vid,
            "title": detail.get("title", item["title"]),
            "description": detail.get("description", ""),
            "upload_date": detail.get("upload_date", ""),
            "url": f"https://www.youtube.com/watch?v={vid}",
            "view_count": detail.get("view_count", 0),
            "playlist_index": item["position"] + 1,
            "playlist_title": playlist_title or "",
            "playlist_id": playlist_id,
        })

    # キャッシュ保存
    cache_dir.mkdir(parents=True, exist_ok=True)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)
    logger.info("キャッシュ保存: %s (%d動画)", cache_file, len(videos))

    return videos


def fetch_single_video(api_key: str, video_url: str) -> dict:
    """単一動画のメタデータを取得

    管理者UIから新しい動画を追加する際に使用。

    Returns:
        {"video_id", "title", "description", "upload_date", "url", "view_count"}
    """
    video_id = extract_video_id(video_url)
    details = fetch_video_details(api_key, [video_id])

    if video_id not in details:
        raise ValueError(f"動画が見つかりません: {video_url}")

    detail = details[video_id]
    return {
        "video_id": video_id,
        "title": detail["title"],
        "description": detail["description"],
        "upload_date": detail["upload_date"],
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "view_count": detail["view_count"],
    }


def fetch_all_playlists_api(
    api_key: str,
    playlists: list[dict],
    cache_dir: Optional[Path] = None,
    force: bool = False,
) -> list[dict]:
    """複数プレイリストを一括取得してマージ

    Args:
        playlists: [{"url": str, "title": str}, ...]

    Returns:
        全動画のリスト（重複除去済み）
    """
    cache_dir = cache_dir or RAW_DIR
    all_videos = []
    seen_ids = set()

    for pl in playlists:
        url = pl.get("url", "")
        title = pl.get("title", "")
        if not url:
            continue

        try:
            videos = fetch_playlist_full(
                api_key, url, playlist_title=title,
                cache_dir=cache_dir, force=force,
            )
            for v in videos:
                if v["video_id"] not in seen_ids:
                    seen_ids.add(v["video_id"])
                    all_videos.append(v)
        except Exception as e:
            logger.error("プレイリスト取得エラー (%s): %s", url, e)

    # 統合キャッシュ保存
    cache_file = cache_dir / "playlist_cache.json"
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(all_videos, f, ensure_ascii=False, indent=2)
    logger.info("統合キャッシュ保存: %d動画 → %s", len(all_videos), cache_file)

    return all_videos


def estimate_quota_cost(num_playlists: int, estimated_videos: int) -> dict:
    """API クォータ消費量の見積もり

    YouTube Data API のデフォルト日次クォータ: 10,000 units
    - playlistItems.list: 1 unit/request (50件/request)
    - videos.list: 1 unit/request (50件/request)

    Returns:
        {"playlist_requests": int, "video_requests": int, "total_units": int}
    """
    import math
    pl_requests = num_playlists * math.ceil(estimated_videos / num_playlists / 50)
    vid_requests = math.ceil(estimated_videos / 50)
    total = pl_requests + vid_requests
    return {
        "playlist_requests": pl_requests,
        "video_requests": vid_requests,
        "total_units": total,
        "daily_quota": 10000,
        "usage_percent": round(total / 10000 * 100, 2),
    }
