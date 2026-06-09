"""統計計算ロジック"""

import json
import re
from collections import Counter, defaultdict
from datetime import date
from itertools import combinations

from .config import ARTIST_ALIASES_FILE, DATA_DIR
from .models import MemberSummary, ParsedVideo, Song, Rankings


def _academic_year(d: date) -> int:
    """日付から年度を返す（4月始まり）"""
    return d.year if d.month >= 4 else d.year - 1


def infer_current_grade(name: str, videos: list[ParsedVideo], today: date | None = None) -> str:
    """
    メンバーの現在の学年を推定する。

    ロジック:
    1. 動画出演履歴から (日付, 学年) のペアを全て取得
    2. 最新の出演記録の学年を基準に、経過年度分を加算
    3. 4年超え → "OB"
    4. 留年/休学: 後の出演で学年が上がっていない場合はその学年を信用
    """
    if today is None:
        today = date.today()

    current_ay = _academic_year(today)

    # (日付, 学年) のペアを収集
    appearances: list[tuple[date, str]] = []
    for v in videos:
        if v.date is None:
            continue
        for m in v.members:
            if m.name == name and m.grade.isdigit():
                appearances.append((v.date, m.grade))

    if not appearances:
        return "?"

    # 年度別の最大学年を集計（同年度に複数の学年表記があれば最大を採用）
    # 概要欄の誤記や混在に対するロバスト性のため
    grade_by_ay: dict[int, int] = {}
    for d, g in appearances:
        ay = _academic_year(d)
        g_int = int(g)
        if ay not in grade_by_ay or g_int > grade_by_ay[ay]:
            grade_by_ay[ay] = g_int

    sorted_ays = sorted(grade_by_ay.keys())
    latest_ay = sorted_ays[-1]
    # その年度における最大学年を基準にする
    actual_latest_grade = grade_by_ay[latest_ay]

    # 経過年度
    years_passed = current_ay - latest_ay

    # 推定現在学年
    inferred = actual_latest_grade + years_passed

    if inferred > 4:
        return "OB"
    elif inferred < 1:
        return "?"
    else:
        return str(inferred)


def _grade_key(grade: str) -> int:
    """学年をソート用の数値に変換（大きいほど高学年）"""
    grade = grade.upper().strip()
    if grade.startswith("M"):
        return 10 + int(grade[1:]) if len(grade) > 1 and grade[1:].isdigit() else 10
    if grade.startswith("D"):
        return 20 + int(grade[1:]) if len(grade) > 1 and grade[1:].isdigit() else 20
    if grade.startswith("B"):
        return int(grade[1:]) if len(grade) > 1 and grade[1:].isdigit() else 0
    if grade.isdigit():
        return int(grade)
    return 0


