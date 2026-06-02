"""概要欄テキストのパーサー"""

import json
import logging
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Optional

from .config import ARTIST_ALIASES_FILE, NAME_ALIASES_FILE
from .models import Member, ParsedVideo, Song

logger = logging.getLogger(__name__)

# --- 日付パターン ---
DATE_PATTERNS = [
    re.compile(r'(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})'),
    re.compile(r'(\d{4})年(\d{1,2})月(\d{1,2})日'),
]

# --- 曲パターン ---
# "1.万歳千唱/RADWIMPS", "1. 万歳千唱 / RADWIMPS",
# "1.万歳千唱(RADWIMPS)", " 1.  pain pain pain / teto"
# "1,だから僕は音楽を辞めた / ヨルシカ" (カンマ区切りも対応)
SONG_PATTERN = re.compile(
    r'^[0-9]{1,2}\s*[.．、,，\)）]\s*'
    r'(.+?)'
    r'(?:\s*[/／]\s*|\s*[(\（]\s*)'
    r'(.+?)'
    r'[)\）]?\s*$'
)

# --- バンド名行パターン ---
# "4.　teto", "13.  survivors" (番号＋名前のみ、曲のような/がない)
BAND_NAME_PATTERN = re.compile(
    r'^[0-9]{1,2}\s*[.．、,，\)）]\s*'
    r'([^\d/／(\（][^\n]*?)\s*$'
)

# --- パート名パターン ---
# "Vo.", "Gt.", "Ba.", "Dr.", "Key.", "Vo./Gt.", "Syn.", "Sax.", "Pf." 等
# "Vo / Gt.", "Vo /Gt." のようなスペース入り区切りにも対応
PART_PATTERN = re.compile(
    r'^((?:[A-Za-z]+\.?\s*/\s*)*[A-Za-z]+\.?/?)\s+'
)

# --- メンバーパターン ---
# "2年 山田太郎", "2年 Vo. 佐藤花子", "1年 Vo./Gt. 田中一郎"
# "2年Vo.鈴木次郎" (スペースなし), "1年Drms. 高橋三郎"
MEMBER_PATTERN = re.compile(
    r'^([BMDbmd]?\d)\s*年\s*[.．]?\s*生?\s*'
    r'(?:[BMDbmd]?\d\s*年\s*[.．]?\s*)?'  # 二重学年 "3年 2年 Vo." に対応
    r'((?:[A-Za-z]+\./?)*\s*\S.*?)\s*$'
)


def _normalize(text: str) -> str:
    """全角数字・記号を半角に正規化"""
    return unicodedata.normalize("NFKC", text)


