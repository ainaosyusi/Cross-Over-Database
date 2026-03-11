"""データモデル定義"""

from dataclasses import dataclass, field
from datetime import date
from typing import Optional


@dataclass
class Song:
    title: str
    artist: str


@dataclass
class Member:
    grade: str  # "1", "2", "3", "4", "M1", "B2" 等
    name: str
    part: str = ""  # "Vo.", "Gt.", "Ba.", "Dr.", "Key.", "Vo./Gt." 等


@dataclass
class ParsedVideo:
    video_id: str
    url: str
    title: str
    date: Optional[date]
    songs: list[Song]
    members: list[Member]
    raw_description: str
    band_name: str = ""  # バンド名（概要欄に記載されている場合）
    parse_warnings: list[str] = field(default_factory=list)


@dataclass
class MemberSummary:
    name: str
    total_bands: int
    total_songs: int
    unique_artists: int
    grades_seen: list[str]
    bands: list[dict]  # 各バンドの詳細情報
    co_member_stats: dict[str, int]  # 共演者名→共演回数
    artist_stats: dict[str, int]  # アーティスト名→演奏回数


@dataclass
class Rankings:
    by_band_count: list[dict]
    by_song_count: list[dict]
    by_artist_diversity: list[dict]
    popular_songs: list[dict]
    popular_artists: list[dict]
    frequent_pairs: list[dict]
    most_viewed: list[dict] = field(default_factory=list)
    part_stats: list[dict] = field(default_factory=list)
    event_stats: list[dict] = field(default_factory=list)
    view_count_members: list[dict] = field(default_factory=list)
    tori_ranking: list[dict] = field(default_factory=list)
    collaboration_diversity: list[dict] = field(default_factory=list)
