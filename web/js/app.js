"use strict";

let membersData = null;
let rankingsData = null;
let videosData = null;

// --- ナビゲーション履歴 ---
const navHistory = [];
function pushNav(entry) {
    navHistory.push(entry);
}
function popNav() {
    if (navHistory.length === 0) return null;
    return navHistory.pop();
}
function goBack() {
    const prev = popNav();
    if (!prev) return;
    // 戻り先に応じて画面復元（履歴に積まないよう内部呼び出し）
    switch (prev.type) {
        case "member":
            _showMemberDetailNoHistory(prev.name);
            break;
        case "artist":
            _showArtistDetailNoHistory(prev.artist);
            break;
        case "song":
            _showSongDetailNoHistory(prev.title, prev.artist);
            break;
        case "tab":
            switchToTab(prev.tab, prev.rankingTab);
            break;
    }
}
function switchToTab(tabName, rankingTab) {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById(tabName).classList.add("active");
    if (tabName === "rankings" && rankingTab) {
        document.querySelectorAll(".ranking-tab").forEach(t => t.classList.remove("active"));
        const btn = document.querySelector(`[data-ranking="${rankingTab}"]`);
        if (btn) { btn.classList.add("active"); renderRanking(rankingTab); }
    }
}
function backButton() {
    if (navHistory.length === 0) return "";
    return `<button class="back-btn" onclick="goBack()">← 戻る</button>`;
}

// --- データ読み込み ---
async function loadData() {
    try {
        const cacheBust = "?v=" + Date.now();
        const [members, rankings, videos] = await Promise.all([
            fetch("data/members.json" + cacheBust).then(r => r.json()),
            fetch("data/rankings.json" + cacheBust).then(r => r.json()),
            fetch("data/videos.json" + cacheBust).then(r => r.json()),
        ]);
        membersData = members;
        rankingsData = rankings;
        videosData = videos;

        renderOverview();
        renderRanking("band");
        const generatedAt = rankings.generated_at
            ? rankings.generated_at.replace("T", " ").replace(/\+.*$|Z$/, "").replace(/\.\d+$/, "")
            : "-";
        document.getElementById("generated-at").textContent = generatedAt;
    } catch (e) {
        console.error("データ読み込みエラー:", e);
        document.querySelector("main").innerHTML =
            '<div class="placeholder">データファイルが見つかりません。<br>先に generate_stats.py を実行してください。</div>';
    }
}

// --- 全体統計 ---
function renderOverview() {
    const o = rankingsData.overall;
    document.getElementById("stat-videos").textContent = o.total_videos;
    document.getElementById("stat-members").textContent = o.total_members;
    document.getElementById("stat-songs").textContent = o.total_songs;
    document.getElementById("stat-artists").textContent = o.total_artists;
}

// --- ランキング説明 ---
const RANKING_DESCRIPTIONS = {
    "band": "出演バンド数（1動画=1バンド）。同じイベントで複数バンドに参加した場合もそれぞれカウント。",
    "song": "演奏した曲の延べ数。1バンドで3曲演奏なら+3。",
    "diversity": "演奏したアーティストのユニーク数。同じアーティストを何回やっても1カウント。",
    "popular-songs": "全動画を通じて演奏された回数が多い曲。曲名+アーティストの組み合わせでカウント。",
    "popular-artists": "全動画で演奏されたアーティスト別の曲数とバンド数。",
    "pairs": "同じバンド（動画）に出演した2人の組み合わせの回数。",
    "most-viewed": "YouTube動画の視聴回数順。",
    "view-count-members": "出演動画の視聴回数の合計。多くの人に見られた動画に出ている人ほど上位。",
    "tori": "各イベント（プレイリスト）のトリ（最後の演奏）に出演した回数と、参加イベント数に対する割合。",
    "collaboration": "共演したユニーク人数。多くの異なるメンバーと組んだ人ほど上位。",
    "events": "各プレイリスト（イベント）の統計情報。",
    "parts": "パート別の延べ出演回数とユニークメンバー数。",
};