class StatsCalculator:
    def __init__(self, videos: list[ParsedVideo], raw_videos: list[dict] | None = None):
        self.videos = [
            v for v in videos
            if (v.songs or v.members) and not re.search(r'\benc\.\s*$', v.title, re.IGNORECASE)
        ]
        # アーティストエイリアスを適用（パーサーで取りこぼした分を補完）
        artist_aliases = {}
        if ARTIST_ALIASES_FILE.exists():
            with open(ARTIST_ALIASES_FILE, encoding="utf-8") as f:
                artist_aliases = json.load(f)
        if artist_aliases:
            for v in self.videos:
                v.songs = [
                    Song(title=s.title, artist=artist_aliases.get(s.artist, s.artist))
                    for s in v.songs
                ]
        # 生データから視聴回数とプレイリスト情報を取得
        self._view_counts: dict[str, int | None] = {}
        self._playlist_titles: dict[str, str] = {}
        self._playlist_ids: dict[str, str] = {}
        if raw_videos:
            for rv in raw_videos:
                vid = rv.get("video_id", "")
                self._view_counts[vid] = rv.get("view_count")
                self._playlist_titles[vid] = rv.get("playlist_title", "")
                self._playlist_ids[vid] = rv.get("playlist_id", "")

    def get_all_member_names(self) -> list[str]:
        """全メンバー名をユニークに取得"""
        names: set[str] = set()
        for v in self.videos:
            for m in v.members:
                names.add(m.name)
        return sorted(names)

    def member_summary(self, name: str) -> MemberSummary:
        """特定メンバーの統計を計算"""
        bands = [v for v in self.videos if any(m.name == name for m in v.members)]

        # 学年の変遷
        grades_seen = sorted({
            m.grade for v in bands for m in v.members if m.name == name
        })

        # バンド詳細リスト
        band_details = []
        for v in bands:
            co_members = [m.name for m in v.members if m.name != name]
            # この人のパート
            my_part = next((m.part for m in v.members if m.name == name), "")
            band_details.append({
                "video_id": v.video_id,
                "url": v.url,
                "title": v.title,
                "date": v.date.isoformat() if v.date else None,
                "band_name": v.band_name,
                "part": my_part,
                "songs": [{"title": s.title, "artist": s.artist} for s in v.songs],
                "co_members": co_members,
            })

        # 日付降順でソート（新しいバンドが上）
        band_details.sort(key=lambda b: b["date"] or "0000-00-00", reverse=True)

        return MemberSummary(
            name=name,
            total_bands=len(bands),
            total_songs=sum(len(v.songs) for v in bands),
            unique_artists=len({s.artist for v in bands for s in v.songs}),
            grades_seen=grades_seen,
            current_grade=infer_current_grade(name, self.videos),
            bands=band_details,
            co_member_stats=self._calc_co_members(name, bands),
            artist_stats=self._calc_artist_stats(bands),
            genre_distribution=self._calc_genre_distribution(bands),
        )

    def _calc_co_members(self, name: str, bands: list[ParsedVideo]) -> dict[str, int]:
        """共演者の回数を集計"""
        counter: Counter[str] = Counter()
        for v in bands:
            for m in v.members:
                if m.name != name:
                    counter[m.name] += 1
        return dict(counter.most_common())

    def _calc_artist_stats(self, bands: list[ParsedVideo]) -> dict[str, int]:
        """アーティスト別演奏回数"""
        counter: Counter[str] = Counter()
        for v in bands:
            for s in v.songs:
                counter[s.artist] += 1
        return dict(counter.most_common())

    def _calc_genre_distribution(self, bands: list[ParsedVideo]) -> dict[str, int]:
        """ジャンル別演奏回数"""
        genre_map_path = DATA_DIR / "genre_map.json"
        if not genre_map_path.exists():
            return {}
        with open(genre_map_path, encoding="utf-8") as f:
            genre_map = json.load(f)
        counter: Counter[str] = Counter()
        for v in bands:
            for s in v.songs:
                genre = genre_map.get(s.artist)
                if genre:
                    counter[genre] += 1
        return dict(counter)

    def all_rankings(self) -> Rankings:
        """全ランキングを計算"""
        all_names = self.get_all_member_names()
        summaries = {name: self.member_summary(name) for name in all_names}

        return Rankings(
            by_band_count=sorted(
                [{"name": n, "count": s.total_bands} for n, s in summaries.items()],
                key=lambda x: x["count"], reverse=True,
            ),
            by_song_count=sorted(
                [{"name": n, "count": s.total_songs} for n, s in summaries.items()],
                key=lambda x: x["count"], reverse=True,
            ),
            by_artist_diversity=sorted(
                [{"name": n, "unique_artists": s.unique_artists} for n, s in summaries.items()],
                key=lambda x: x["unique_artists"], reverse=True,
            ),
            popular_songs=self._rank_popular_songs(),
            popular_artists=self._rank_popular_artists(),
            frequent_pairs=self._rank_frequent_pairs(),
            most_viewed=self._rank_most_viewed(),
            part_stats=self._rank_part_stats(),
            event_stats=self._rank_event_stats(),
            view_count_members=self._rank_view_count_members(),
            tori_ranking=self._rank_tori(),
            collaboration_diversity=self._rank_collaboration_diversity(),
        )

    def _rank_popular_songs(self) -> list[dict]:
        """人気曲ランキング"""
        counter: Counter[tuple[str, str]] = Counter()
        for v in self.videos:
            for s in v.songs:
                counter[(s.title, s.artist)] += 1
        return [
            {"title": title, "artist": artist, "play_count": count}
            for (title, artist), count in counter.most_common()
        ]

    def _rank_popular_artists(self) -> list[dict]:
        """人気アーティストランキング"""
        song_counter: Counter[str] = Counter()
        band_counter: Counter[str] = Counter()
        for v in self.videos:
            artists_in_video: set[str] = set()
            for s in v.songs:
                song_counter[s.artist] += 1
                artists_in_video.add(s.artist)
            for a in artists_in_video:
                band_counter[a] += 1
        return [
            {
                "artist": artist,
                "song_count": song_counter[artist],
                "band_count": band_counter[artist],
            }
            for artist, _ in song_counter.most_common()
        ]

    def _rank_frequent_pairs(self) -> list[dict]:
        """よく一緒に組むペアランキング"""
        pair_counter: Counter[tuple[str, str]] = Counter()
        for v in self.videos:
            names = sorted({m.name for m in v.members})
            for n1, n2 in combinations(names, 2):
                pair_counter[(n1, n2)] += 1
        return [
            {"pair": list(pair), "count": count}
            for pair, count in pair_counter.most_common()
        ]

    def _rank_most_viewed(self) -> list[dict]:
        """視聴回数ランキング"""
        viewed = []
        for v in self.videos:
            vc = self._view_counts.get(v.video_id)
            if vc is not None and vc > 0:
                viewed.append({
                    "video_id": v.video_id,
                    "title": v.title,
                    "url": v.url,
                    "band_name": v.band_name,
                    "view_count": vc,
                    "date": v.date.isoformat() if v.date else None,
                    "songs": [s.title for s in v.songs[:3]],
                    "members": [m.name for m in v.members],
                })
        viewed.sort(key=lambda x: x["view_count"], reverse=True)
        return viewed

    _INVALID_PARTS = {"Winding.", "Road."}

    def _rank_part_stats(self) -> list[dict]:
        """パート別統計"""
        part_counter: Counter[str] = Counter()
        part_members: dict[str, set[str]] = defaultdict(set)
        # メンバーごとの最高学年を記録
        member_max_grade: dict[str, str] = {}
        for v in self.videos:
            for m in v.members:
                if m.part:
                    parts = [p.strip().rstrip("/") for p in m.part.split("/") if p.strip()]
                    parts = [p for p in parts if p not in self._INVALID_PARTS]
                    for p in parts:
                        part_counter[p] += 1
                        part_members[p].add(m.name)
                # 最高学年を更新
                if m.name not in member_max_grade or _grade_key(m.grade) > _grade_key(member_max_grade[m.name]):
                    member_max_grade[m.name] = m.grade
        result = []
        for part, count in part_counter.most_common():
            members = sorted(part_members[part])
            members_with_grade = [
                {"name": name, "max_grade": member_max_grade.get(name, "?")}
                for name in members
            ]
            # 最高学年の降順でソート
            members_with_grade.sort(key=lambda x: -_grade_key(x["max_grade"]))
            result.append({
                "part": part,
                "total_appearances": count,
                "unique_members": len(members),
                "members": members_with_grade,
            })
        return result

    def _rank_event_stats(self) -> list[dict]:
        """イベント（プレイリスト）別統計"""
        event_data: dict[tuple, dict] = {}
        for v in self.videos:
            pl_title = self._playlist_titles.get(v.video_id, "")
            if not pl_title:
                continue
            pl_id = self._playlist_ids.get(v.video_id, "")
            # 同名イベントを年度別に区別するためplaylist_idも含めたキーで管理
            key = (pl_title, pl_id)
            if key not in event_data:
                event_data[key] = {
                    "event": pl_title,
                    "playlist_id": pl_id,
                    "bands": 0,
                    "songs": 0,
                    "members": set(),
                    "artists": set(),
                    "date": v.date.isoformat() if v.date else None,
                    "total_views": 0,
                }
            ed = event_data[key]
            ed["bands"] += 1
            ed["songs"] += len(v.songs)
            for m in v.members:
                ed["members"].add(m.name)
            for s in v.songs:
                ed["artists"].add(s.artist)
            vc = self._view_counts.get(v.video_id)
            if vc:
                ed["total_views"] += vc
            if v.date and (ed["date"] is None or v.date.isoformat() < ed["date"]):
                ed["date"] = v.date.isoformat()

        result = []
        for ed in event_data.values():
            result.append({
                "event": ed["event"],
                "playlist_id": ed["playlist_id"],
                "date": ed["date"],
                "bands": ed["bands"],
                "songs": ed["songs"],
                "members": len(ed["members"]),
                "artists": len(ed["artists"]),
                "total_views": ed["total_views"],
            })
        # 日付降順でソート（上が新しい、下が古い）
        # 同日のイベントは2日目→1日目の順（上が2日目、下が1日目）
        def _day_num(ed: dict) -> int:
            m = re.search(r'([1-9一二三四])\s*日目', ed["event"])
            if not m:
                return 0
            s = m.group(1)
            return {"一": 1, "二": 2, "三": 3, "四": 4}.get(s, int(s) if s.isdigit() else 0)

        result.sort(key=lambda x: (x["date"] or "0000", _day_num(x)), reverse=True)
        return result

    def _rank_view_count_members(self) -> list[dict]:
        """視聴回数の多い動画に出演しているメンバーランキング"""
        member_views: Counter[str] = Counter()
        member_video_count: Counter[str] = Counter()
        for v in self.videos:
            vc = self._view_counts.get(v.video_id)
            if vc is None or vc <= 0:
                continue
            for m in v.members:
                member_views[m.name] += vc
                member_video_count[m.name] += 1
        result = [
            {
                "name": name,
                "total_views": member_views[name],
                "video_count": member_video_count[name],
            }
            for name in member_views
        ]
        result.sort(key=lambda x: x["total_views"], reverse=True)
        return result

    def _rank_tori(self) -> list[dict]:
        """ライブトリ率ランキング（各イベントで最後の動画に出演した率）"""
        # イベントごとに動画を収集
        event_videos: dict[str, list[ParsedVideo]] = defaultdict(list)
        for v in self.videos:
            pl_title = self._playlist_titles.get(v.video_id, "")
            if pl_title:
                event_videos[pl_title].append(v)

        # 各メンバーの参加イベント数とトリ回数を集計
        member_tori: Counter[str] = Counter()
        member_events: dict[str, set[str]] = defaultdict(set)

        for event, vids in event_videos.items():
            # 各メンバーの参加イベントを記録
            for v in vids:
                for m in v.members:
                    member_events[m.name].add(event)

            # トリ動画を特定: タイトルの番号プレフィックス（例: "23. バンド名"）で最大を選ぶ
            def _extract_number(video: ParsedVideo) -> int:
                match = re.match(r'(\d+)\s*[\.\.\s]', video.title)
                return int(match.group(1)) if match else -1

            max_num = max(_extract_number(v) for v in vids)
            if max_num > 0:
                # 番号付きの場合、最大番号の動画がトリ
                last_video = max(vids, key=_extract_number)
            else:
                # 番号がない場合、リストの最後の動画をトリとする
                last_video = vids[-1]

            for m in last_video.members:
                member_tori[m.name] += 1

        result = []
        for name in member_tori:
            event_count = len(member_events[name])
            tori_count = member_tori[name]
            result.append({
                "name": name,
                "tori_count": tori_count,
                "event_count": event_count,
                "tori_rate": round(tori_count / event_count, 4) if event_count > 0 else 0.0,
            })
        result.sort(key=lambda x: (-x["tori_count"], -x["tori_rate"]))
        return result

    def _rank_collaboration_diversity(self) -> list[dict]:
        """交流度ランキング（共演したユニーク人数）"""
        co_members: dict[str, set[str]] = defaultdict(set)
        member_video_count: Counter[str] = Counter()
        for v in self.videos:
            names = {m.name for m in v.members}
            for name in names:
                member_video_count[name] += 1
                co_members[name].update(names - {name})
        result = [
            {
                "name": name,
                "unique_partners": len(partners),
                "video_count": member_video_count[name],
            }
            for name, partners in co_members.items()
        ]
        result.sort(key=lambda x: (-x["unique_partners"], -x["video_count"]))
        return result

    def overall_stats(self) -> dict:
        """全体統計"""
        all_songs = [(s.title, s.artist) for v in self.videos for s in v.songs]
        all_artists = {s.artist for v in self.videos for s in v.songs}
        all_members = {m.name for v in self.videos for m in v.members}

        return {
            "total_videos": len(self.videos),
            "total_members": len(all_members),
            "total_songs": len(all_songs),
            "unique_songs": len(set(all_songs)),
            "total_artists": len(all_artists),
        }
