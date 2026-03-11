"""YouTube動画メタデータ取得（yt-dlp使用）"""

import json
import logging
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import yt_dlp

from .config import RAW_DIR, get_cookie_option

logger = logging.getLogger(__name__)


def _playlist_id_from_url(url: str) -> str:
    """URLからプレイリストIDを抽出"""
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    return qs.get("list", ["unknown"])[0]


def fetch_playlist(
    playlist_url: str,
    output_dir: Path | None = None,
    playlist_title: str = "",
) -> list[dict]:
    """プレイリストから全動画のメタデータを取得

    Args:
        playlist_url: YouTubeプレイリストURL
        output_dir: 生JSONの保存先。Noneならdata/raw/
        playlist_title: プレイリスト（イベント）名

    Returns:
        各動画のメタデータ辞書のリスト
    """
    if output_dir is None:
        output_dir = RAW_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    # プレイリストIDごとにキャッシュ
    pl_id = _playlist_id_from_url(playlist_url)
    cache_file = output_dir / f"pl_{pl_id}.json"
    if cache_file.exists():
        logger.info("キャッシュを使用: %s (%s)", playlist_title or pl_id, cache_file.name)
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)

    logger.info("取得中: %s (%s)", playlist_title or pl_id, playlist_url)

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "ignoreerrors": True,
        "skip_download": True,
    }
    ydl_opts.update(get_cookie_option())

    videos = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        result = ydl.extract_info(playlist_url, download=False)

        if result is None:
            logger.error("プレイリストの取得に失敗: %s", playlist_title or playlist_url)
            return []

        # プレイリストタイトルがなければYouTubeから取得
        if not playlist_title:
            playlist_title = result.get("title", "")

        entries = result.get("entries", [])
        total = len(entries) if entries else 0
        logger.info("  動画数: %d", total)

        for i, entry in enumerate(entries or [], 1):
            if entry is None:
                logger.warning("  動画 %d: スキップ（取得失敗）", i)
                continue

            video_data = {
                "video_id": entry.get("id", ""),
                "title": entry.get("title", ""),
                "description": entry.get("description", ""),
                "upload_date": entry.get("upload_date", ""),
                "url": f"https://www.youtube.com/watch?v={entry.get('id', '')}",
                "view_count": entry.get("view_count"),
                "playlist_index": i,
                "playlist_title": playlist_title,
                "playlist_id": pl_id,
            }
            videos.append(video_data)

            if i % 20 == 0:
                logger.info("  進捗: %d/%d 動画取得完了", i, total)

    # プレイリスト単位でキャッシュ
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(videos, f, ensure_ascii=False, indent=2)
    logger.info("  キャッシュ保存: %s (%d動画)", cache_file.name, len(videos))

    return videos


def extract_playlists_from_file(filepath: Path) -> list[dict]:
    """playlist_URL.md等からプレイリストURLとイベント名を抽出

    Returns:
        [{"url": "...", "title": "...", "date": "..."}, ...]
    """
    text = filepath.read_text(encoding="utf-8")
    lines = text.splitlines()

    playlists = []
    seen_ids = set()

    for i, line in enumerate(lines):
        # YouTube playlist URLを検出
        url_match = re.search(
            r'(https?://(?:www\.)?youtube\.com/playlist\?list=[^\s]+)',
            line,
        )
        if not url_match:
            continue

        url = url_match.group(1)
        # &si= 等のトラッキングパラメータを除去、&feature=shared も除去
        url = re.sub(r'[&?](si|feature)=[^\s&]*', '', url)
        # 末尾の余分な文字を除去
        url = url.rstrip()

        pl_id = _playlist_id_from_url(url)
        if pl_id in seen_ids:
            continue
        seen_ids.add(pl_id)

        # イベント名を前後の行から推定
        title = ""
        # 個人名行のパターン（「名前 パート — 日付」形式）
        _person_line_re = re.compile(r'.+[\s(].+[./].+\s*—\s*\d{4}/')
        # 直後のYouTube埋め込みタイトル行を探す
        for j in range(i + 1, min(i + 4, len(lines))):
            candidate = lines[j].strip()
            if not candidate or candidate == "YouTube" or candidate.startswith("画像"):
                continue
            if re.match(r'https?://', candidate):
                continue
            # 個人名+パート+日付の行はスキップ
            if _person_line_re.match(candidate):
                continue
            title = candidate
            break

        playlists.append({"url": url, "title": title, "playlist_id": pl_id})

    logger.info("ファイルから %d 個のプレイリストを検出: %s", len(playlists), filepath.name)
    return playlists


def fetch_all_playlists(
    playlists: list[dict],
    output_dir: Path | None = None,
) -> list[dict]:
    """複数プレイリストを一括取得してマージ

    Args:
        playlists: [{"url": "...", "title": "..."}, ...]
        output_dir: キャッシュ保存先

    Returns:
        全動画のメタデータリスト
    """
    all_videos = []
    for i, pl in enumerate(playlists, 1):
        logger.info("[%d/%d] %s", i, len(playlists), pl.get("title") or pl["url"])
        videos = fetch_playlist(
            pl["url"],
            output_dir=output_dir,
            playlist_title=pl.get("title", ""),
        )
        all_videos.extend(videos)

    # マージ結果も保存
    if output_dir is None:
        output_dir = RAW_DIR
    merged_file = output_dir / "playlist_cache.json"
    with open(merged_file, "w", encoding="utf-8") as f:
        json.dump(all_videos, f, ensure_ascii=False, indent=2)
    logger.info("全体マージ保存: %s (%d動画)", merged_file.name, len(all_videos))

    return all_videos