// --- ランキング ---
function renderRanking(type) {
    const container = document.getElementById("ranking-content");
    let html = "";
    const desc = RANKING_DESCRIPTIONS[type];
    const descHtml = desc ? `<div class="ranking-description">${escapeHtml(desc)}</div>` : "";

    switch (type) {
        case "band":
            html = rankingTable(["順位", "名前", "バンド数"],
                rankingsData.by_band_count.map((r, i) => [i + 1, r.name, r.count]), true);
            break;
        case "song":
            html = rankingTable(["順位", "名前", "曲数"],
                rankingsData.by_song_count.map((r, i) => [i + 1, r.name, r.count]), true);
            break;
        case "diversity":
            html = rankingTable(["順位", "名前", "ユニークアーティスト数"],
                rankingsData.by_artist_diversity.map((r, i) => [i + 1, r.name, r.unique_artists]), true);
            break;
        case "popular-songs":
            html = renderPopularSongsRanking(rankingsData.popular_songs || []);
            break;
        case "popular-artists":
            html = renderPopularArtistsRanking(rankingsData.popular_artists || []);
            break;
        case "pairs":
            html = renderPairsRanking(rankingsData.frequent_pairs || []);
            break;
        case "most-viewed":
            html = renderMostViewedRanking(rankingsData.most_viewed || []);
            break;
        case "view-count-members":
            html = renderViewCountMembersRanking(rankingsData.view_count_members || []);
            break;
        case "tori":
            html = renderToriRanking(rankingsData.tori_ranking || []);
            break;
        case "collaboration":
            html = renderCollaborationRanking(rankingsData.collaboration_diversity || []);
            break;
        case "events":
            html = renderEventList(rankingsData.event_stats || []);
            break;
        case "parts":
            html = renderPartStats(rankingsData.part_stats || []);
            break;
    }

    container.innerHTML = descHtml + html;
}

function renderEventList(events) {
    if (!events.length) return '<div class="placeholder">データなし</div>';
    return events.map(e => {
        const noData = e.songs === 0 && e.members === 0;
        const plUrl = e.playlist_id ? `https://www.youtube.com/playlist?list=${encodeURIComponent(e.playlist_id)}` : "";
        const eventName = plUrl
            ? `<a href="${plUrl}" target="_blank" rel="noopener" class="event-link">${escapeHtml(e.event)}</a>`
            : escapeHtml(e.event);
        return `
        <div class="band-card">
            <div class="band-date">${escapeHtml(e.date || "日付不明")}</div>
            <div class="member-name" style="font-size:1.1rem;margin:0.3rem 0">${eventName}</div>
            ${noData ? `<div class="no-data-notice">セトリ不明および動画概要欄の情報欠損により情報取得不可能（情報提供者待ってます）</div>` : `
            <div class="member-stats" style="font-size:0.85rem">
                <span>バンド数 <strong>${e.bands}</strong></span>
                <span>曲数 <strong>${e.songs}</strong></span>
                <span>参加者 <strong>${e.members}人</strong></span>
                <span>アーティスト <strong>${e.artists}</strong></span>
                ${e.total_views ? `<span>総視聴 <strong>${e.total_views.toLocaleString()}回</strong></span>` : ""}
            </div>`}
        </div>`;
    }).join("");
}