def _load_name_aliases() -> dict[str, str]:
    """名前エイリアスファイルを読み込む"""
    if NAME_ALIASES_FILE.exists():
        with open(NAME_ALIASES_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _load_artist_aliases() -> dict[str, str]:
    """アーティスト名エイリアスファイルを読み込む"""
    if ARTIST_ALIASES_FILE.exists():
        with open(ARTIST_ALIASES_FILE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def _try_parse_date(line: str) -> Optional[date]:
    """行から日付を抽出。見つからなければNone"""
    for pattern in DATE_PATTERNS:
        m = pattern.search(line)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
    return None


# パート名正規化マップ（小文字→正式表記）
_PART_NORMALIZE = {
    'vo': 'Vo.', 'gt': 'Gt.', 'ba': 'Ba.', 'dr': 'Dr.', 'key': 'Key.',
    'cho': 'Cho.', 'sax': 'Sax.', 'syn': 'Syn.', 'pf': 'Pf.', 'vn': 'Vn.',
    'tp': 'Tp.', 'tb': 'Tb.', 'fl': 'Fl.', 'per': 'Per.', 'perc': 'Perc.',
    'drms': 'Drms.', 'drs': 'Drs.', 'rap': 'Rap', 'dj': 'DJ.',
    'trp': 'Tp.', 'trb': 'Tb.', 'cajon': 'Cajon', 'uk': 'Uk.',
    'ewi': 'Ewi.', 'va': 'Va.', 'mand': 'Mand.',
    'a': 'A.',  # A.Gt. (acoustic guitar) prefix
    'c': 'C.',  # C.Gt. (classical guitar) prefix
    'w': 'W.',  # W.Ba. (wood bass) prefix
    'pro': 'Pro.',
}


# プレフィックスパート（次のパートと結合すべき）
_PART_PREFIXES = {'a', 'c', 'w', 'sh'}


def _normalize_part(part: str) -> str:
    """パート名を正規化: vo→Vo., gt.→Gt., Vo/Gt→Vo./Gt. 等

    A.Gt.→A.Gt. (プレフィックス結合), Vo/Gt→Vo./Gt.
    """
    if not part:
        return part
    # 複合パート（"Vo./Gt.", "Ba.Vo.", "Gt.vo"）をトークンに分割
    tokens = re.split(r'[./\s]+', part.strip())
    tokens = [t for t in tokens if t]
    # まず各トークンを正規化
    norm_tokens = []
    for t in tokens:
        lower = t.lower()
        if lower in _PART_NORMALIZE:
            norm_tokens.append(_PART_NORMALIZE[lower])
        else:
            norm_tokens.append(t.capitalize() + ('.' if not t.endswith('.') else ''))

    # プレフィックスを次のトークンと結合（A. + Gt. → A.Gt.）
    result = []
    i = 0
    while i < len(norm_tokens):
        t = norm_tokens[i]
        t_base = t.rstrip('.')
        if t_base.lower() in _PART_PREFIXES and i + 1 < len(norm_tokens):
            result.append(t + norm_tokens[i + 1])
            i += 2
        else:
            result.append(t)
            i += 1
    return '/'.join(result)


def _clean_name(name: str) -> str:
    """名前から不要な付加情報を除去

    "(3枠目)", "(ACT!!)", "(1.SPECIALZ /King Gnu" 等を除去
    末尾の数字（学年漏れ等）も除去
    """
    # 括弧で始まる付加情報を除去（枠番号、ACT!!、曲情報等）
    name = re.sub(r'\s*[\(（].*$', '', name)
    # 末尾の数字を除去（"佐藤新吾3", "石木ひかる3" 等の学年漏れ）
    name = re.sub(r'\d+$', '', name)
    # 先頭のドットやスペースを除去
    name = re.sub(r'^[\s.．]+', '', name)
    # 末尾の余分な空白
    return name.strip()


# 既知のパート名（大文字小文字無視で比較）
_KNOWN_PARTS = {
    'vo', 'gt', 'ba', 'dr', 'key', 'cho', 'sax', 'syn', 'pf', 'vn',
    'tp', 'tb', 'fl', 'per', 'drms', 'perc', 'mand',
}


def _is_valid_name(name: str) -> bool:
    """名前として妥当かチェック"""
    if not name:
        return False
    # "/" のみ、空白のみ
    if re.match(r'^[\s/／.]+$', name):
        return False
    # パート名のみ: "Gt.", "Vo./Gt." 等 — 各トークンが既知パートか判定
    tokens = re.split(r'[./\s]+', name.strip())
    tokens = [t for t in tokens if t]
    if tokens and all(t.lower() in _KNOWN_PARTS for t in tokens):
        return False
    return True


def _extract_part_and_name(raw_name: str) -> tuple[str, str]:
    """パート表記を全て除去し、残った日本語名を返す

    "Gt.  / Cho大薗心翔" → ("Gt./Cho", "大薗心翔")
    "Vo. /(Gt. ) 上野莉子" → ("Vo./Gt.", "上野莉子")
    "C. Gt. /Cho. 飯生舞" → ("C.Gt./Cho.", "飯生舞")
    """
    s = raw_name.strip()
    # 名前に付加された括弧情報を先に除去: (3枠目), (ACT!!), (曲情報) 等
    # ただしパート括弧 (Gt.) は残す必要があるので、パート名以外の括弧内容を除去
    s = re.sub(r'\((?![A-Za-z]+\.?\s*\))[^)]*\)?\s*$', '', s)
    s = re.sub(r'（[^）]*）?\s*$', '', s)
    # パート区切り用の括弧を除去: (Gt.) → Gt.
    s = re.sub(r'[(\（)\）]', '', s)
    # パート的な英字トークンを先頭から除去し集める
    parts = []
    while s:
        # 先頭の区切り文字（/、スペース）を消す
        s = re.sub(r"^[\s/／,]+", '', s)
        # 英字+ドット(任意)のパートトークン（Sh'Vo.のようなアポストロフィ付きも対応）
        m = re.match(r"^([A-Za-z]+['.]*[A-Za-z]*\.?)\s*", s)
        if m and m.group(1) != s:  # 全体がパートトークンの場合は名前かもしれないので中断
            parts.append(m.group(1))
            s = s[m.end():]
        else:
            break
    part_str = '/'.join(parts) if parts else ''
    name = _clean_name(s.strip())
    return part_str, name


def _parse_member_name(raw_name: str) -> tuple[str, str]:
    """メンバー名からパート名と名前を分離

    _extract_part_and_name を使い、英字パートトークンを全て分離して名前を返す。

    Args:
        raw_name: "Vo. 佐藤花子" や "Vo./Gt. 田中一郎" や "Dr.中村四郎"

    Returns:
        (part, name) のタプル
    """
    raw_name = raw_name.strip()

    # 先頭が英字またはパート記号で始まる場合は _extract_part_and_name で統一処理
    if re.match(r'^[A-Za-z/]', raw_name):
        part, name = _extract_part_and_name(raw_name)
        if name:
            return part, name

    return "", _clean_name(raw_name)


def parse_description(
    description: str,
    video_id: str = "",
    video_url: str = "",
    video_title: str = "",
    upload_date: str = "",
) -> ParsedVideo:
    """概要欄テキストを構造化データに変換"""
    normalized = _normalize(description)
    lines = [line.strip() for line in normalized.split('\n')]

    parsed_date = None
    songs: list[Song] = []
    members: list[Member] = []
    warnings: list[str] = []
    band_name: str = ""
    aliases = _load_name_aliases()
    artist_aliases = _load_artist_aliases()

    for line in lines:
        if not line:
            continue

        # 装飾行（区切り線: ーー, --, ==, __ 等）のスキップ
        if re.match(r'^[\s\-ー=_─━]+$', line):
            continue

        # 既知のスキップ行（セットリスト非公開、インタールード、備考等）
        if re.match(r'^(セットリスト非公開|インタールード|MC|※|＊|頭切れ)', line):
            continue

        # "バンド名:xxx" 形式
        band_label_match = re.match(r'^バンド名[:：]\s*(.+)', line)
        if band_label_match:
            band_name = band_label_match.group(1).strip()
            continue

        # 視聴数行
        if re.match(r'^\d+回視聴', line):
            d = _try_parse_date(line)
            if d:
                parsed_date = d
            continue

        # 日付の抽出（まだ見つかっていない場合）
        if parsed_date is None:
            d = _try_parse_date(line)
            if d:
                parsed_date = d
                continue

        # 曲の抽出（"番号. 曲名 / アーティスト" 形式）
        song_match = SONG_PATTERN.match(line)
        if song_match:
            title = song_match.group(1).strip()
            artist = song_match.group(2).strip()
            artist = artist_aliases.get(artist, artist)
            songs.append(Song(title=title, artist=artist))
            continue

        # メンバーの抽出（"学年 [パート] 名前" 形式）
        member_match = MEMBER_PATTERN.match(line)
        if member_match:
            grade = member_match.group(1)
            raw_name = member_match.group(2).strip()
            # 「非公開」プレフィックスを除去（パート非公開の意）
            raw_name = re.sub(r'^非公開\s+', '', raw_name)
            part, name = _parse_member_name(raw_name)
            norm_part = _normalize_part(part)
            # 名前に " / " が含まれる場合、複数名に分割（"佐々木響生 / 鈴木柊人"）
            split_names = re.split(r'\s*/\s*', name) if ' / ' in name else [name]
            for n in split_names:
                n = n.strip()
                if _is_valid_name(n):
                    n = aliases.get(n, n)
                    members.append(Member(grade=grade, name=n, part=norm_part))
            continue

        # 番号なし「曲名/アーティスト」形式（トツゲキライブ等）
        # 学年・パートを含まない、/区切りの行を曲として扱う
        if '/' in line and not re.search(r'\d+\s*年|同期|演奏時間|出演希望', line):
            parts = line.split('/', 1)
            if len(parts) == 2:
                t = parts[0].strip()
                a = parts[1].strip()
                if t and a and len(t) < 60 and len(a) < 60 and not t[0].isdigit():
                    a = artist_aliases.get(a, a)
                    songs.append(Song(title=t, artist=a))
                    continue

        # パート名+名前のみ（学年なし）: "Vo.大橋ゆい", "Gt. 蛯名了一"
        # "Vo / Gt. 佐々木一真", "Ba.Vo. 安田龍平" 等も対応
        if re.match(r'^[A-Za-z]', line):
            part, name = _extract_part_and_name(line)
            # パートがあり、名前が日本語を含む場合のみメンバーとして登録
            if part and _is_valid_name(name) and name and not name[0].isdigit() and re.search(r'[^\x00-\x7F]', name):
                name = aliases.get(name, name)
                members.append(Member(grade="?", name=name, part=_normalize_part(part)))
                continue

        # バンド名行の抽出（"番号. バンド名" 形式、曲パターンに一致しなかったもの）
        band_match = BAND_NAME_PATTERN.match(line)
        if band_match:
            candidate = band_match.group(1).strip()
            # 明らかに短すぎる or 数字だけの場合はスキップ
            if candidate and not candidate.isdigit():
                band_name = candidate
            continue

        # どのパターンにもマッチしない非空行
        if len(line) > 1:
            warnings.append(f"未パース行: {line}")

    # upload_dateからのフォールバック日付
    if parsed_date is None and upload_date:
        try:
            parsed_date = date(
                int(upload_date[:4]),
                int(upload_date[4:6]),
                int(upload_date[6:8]),
            )
        except (ValueError, IndexError):
            pass

    if warnings:
        logger.debug("動画 %s の警告: %s", video_id, warnings)

    return ParsedVideo(
        video_id=video_id,
        url=video_url,
        title=video_title,
        date=parsed_date,
        songs=songs,
        members=members,
        raw_description=description,
        band_name=band_name,
        parse_warnings=warnings,
    )


def parse_all(raw_videos: list[dict]) -> list[ParsedVideo]:
    """生の動画データリストを全てパース"""
    results = []
    total_warnings = 0

    for video in raw_videos:
        parsed = parse_description(
            description=video.get("description", ""),
            video_id=video.get("video_id", ""),
            video_url=video.get("url", ""),
            video_title=video.get("title", ""),
            upload_date=video.get("upload_date", ""),
        )
        results.append(parsed)
        total_warnings += len(parsed.parse_warnings)

    videos_with_songs = sum(1 for r in results if r.songs)
    videos_with_members = sum(1 for r in results if r.members)
    logger.info(
        "パース完了: %d動画 (曲あり: %d, メンバーあり: %d, 警告: %d件)",
        len(results), videos_with_songs, videos_with_members, total_warnings,
    )

    return results
