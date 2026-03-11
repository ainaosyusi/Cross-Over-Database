"""Web UI用JSON生成"""

import json
from datetime import datetime
from pathlib import Path

from .models import ParsedVideo, Rankings
from .stats import StatsCalculator


def export_json(
    videos: list[ParsedVideo],
    calculator: StatsCalculator,
    rankings: Rankings,
    output_dir: Path,
):
    """Web UI用のJSONファイルを生成"""
    output_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now().isoformat(timespec="seconds")

    # --- videos.json ---
    videos_data = {
        "generated_at": now,
        "total_videos": len(videos),
        "videos": [
            {
                "video_id": v.video_id,
                "url": v.url,
                "title": v.title,
                "date": v.date.isoformat() if v.date else None,
                "songs": [{"title": s.title, "artist": s.artist} for s in v.songs],
                "band_name": v.band_name,
                "members": [{"grade": m.grade, "name": m.name, "part": m.part} for m in v.members],
            }
            for v in sorted(videos, key=lambda x: (x.date or ""), reverse=True)
            if v.songs or v.members
        ],
    }
    _write_json(output_dir / "videos.json", videos_data)

    # --- members.json ---
    all_names = calculator.get_all_member_names()
    members_data = {
        "generated_at": now,
        "total_members": len(all_names),
        "members": {},
    }
    for name in all_names:
        s = calculator.member_summary(name)
        members_data["members"][name] = {
            "total_bands": s.total_bands,
            "total_songs": s.total_songs,
            "unique_artists": s.unique_artists,
            "grades_seen": s.grades_seen,
            "bands": s.bands,
            "co_member_stats": s.co_member_stats,
            "artist_stats": s.artist_stats,
        }
    _write_json(output_dir / "members.json", members_data)

    # --- rankings.json ---
    overall = calculator.overall_stats()
    rankings_data = {
        "generated_at": now,
        "overall": overall,
        "by_band_count": rankings.by_band_count,
        "by_song_count": rankings.by_song_count,
        "by_artist_diversity": rankings.by_artist_diversity,
        "popular_songs": rankings.popular_songs,
        "popular_artists": rankings.popular_artists,
        "frequent_pairs": rankings.frequent_pairs,
        "most_viewed": rankings.most_viewed,
        "part_stats": rankings.part_stats,
        "event_stats": rankings.event_stats,
        "view_count_members": rankings.view_count_members,
        "tori_ranking": rankings.tori_ranking,
        "collaboration_diversity": rankings.collaboration_diversity,
    }
    _write_json(output_dir / "rankings.json", rankings_data)


def _write_json(path: Path, data: dict):
    """JSONファイルを書き出し"""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