function rankingTable(headers, rows, nameClickable = false) {
    const ths = headers.map(h => `<th>${h}</th>`).join("");
    const trs = rows.slice(0, 50).map(row => {
        const cells = row.map((cell, ci) => {
            if (ci === 0) {
                const cls = cell <= 3 ? ["", "gold", "silver", "bronze"][cell] : "";
                return `<td class="rank-num ${cls}">${cell}</td>`;
            }
            if (ci === 1 && nameClickable) {
                return `<td class="clickable" onclick="searchMember('${escapeHtml(cell)}')">${escapeHtml(cell)}</td>`;
            }
            return `<td>${escapeHtml(String(cell))}</td>`;
        }).join("");
        return `<tr>${cells}</tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// --- 特殊ランキング描画 ---
function renderMostViewedRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "バンド名/動画", "視聴回数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        const label = r.band_name || r.title;
        const nameCell = r.url
            ? `<td><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="clickable">${escapeHtml(label)}</a></td>`
            : `<td>${escapeHtml(label)}</td>`;
        return `<tr><td class="rank-num ${cls}">${rank}</td>${nameCell}<td>${r.view_count.toLocaleString()}回</td></tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function renderPairsRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "ペア", "共演回数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        const pairHtml = r.pair.map(name =>
            `<span class="clickable" onclick="searchMember('${escapeHtml(name)}')">${escapeHtml(name)}</span>`
        ).join(" <span>&amp;</span> ");
        return `<tr><td class="rank-num ${cls}">${rank}</td><td>${pairHtml}</td><td>${r.count}</td></tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function renderViewCountMembersRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "名前", "総視聴回数", "動画数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="searchMember('${escapeHtml(r.name)}')">${escapeHtml(r.name)}</td>
            <td>${(r.total_views || 0).toLocaleString()}回</td>
            <td>${r.video_count || 0}</td>
        </tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function renderToriRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "名前", "トリ回数", "参加イベント数", "トリ率(%)"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        const rate = r.tori_rate != null ? (r.tori_rate * 100).toFixed(1) : "0.0";
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="searchMember('${escapeHtml(r.name)}')">${escapeHtml(r.name)}</td>
            <td>${r.tori_count || 0}</td>
            <td>${r.event_count || 0}</td>
            <td>${rate}%</td>
        </tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// --- 交流度ランキング ---
function renderCollaborationRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "名前", "共演者数", "出演バンド数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="searchMember('${escapeHtml(r.name)}')">${escapeHtml(r.name)}</td>
            <td>${r.unique_partners}人</td>
            <td>${r.video_count}</td>
        </tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// --- パート別統計（クリック可能） ---
function renderPartStats(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    return items.map(r => {
        const memberList = (r.members || []).map(m => {
            const gradeLabel = m.max_grade === "?" ? "" : `${m.max_grade}年`;
            return `<span class="clickable part-member" onclick="searchMember('${escapeAttr(m.name)}')">${escapeHtml(m.name)}</span>${gradeLabel ? `<span class="part-grade">${gradeLabel}</span>` : ""}`;
        }).join("");
        return `
        <div class="band-card part-card">
            <div class="member-name" style="font-size:1.1rem;margin:0.3rem 0;cursor:pointer" onclick="this.nextElementSibling.classList.toggle('hidden')">${escapeHtml(r.part)} <span class="part-count">(${r.unique_members}人 / 延べ${r.total_appearances}回)</span></div>
            <div class="part-members hidden">${memberList}</div>
        </div>`;
    }).join("");
}

// --- 人気曲ランキング（クリック可能） ---
function renderPopularSongsRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "曲名", "アーティスト", "演奏回数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="showSongDetail('${escapeAttr(r.title)}', '${escapeAttr(r.artist)}')">${escapeHtml(r.title)}</td>
            <td class="clickable" onclick="showArtistDetail('${escapeAttr(r.artist)}')">${escapeHtml(r.artist)}</td>
            <td>${r.play_count}</td>
        </tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// --- 人気アーティストランキング（クリック可能） ---
function renderPopularArtistsRanking(items) {
    if (!items.length) return '<div class="placeholder">データなし</div>';
    const ths = ["順位", "アーティスト", "曲数", "バンド数"].map(h => `<th>${h}</th>`).join("");
    const trs = items.slice(0, 50).map((r, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="showArtistDetail('${escapeAttr(r.artist)}')">${escapeHtml(r.artist)}</td>
            <td>${r.song_count}</td>
            <td>${r.band_count}</td>
        </tr>`;
    }).join("");
    return `<table class="ranking-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

// --- アーティスト詳細表示 ---
function showArtistDetail(artist) {
    // 現在の画面を履歴に保存
    pushNav(_currentNavState());
    _showArtistDetailNoHistory(artist);
}
function _showArtistDetailNoHistory(artist) {
    if (!videosData) return;
    const matches = [];
    const songSet = new Map();
    for (const v of videosData.videos) {
        const artistSongs = (v.songs || []).filter(s => s.artist === artist);
        if (artistSongs.length > 0) {
            matches.push(v);
            for (const s of artistSongs) {
                if (!songSet.has(s.title)) songSet.set(s.title, []);
                songSet.get(s.title).push(v);
            }
        }
    }

    const songList = [...songSet.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([title, vids]) =>
            `<div class="band-card">
                <div class="member-name clickable" onclick="showSongDetail('${escapeAttr(title)}', '${escapeAttr(artist)}')" style="font-size:1rem;margin-bottom:0.3rem">${escapeHtml(title)} <span class="count">(${vids.length}回)</span></div>
                <div class="band-members" style="font-size:0.85rem;color:#888">${vids.map(v => {
                    const label = v.band_name || v.title;
                    return v.url ? `<a href="${escapeHtml(v.url)}" target="_blank" rel="noopener" class="clickable">${escapeHtml(label)}</a>` : escapeHtml(label);
                }).join(", ")}</div>
            </div>`
        ).join("");

    const detail = document.getElementById("member-detail");
    const placeholder = document.getElementById("search-placeholder");
    placeholder.classList.add("hidden");
    detail.classList.remove("hidden");
    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(artist)}</div>
            <div class="member-stats">
                <span>演奏バンド数 <strong>${matches.length}</strong></span>
                <span>曲数 <strong>${songSet.size}</strong></span>
            </div>
        </div>
        <h3 class="section-title">演奏された曲</h3>
        ${songList || '<div class="placeholder">データなし</div>'}
    `;

    _switchToSearchResult();
}

// --- 曲詳細表示（全演奏動画一覧） ---
function showSongDetail(title, artist) {
    pushNav(_currentNavState());
    _showSongDetailNoHistory(title, artist);
}
function _showSongDetailNoHistory(title, artist) {
    if (!videosData) return;
    const matches = [];
    for (const v of videosData.videos) {
        const hasSong = (v.songs || []).some(s => s.title === title && s.artist === artist);
        if (hasSong) matches.push(v);
    }

    const videoList = matches.map(v => {
        const members = (v.members || []).map(m =>
            `<span class="clickable" onclick="searchMember('${escapeAttr(m.name)}')">${escapeHtml(m.name)}</span>`
        ).join(", ");
        const bandLabel = v.band_name ? `<span class="band-name-tag">${escapeHtml(v.band_name)}</span>` : "";
        return `<div class="band-card">
            <div class="band-date">${v.date || "日付不明"} ${bandLabel}</div>
            <div class="band-members">メンバー: ${members}</div>
            ${v.url ? `<a class="band-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">動画を見る →</a>` : ""}
        </div>`;
    }).join("");

    const detail = document.getElementById("member-detail");
    const placeholder = document.getElementById("search-placeholder");
    placeholder.classList.add("hidden");
    detail.classList.remove("hidden");
    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(title)}</div>
            <div class="member-stats">
                <span>アーティスト <strong class="clickable" onclick="showArtistDetail('${escapeAttr(artist)}')">${escapeHtml(artist)}</strong></span>
                <span>演奏回数 <strong>${matches.length}回</strong></span>
            </div>
        </div>
        <h3 class="section-title">演奏動画一覧</h3>
        ${videoList || '<div class="placeholder">データなし</div>'}
    `;

    _switchToSearchResult();
}

// --- ナビゲーションヘルパー ---
function _currentNavState() {
    // 現在アクティブなタブを記録
    const activeTab = document.querySelector(".tab.active");
    const tabName = activeTab ? activeTab.dataset.tab : "overview";
    if (tabName === "search-result") {
        // 検索結果画面の場合、表示内容を判定
        const detail = document.getElementById("member-detail");
        const memberName = document.getElementById("search-input")?.value;
        if (detail && !detail.classList.contains("hidden") && memberName) {
            return { type: "member", name: memberName };
        }
    }
    const activeRanking = document.querySelector(".ranking-tab.active");
    return { type: "tab", tab: tabName, rankingTab: activeRanking?.dataset.ranking || null };
}

function _switchToSearchResult() {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelector('[data-tab="search-result"]').classList.add("active");
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById("search-result").classList.add("active");
}

// --- 属性値エスケープ ---
function escapeAttr(str) {
    return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// --- メンバー検索 ---
function searchMember(name) {
    pushNav(_currentNavState());
    _showMemberDetailNoHistory(name);
}
function _showMemberDetailNoHistory(name) {
    const input = document.getElementById("search-input");
    input.value = name;
    hideSuggestions();
    showMemberDetail(name);
    _switchToSearchResult();
}

function showMemberDetail(name) {
    const member = membersData?.members?.[name];
    const placeholder = document.getElementById("search-placeholder");
    const detail = document.getElementById("member-detail");

    if (!member) {
        placeholder.textContent = `「${name}」は見つかりませんでした`;
        placeholder.classList.remove("hidden");
        detail.classList.add("hidden");
        return;
    }

    placeholder.classList.add("hidden");
    detail.classList.remove("hidden");

    // 共演者タグ
    const coMembers = Object.entries(member.co_member_stats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([n, c]) => `<span class="co-member-tag clickable" onclick="searchMember('${escapeHtml(n)}')">${escapeHtml(n)} <span class="count">(${c}回)</span></span>`)
        .join("");

    // アーティストタグ（クリックでアーティスト詳細へ）
    const artists = Object.entries(member.artist_stats)
        .sort((a, b) => b[1] - a[1])
        .map(([a, c]) => `<span class="artist-tag clickable" onclick="showArtistDetail('${escapeAttr(a)}')">${escapeHtml(a)} <span class="count">(${c}回)</span></span>`)
        .join("");

    // バンド一覧カード
    const bands = (member.bands || []).map(b => {
        const songs = (b.songs || [])
            .map(s => `<li><span class="clickable" onclick="showSongDetail('${escapeAttr(s.title)}', '${escapeAttr(s.artist)}')">${escapeHtml(s.title)}</span> / <span class="clickable" onclick="showArtistDetail('${escapeAttr(s.artist)}')">${escapeHtml(s.artist)}</span></li>`)
            .join("");
        const members = (b.co_members || []).map(n => escapeHtml(n)).join(", ");
        const bandLabel = b.band_name ? `<span class="band-name-tag">${escapeHtml(b.band_name)}</span>` : "";
        const partLabel = b.part ? `<span class="part-tag">${escapeHtml(b.part)}</span>` : "";
        return `
            <div class="band-card">
                <div class="band-date">${b.date || "日付不明"} ${bandLabel} ${partLabel}</div>
                <ul class="band-songs">${songs}</ul>
                <div class="band-members">メンバー: ${members}</div>
                ${b.url ? `<a class="band-link" href="${escapeHtml(b.url)}" target="_blank" rel="noopener">動画を見る →</a>` : ""}
            </div>`;
    }).join("");

    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(name)}</div>
            <div class="member-stats">
                <span>バンド数 <strong>${member.total_bands}</strong></span>
                <span>曲数 <strong>${member.total_songs}</strong></span>
                <span>アーティスト <strong>${member.unique_artists}</strong></span>
                <span>学年 <strong>${(member.grades_seen || []).join(", ")}</strong></span>
            </div>
        </div>
        <h3 class="section-title">よく一緒にやる人</h3>
        <div class="co-member-list">${coMembers || '<span class="placeholder">データなし</span>'}</div>
        <h3 class="section-title">演奏アーティスト</h3>
        <div class="artist-list">${artists || '<span class="placeholder">データなし</span>'}</div>
        <h3 class="section-title">演奏一覧 (${member.total_bands}回)</h3>
        ${bands || '<div class="placeholder">データなし</div>'}
    `;
}

// --- サジェスト ---
function showSuggestions(query) {
    const ul = document.getElementById("suggestions");
    if (!membersData || !query) {
        hideSuggestions();
        return;
    }

    const names = Object.keys(membersData.members)
        .filter(n => n.includes(query))
        .slice(0, 10);

    if (names.length === 0) {
        hideSuggestions();
        return;
    }

    ul.innerHTML = names.map(n =>
        `<li onclick="searchMember('${escapeHtml(n)}')">${escapeHtml(n)}</li>`
    ).join("");
    ul.classList.remove("hidden");
}

function hideSuggestions() {
    document.getElementById("suggestions").classList.add("hidden");
}

// --- ユーティリティ ---
function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// --- イベント ---
document.addEventListener("DOMContentLoaded", () => {
    // auth.jsがある場合はそちらから初期化
    if (typeof initAuth === "function") {
        initAuth();
    } else {
        loadData();
    }

    // タブ切り替え
    document.querySelectorAll(".tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
            document.getElementById(btn.dataset.tab).classList.add("active");
        });
    });

    // ランキングサブタブ
    document.querySelectorAll(".ranking-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".ranking-tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            renderRanking(btn.dataset.ranking);
        });
    });

    // 検索入力
    const input = document.getElementById("search-input");
    input.addEventListener("input", () => showSuggestions(input.value.trim()));
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && input.value.trim()) {
            hideSuggestions();
            searchMember(input.value.trim());
        }
    });

    // サジェスト外クリックで閉じる
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".search-box")) hideSuggestions();
    });
});
