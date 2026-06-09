"use strict";

let membersData = null;
let artistGlobalTop = null; // { artistName: [rank1Count, rank2Count] }
let rankingsData = null;
let videosData = null;
let songIndex = null;
let debutData = null;
let rankingGradeFilter = null;
let departmentMap = null;

// --- グレードヘルパー ---
const GRADE_ORDER_LIST = ["1", "2", "3", "4", "M1", "M2", "B1", "B2"];
function gradeValue(g) {
    const i = GRADE_ORDER_LIST.indexOf(g);
    return i >= 0 ? i + 1 : 0;
}
function maxGrade(grades) {
    if (!grades || grades.length === 0) return "?";
    return grades.reduce((best, g) => gradeValue(g) > gradeValue(best) ? g : best, grades[0]);
}
function normalizeGrade(g) {
    if (g === "OB") return "OB";
    return gradeValue(g) >= 4 ? "4+" : g;
}
function currentGrade(m) {
    // current_gradeフィールドがあればそれを使用（推定現在学年）
    return m.current_grade || maxGrade(m.grades_seen || []);
}
const DISPLAY_GRADES = ["1", "2", "3", "4+", "OB"];

// --- 曲インデックス構築 ---
function buildSongIndex() {
    if (!videosData || songIndex) return;
    const songs = new Map();
    for (const v of videosData.videos) {
        for (const s of (v.songs || [])) {
            const key = `${s.title}|||${s.artist}`;
            if (!songs.has(key)) songs.set(key, { title: s.title, artist: s.artist, count: 0 });
            songs.get(key).count++;
        }
    }
    songIndex = [...songs.values()].sort((a, b) => b.count - a.count);
}

// --- 初出演データ構築 ---
function computeDebutData() {
    if (!videosData) return;
    const debuts = {};
    const sorted = [...videosData.videos].sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1);
    for (const v of sorted) {
        for (const m of (v.members || [])) {
            if (!debuts[m.name]) {
                debuts[m.name] = { date: v.date, title: v.title, band_name: v.band_name, url: v.url };
            }
        }
    }
    debutData = debuts;
}

function computeArtistGlobalTop() {
    if (!membersData?.members) return;
    const artistCounts = {}; // { artistName: [count, count, ...] }
    for (const member of Object.values(membersData.members)) {
        for (const [artist, count] of Object.entries(member.artist_stats || {})) {
            if (!artistCounts[artist]) artistCounts[artist] = [];
            artistCounts[artist].push(count);
        }
    }
    artistGlobalTop = {};
    for (const [artist, counts] of Object.entries(artistCounts)) {
        const sorted = counts.sort((a, b) => b - a);
        artistGlobalTop[artist] = [sorted[0] ?? 0, sorted[1] ?? 0];
    }
}

// --- ナビゲーション履歴 ---
const navHistory = [];
let currentView = { type: "tab", tab: "overview" };
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
        case "event":
            _showEventDetailNoHistory(prev.eventName);
            break;
        case "tab":
            switchToTab(prev.tab, prev.rankingTab);
            break;
    }
}
function syncTabActive(tabName) {
    document.querySelectorAll(".tab, .btab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(`[data-tab="${tabName}"]`).forEach(t => t.classList.add("active"));
}
function switchToTab(tabName, rankingTab) {
    syncTabActive(tabName);
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
        const cb = "&_=" + Date.now();
        function authFetch(file) {
            return fetch("api/data.php?file=" + file + cb).then(r => {
                if (!r.ok) throw new Error(r.status === 403 ? "auth" : "fetch_error");
                return r.json();
            });
        }
        const [members, rankings, videos, deptMap, meta] = await Promise.all([
            authFetch("members"),
            authFetch("rankings"),
            authFetch("videos"),
            authFetch("department_map").catch(() => null),
            authFetch("meta").catch(() => null),
        ]);
        membersData = members;
        rankingsData = rankings;
        videosData = videos;
        departmentMap = deptMap?.members || null;

        buildSongIndex();
        computeDebutData();
        computeArtistGlobalTop();
        renderOverview();
        renderRanking("band");
        buildEventYearFilter();
        renderEventsTab(null);
        renderBoardPosts();
        const generatedAt = meta?.generated_at
            ? meta.generated_at.replace("T", " ").replace(/\+.*$|Z$/, "").replace(/\.\d+$/, "")
            : "-";
        document.getElementById("generated-at").textContent = generatedAt;
        // 訪問者カウンター
        fetch("api/counter.php").then(r => r.json()).then(c => {
            const el = document.getElementById("visitor-today");
            const el2 = document.getElementById("visitor-total");
            if (el) el.textContent = c.today || 0;
            if (el2) el2.textContent = c.total || 0;
        }).catch(() => {});
        // アカウント状態
        refreshAccountState();
    } catch (e) {
        if (e.message === "auth") {
            // セッション切れ → ログイン画面に戻す
            document.getElementById("app-content").classList.add("hidden");
            document.getElementById("login-screen").classList.remove("hidden");
            return;
        }
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
    renderDailyPick();
}

// --- 今日のおすすめ（日替わり） ---
const POPULAR_MEMBERS = ["川田悠人", "飯盛蒼唯", "川﨑穂高", "吉岡なるみ", "大橋ゆい"];

function renderDailyPick() {
    const el = document.getElementById("daily-pick-content");
    if (!el || !videosData) return;

    // 視聴回数TOP50
    const top50 = videosData.videos
        .filter(v => (v.view_count || 0) > 0 && (v.songs?.length || 0) > 0)
        .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        .slice(0, 50);

    // 人気メンバーのいるバンド（視聴回数10回以上）
    const popMemberBands = videosData.videos
        .filter(v => (v.songs?.length || 0) > 0 && (v.view_count || 0) >= 10)
        .filter(v => (v.members || []).some(m => POPULAR_MEMBERS.includes(m.name)));

    // 重複を除いて統合
    const seen = new Set();
    const candidates = [...top50, ...popMemberBands].filter(v => {
        if (seen.has(v.video_id)) return false;
        seen.add(v.video_id);
        return true;
    });

    if (!candidates.length) { el.innerHTML = "<p>データ準備中</p>"; return; }

    // 日付から決定的に選ぶ（同じ日は同じバンド）
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    const pick = candidates[seed % candidates.length];

    const vidId = extractVideoId(pick.url);
    const thumb = vidId ? `<img src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" class="daily-pick-thumb" alt="${escapeHtml(pick.band_name || pick.title)}">` : "";
    const songs = (pick.songs || []).slice(0, 3).map(s =>
        `<li><span class="clickable" onclick="showSongDetail('${escapeAttr(s.title)}','${escapeAttr(s.artist)}')">${escapeHtml(s.title)}</span> / <span class="clickable" onclick="showArtistDetail('${escapeAttr(s.artist)}')">${escapeHtml(s.artist)}</span></li>`
    ).join("");
    const members = (pick.members || []).slice(0, 8).map(m =>
        `<span class="clickable" onclick="searchMember('${escapeAttr(m.name)}')">${escapeHtml(m.name)}</span>`
    ).join(", ");

    el.innerHTML = `
        <div class="daily-pick">
            <a href="${escapeHtml(pick.url)}" target="_blank" rel="noopener">${thumb}</a>
            <div class="daily-pick-info">
                <div class="daily-pick-name">${escapeHtml(pick.band_name || pick.title)}</div>
                <div class="daily-pick-meta">${pick.event_name || ""} ／ ${pick.date || ""} ／ 👁 ${(pick.view_count || 0).toLocaleString()}回</div>
                <ul class="daily-pick-songs">${songs}</ul>
                <div class="daily-pick-members">${members}</div>
            </div>
        </div>
    `;
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
    "grade": "学年別のメンバー数・活動量・人気アーティストの傾向。各メンバーの最終学年でグルーピング。",
    "debut": "初出演日が最近の順。最新メンバーが上位。",
};

// --- ランキング ---
function renderRanking(type) {
    const container = document.getElementById("ranking-content");
    let html = "";
    const desc = RANKING_DESCRIPTIONS[type];
    const descHtml = desc ? `<div class="ranking-description">${escapeHtml(desc)}</div>` : "";

    switch (type) {
        case "band": {
            const filtered = applyGradeFilter(rankingsData.by_band_count);
            const reranked = filtered.map((r, i) => [i + 1, r.name, r.count]);
            html = renderGradeFilterUI(type) + rankingTable(["順位", "名前", "バンド数"], reranked, true);
            break;
        }
        case "song": {
            const filtered = applyGradeFilter(rankingsData.by_song_count);
            const reranked = filtered.map((r, i) => [i + 1, r.name, r.count]);
            html = renderGradeFilterUI(type) + rankingTable(["順位", "名前", "曲数"], reranked, true);
            break;
        }
        case "diversity": {
            const filtered = applyGradeFilter(rankingsData.by_artist_diversity);
            const reranked = filtered.map((r, i) => [i + 1, r.name, r.unique_artists]);
            html = renderGradeFilterUI(type) + rankingTable(["順位", "名前", "ユニークアーティスト数"], reranked, true);
            break;
        }
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
        case "grade":
            html = renderGradeStats();
            break;
        case "debut":
            html = renderDebutRanking();
            break;
    }

    container.innerHTML = descHtml + html;
}

function renderEventList(events) {
    if (!events.length) return '<div class="placeholder">データなし</div>';
    return events.map(e => {
        const noData = e.songs === 0 && e.members === 0;
        const plUrl = e.playlist_id ? `https://www.youtube.com/playlist?list=${encodeURIComponent(e.playlist_id)}` : "";
        return `
        <div class="band-card">
            <div class="band-date">${escapeHtml(e.date || "日付不明")}</div>
            <div class="member-name clickable" style="font-size:1.1rem;margin:0.3rem 0" onclick="showEventDetail('${escapeAttr(e.event)}')">${escapeHtml(e.event)}</div>
            ${noData ? `<div class="no-data-notice">概要欄無記入につき、情報不足</div>` : `
            <div class="member-stats" style="font-size:0.85rem">
                <span>バンド数 <strong>${e.bands}</strong></span>
                <span>曲数 <strong>${e.songs}</strong></span>
                <span>参加者 <strong>${e.members}人</strong></span>
                <span>アーティスト <strong>${e.artists}</strong></span>
                ${e.total_views ? `<span>総視聴 <strong>${e.total_views.toLocaleString()}回</strong></span>` : ""}
            </div>`}
            ${plUrl ? `<a href="${plUrl}" target="_blank" rel="noopener" class="band-link">YouTubeプレイリスト →</a>` : ""}
        </div>`;
    }).join("");
}

function rankingTable(headers, rows, nameClickable = false) {
    const ths = headers.map(h => `<th>${h}</th>`).join("");
    const trs = rows.slice(0, 50).map(row => {
        const cells = row.map((cell, ci) => {
            if (ci === 0) {
                const cls = cell <= 3 ? ["", "gold", "silver", "bronze"][cell] : "";
                const medal = ["", "🥇", "🥈", "🥉"][cell] || "";
                return `<td class="rank-num ${cls}">${medal || cell}</td>`;
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

// --- 学年フィルター ---
function renderGradeFilterUI(type) {
    const all = rankingGradeFilter === null;
    const btns = [null, ...DISPLAY_GRADES].map(g => {
        const label = g === null ? "全員" : g === "4+" ? "4年生以上" : `${g}年`;
        const active = (g === null ? all : rankingGradeFilter === g) ? " active" : "";
        return `<button class="ranking-tab${active}" style="font-size:0.75rem;padding:0.3rem 0.6rem" onclick="setGradeFilter(${g === null ? "null" : `'${g}'`}, '${type}')">${label}</button>`;
    }).join("");
    return `<div class="ranking-tabs" style="margin-bottom:0.5rem">${btns}</div>`;
}
function setGradeFilter(grade, type) {
    rankingGradeFilter = grade;
    renderRanking(type);
}
function applyGradeFilter(items) {
    if (!rankingGradeFilter || !membersData) return items;
    return items.filter(r => {
        const m = membersData.members[r.name];
        return m && normalizeGrade(currentGrade(m)) === rankingGradeFilter;
    });
}

// --- 学年別統計 ---
function renderGradeStats() {
    if (!membersData) return '<div class="placeholder">データなし</div>';
    const gradeGroups = {};
    for (const [name, m] of Object.entries(membersData.members)) {
        const grade = normalizeGrade(currentGrade(m));
        if (!gradeGroups[grade]) gradeGroups[grade] = [];
        gradeGroups[grade].push({ name, ...m });
    }
    const gradeOrder = ["1", "2", "3", "4+", "OB", "?"];
    const grades = Object.keys(gradeGroups).sort((a, b) => gradeOrder.indexOf(a) - gradeOrder.indexOf(b));
    return grades.map(grade => {
        const members = gradeGroups[grade];
        const totalBands = members.reduce((s, m) => s + m.total_bands, 0);
        const totalSongs = members.reduce((s, m) => s + m.total_songs, 0);
        const artistCount = {};
        for (const m of members) {
            for (const [a, c] of Object.entries(m.artist_stats || {})) {
                artistCount[a] = (artistCount[a] || 0) + c;
            }
        }
        const topArtists = Object.entries(artistCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const topMembers = [...members].sort((a, b) => b.total_bands - a.total_bands).slice(0, 5);
        const label = grade === "4+" ? "4年生以上" : grade === "?" ? "学年不明" : `${grade}年生`;
        return `<div class="band-card">
            <div class="member-name" style="font-size:1.1rem;margin:0.3rem 0">${label} <span class="part-count">(${members.length}人)</span></div>
            <div class="member-stats" style="font-size:0.85rem;margin-bottom:0.5rem">
                <span>延べバンド数 <strong>${totalBands}</strong></span>
                <span>延べ曲数 <strong>${totalSongs}</strong></span>
            </div>
            <div style="font-size:0.8rem;color:#777;margin-bottom:0.3rem">よく演奏するアーティスト:
                ${topArtists.map(([a, c]) => `<span class="clickable" onclick="showArtistDetail('${escapeAttr(a)}')">${escapeHtml(a)}(${c})</span>`).join("　")}
            </div>
            <div style="font-size:0.8rem;color:#777">アクティブメンバー:
                ${topMembers.map(m => `<span class="clickable" onclick="searchMember('${escapeAttr(m.name)}')">${escapeHtml(m.name)}(${m.total_bands})</span>`).join("　")}
            </div>
        </div>`;
    }).join("");
}

// --- 初出演ランキング ---
function renderDebutRanking() {
    if (!debutData || !membersData) return '<div class="placeholder">データなし</div>';
    const list = Object.entries(debutData)
        .filter(([name]) => membersData.members[name])
        .map(([name, d]) => ({ name, ...d }))
        .sort((a, b) => (b.date || "") > (a.date || "") ? 1 : -1);
    const ths = ["順位", "名前", "初出演日", "初出演バンド"].map(h => `<th>${h}</th>`).join("");
    const trs = list.slice(0, 100).map((d, i) => {
        const rank = i + 1;
        const cls = rank <= 3 ? ["", "gold", "silver", "bronze"][rank] : "";
        const link = d.url
            ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" class="clickable">${escapeHtml(d.band_name || d.title || "-")}</a>`
            : escapeHtml(d.band_name || d.title || "-");
        return `<tr>
            <td class="rank-num ${cls}">${rank}</td>
            <td class="clickable" onclick="searchMember('${escapeAttr(d.name)}')">${escapeHtml(d.name)}</td>
            <td style="font-size:0.85rem">${d.date || "-"}</td>
            <td style="font-size:0.8rem">${link}</td>
        </tr>`;
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
            const cg = membersData?.members?.[m.name]?.current_grade || m.max_grade;
            const gradeLabel = cg === "?" ? "" : cg === "OB" ? "OB" : `${cg}年`;
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
    currentView = { type: "artist", artist };
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
                    return videoLinkInline(v, label);
                }).join(", ")}</div>
            </div>`
        ).join("");

    const detail = document.getElementById("member-detail");
    const placeholder = document.getElementById("search-placeholder");
    placeholder.classList.add("hidden");
    detail.classList.remove("hidden");
    // アーティスト連鎖マップ & メンバーランキング
    let chainHtml = "";
    let memberRankHtml = "";
    if (membersData?.members) {
        const chainCount = {};
        const memberRanks = [];
        for (const [mname, m] of Object.entries(membersData.members)) {
            const cnt = m.artist_stats?.[artist];
            if (cnt > 0) {
                memberRanks.push([mname, cnt]);
                for (const [a, c] of Object.entries(m.artist_stats || {})) {
                    if (a === artist) continue;
                    chainCount[a] = (chainCount[a] || 0) + c;
                }
            }
        }
        const topChain = Object.entries(chainCount).sort((a, b) => b[1] - a[1]).slice(0, 10);
        chainHtml = topChain.map(([a, c]) =>
            `<span class="artist-tag clickable" onclick="showArtistDetail('${escapeAttr(a)}')">${escapeHtml(a)} <span class="count">(${c})</span></span>`
        ).join("");

        memberRanks.sort((a, b) => b[1] - a[1]);
        if (memberRanks.length > 0) {
            const LIMIT = 5;
            const uid = `mr-${artist.replace(/[^a-zA-Z0-9]/g, "_")}`;
            const rows = memberRanks.map(([n, c], i) => {
                const cls = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
                const hidden = i >= LIMIT ? ` class="hidden" data-more="${uid}"` : "";
                return `<tr${hidden}><td class="rank-num ${cls}">${i + 1}</td><td class="clickable" onclick="showMemberDetail('${escapeAttr(n)}')">${escapeHtml(n)}</td><td>${c}回</td></tr>`;
            }).join("");
            const moreBtn = memberRanks.length > LIMIT
                ? `<button class="more-btn" data-label="さらに表示（${memberRanks.length - LIMIT}人）" onclick="showMoreRows('${uid}',this)">さらに表示（${memberRanks.length - LIMIT}人）</button>`
                : "";
            memberRankHtml = `<table class="ranking-table"><thead><tr><th>順位</th><th>メンバー</th><th>回数</th></tr></thead><tbody>${rows}</tbody></table>${moreBtn}`;
        }
    }

    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(artist)}</div>
            <div class="member-stats">
                <span>演奏バンド数 <strong>${matches.length}</strong></span>
                <span>曲数 <strong>${songSet.size}</strong></span>
            </div>
        </div>
        ${memberRankHtml ? `<h3 class="section-title">演奏回数ランキング</h3>${memberRankHtml}` : ""}
        ${chainHtml ? `<h3 class="section-title">このアーティストを演奏した人がよく演奏するアーティスト</h3><div class="artist-list">${chainHtml}</div>` : ""}
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
    currentView = { type: "song", title, artist };
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
        const bName = v.band_name || v.title || "";
        const bandLabel = bName ? `<span class="band-name-tag">${escapeHtml(bName)}</span>` : "";
        return `<div class="band-card">
            <div class="band-date">${v.date || "日付不明"} ${bandLabel}</div>
            <div class="band-members">メンバー: ${members}</div>
            ${videoLinks(v)}
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

// --- イベント詳細 ---
function showEventDetail(eventName) {
    pushNav(_currentNavState());
    _showEventDetailNoHistory(eventName);
}
async function _showEventDetailNoHistory(eventName) {
    currentView = { type: "event", eventName };
    if (!videosData) return;
    const eventVideos = videosData.videos
        .filter(v => v.event_name === eventName)
        .sort((a, b) => (a.date || "") < (b.date || "") ? -1 : 1);
    const eventInfo = (rankingsData.event_stats || []).find(e => e.event === eventName);
    const plUrl = eventInfo?.playlist_id
        ? `https://www.youtube.com/playlist?list=${encodeURIComponent(eventInfo.playlist_id)}`
        : "";

    const eventGroup = normalizeEventGroup(eventName);
    // 投票状況を取得（期限切れチェック）
    let voteStatus = null;
    try {
        const r = await fetch("api/vote.php?action=status&event=" + encodeURIComponent(eventGroup));
        if (r.ok) voteStatus = await r.json();
    } catch (e) { /* 取得失敗時はボタン非表示 */ }
    const voteClosed = !voteStatus || voteStatus.closed;
    const bandCards = eventVideos.map((v, i) => {
        const songs = (v.songs || []).map(s =>
            `<li><span class="clickable" onclick="showSongDetail('${escapeAttr(s.title)}','${escapeAttr(s.artist)}')">${escapeHtml(s.title)}</span> / <span class="clickable" onclick="showArtistDetail('${escapeAttr(s.artist)}')">${escapeHtml(s.artist)}</span></li>`
        ).join("");
        const memberList = (v.members || []).map(m =>
            `<span class="clickable" onclick="searchMember('${escapeAttr(m.name)}')">${escapeHtml(m.name)}</span>`
        ).join(", ");
        const bName = v.band_name || v.title || "";
        const bandLabel = bName ? `<span class="band-name-tag">${escapeHtml(bName)}</span>` : "";
        const noData = !v.songs.length && !v.members.length;
        const vid = v.video_id;
        const isFav = userFavorites.has(vid);
        const isOwnBand = accountUser && (v.members || []).some(m => m.name === accountUser.real_name);
        const favBtn = `<button class="vid-action-btn fav-btn ${isFav ? "active" : ""}" onclick="toggleFavorite('${escapeAttr(vid)}', this)">${isFav ? "★" : "☆"} お気に入り</button>`;
        // 投票ボタン: 期限切れ or 投票不可なら非表示、自分のバンドのみ「投票不可」表示
        let voteBtn = "";
        if (!voteClosed) {
            if (isOwnBand) {
                voteBtn = `<button class="vid-action-btn" disabled title="自分のバンドには投票不可">投票不可</button>`;
            } else {
                voteBtn = `<button class="vid-action-btn vote-btn" onclick="castVote('${escapeAttr(vid)}','${escapeAttr(eventGroup)}')">▲ 投票</button>`;
            }
        }
        const commentBtn = `<button class="vid-action-btn" onclick="toggleVideoComments('${escapeAttr(vid)}', this)">💬 コメント</button>`;
        return `<div class="band-card">
            <div class="band-date">${i + 1}. ${bandLabel}</div>
            ${noData ? `<div class="no-data-notice">セトリ不明</div>` : `
            <ul class="band-songs">${songs || "<li>セトリ不明</li>"}</ul>
            <div class="band-members">メンバー: ${memberList || "不明"}</div>`}
            ${videoLinks(v)}
            <div class="vid-actions">${voteBtn}${favBtn}${commentBtn}</div>
            <div class="comment-section hidden" id="cs-${vid}"></div>
        </div>`;
    }).join("");

    const detail = document.getElementById("member-detail");
    document.getElementById("search-placeholder").classList.add("hidden");
    detail.classList.remove("hidden");
    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(eventName)}</div>
            <div class="member-stats">
                <span>バンド数 <strong>${eventInfo?.bands ?? eventVideos.length}</strong></span>
                <span>曲数 <strong>${eventInfo?.songs ?? "?"}</strong></span>
                <span>参加者 <strong>${eventInfo?.members ?? "?"}人</strong></span>
                ${eventInfo?.date ? `<span>開催日 <strong>${eventInfo.date}</strong></span>` : ""}
            </div>
        </div>
        ${plUrl ? `<a href="${plUrl}" target="_blank" rel="noopener" class="band-link">YouTubeプレイリストで見る →</a>` : ""}
        <h3 class="section-title">演奏一覧 (${eventVideos.length}バンド)</h3>
        ${bandCards || '<div class="placeholder">データなし</div>'}
    `;
    _switchToSearchResult();
}

// --- ナビゲーションヘルパー ---
function _currentNavState() {
    return { ...currentView };
}

function _switchToSearchResult() {
    syncTabActive("search-result");
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.getElementById("search-result").classList.add("active");
}

// --- 属性値エスケープ ---
function escapeAttr(str) {
    return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, "&quot;");
}

// --- 動画リンク生成（分割動画は2つ表示）---
function videoLinks(v, label) {
    const lbl = label || v.band_name || v.title;
    if (!v.url) return escapeHtml(lbl);
    let html = `<a class="band-link" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">動画を見る →</a>`;
    if (v.secondary_url) {
        html += ` <a class="band-link" href="${escapeHtml(v.secondary_url)}" target="_blank" rel="noopener">動画を見る（後半）→</a>`;
    }
    return html;
}

function videoLinkInline(v, label) {
    const lbl = label || v.band_name || v.title;
    if (!v.url) return escapeHtml(lbl);
    let html = `<a href="${escapeHtml(v.url)}" target="_blank" rel="noopener" class="clickable">${escapeHtml(lbl)}</a>`;
    if (v.secondary_url) {
        html += ` <a href="${escapeHtml(v.secondary_url)}" target="_blank" rel="noopener" class="clickable">(後半)</a>`;
    }
    return html;
}

// --- メンバー検索 ---
function searchMember(name) {
    pushNav(_currentNavState());
    _showMemberDetailNoHistory(name);
}
function _showMemberDetailNoHistory(name) {
    currentView = { type: "member", name };
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
        const typeLabel = { member: "メンバー", song: "曲", artist: "アーティスト" };
        const items = findSimilarItems(name, 8);
        const suggestionsHtml = items.length > 0
            ? `<div class="did-you-mean">もしかして：${items.map(s =>
                `<span class="clickable" onclick="${s.onclick}">${escapeHtml(s.label)}<span class="did-you-mean-type">${typeLabel[s.type]}</span></span>`
              ).join("　")}</div>`
            : "";
        placeholder.innerHTML = `「${escapeHtml(name)}」は見つかりませんでした${suggestionsHtml}`;
        placeholder.classList.remove("hidden");
        detail.classList.add("hidden");
        return;
    }

    placeholder.classList.add("hidden");
    detail.classList.remove("hidden");

    // 共演者タグ
    const coMemberTags = Object.entries(member.co_member_stats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([n, c]) => `<span class="co-member-tag clickable" onclick="searchMember('${escapeHtml(n)}')">${escapeHtml(n)} <span class="count">(${c}回)</span></span>`);
    const coMembers = collapsibleTags(coMemberTags, 5, `co-${name.replace(/[^a-zA-Z0-9]/g, "_")}`);

    // アーティストタグ（クリックでアーティスト詳細へ）+ メダル
    const artistEntries = Object.entries(member.artist_stats).sort((a, b) => b[1] - a[1]);
    const artistTags = artistEntries
        .map(([a, c]) => {
            const top = artistGlobalTop?.[a] ?? [0, 0];
            const medal = (c === top[0] && c >= 6) ? " 🥇" : (c === top[1] && c < top[0] && c >= 5) ? " 🥈" : "";
            return `<span class="artist-tag clickable" onclick="showArtistDetail('${escapeAttr(a)}')">${escapeHtml(a)} <span class="count">(${c}回)</span>${medal}</span>`;
        });
    const artists = collapsibleTags(artistTags, 5, `art-${name.replace(/[^a-zA-Z0-9]/g, "_")}`);

    // バンド一覧カード
    const bands = (member.bands || []).map(b => {
        const songs = (b.songs || [])
            .map(s => `<li><span class="clickable" onclick="showSongDetail('${escapeAttr(s.title)}', '${escapeAttr(s.artist)}')">${escapeHtml(s.title)}</span> / <span class="clickable" onclick="showArtistDetail('${escapeAttr(s.artist)}')">${escapeHtml(s.artist)}</span></li>`)
            .join("");
        const members = (b.co_members || []).map(n => escapeHtml(n)).join(", ");
        const bandName = b.band_name || b.title || "";
        const bandLabel = bandName ? `<span class="band-name-tag">${escapeHtml(bandName)}</span>` : "";
        const partLabel = b.part ? `<span class="part-tag">${escapeHtml(b.part)}</span>` : "";
        return `
            <div class="band-card">
                <div class="band-date">${b.date || "日付不明"} ${bandLabel} ${partLabel}</div>
                <ul class="band-songs">${songs}</ul>
                <div class="band-members">メンバー: ${members}</div>
                ${videoLinks(b)}
            </div>`;
    }).join("");

    // ジャンルレーダーチャート
    const GENRES = ["邦ロック", "J-POP", "ボカロ/アニソン", "洋楽", "テクニカル", "昭和/歌謡曲", "パンク/ヘビー"];
    const GENRE_LABELS = ["邦ロック", "J-POP", "ボカロ", "洋楽", "テクニカル", "昭和/歌謡", "パンク"];
    const genreDist = member.genre_distribution || {};
    const hasGenreData = GENRES.some(g => genreDist[g] > 0);
    const genreChartId = `genre-chart-${name.replace(/[^a-zA-Z0-9]/g, "_")}`;

    const deptInfo = departmentMap?.[name];
    detail.innerHTML = `
        ${backButton()}
        <div class="member-header">
            <div class="member-name">${escapeHtml(name)}</div>
            ${deptInfo ? `<div class="dept-label">${escapeHtml(deptInfo)}</div>` : ""}
            <div class="member-stats">
                <span>バンド数 <strong>${member.total_bands}</strong></span>
                <span>曲数 <strong>${member.total_songs}</strong></span>
                <span>アーティスト <strong>${member.unique_artists}</strong></span>
                <span>現在 <strong>${(() => {
                    if (member.current_grade === "OB") {
                        const dates = (member.bands || []).map(b => b.date).filter(Boolean).sort();
                        const last = dates[dates.length - 1] || "";
                        const m2 = last.match(/^(\d{4})-(\d{2})/);
                        if (m2) {
                            const fy = parseInt(m2[2]) >= 4 ? parseInt(m2[1]) : parseInt(m2[1]) - 1;
                            return `OB（${fy}年度卒）`;
                        }
                        return "OB";
                    }
                    return (member.current_grade || "?") + "年生";
                })()}</strong></span>
                ${debutData?.[name] ? `<span>初出演 <strong>${debutData[name].date || "不明"}</strong></span>` : ""}
            </div>
        </div>
        <h3 class="section-title">よく一緒にやる人</h3>
        <div class="co-member-list">${coMembers}</div>
        <h3 class="section-title">演奏アーティスト</h3>
        <div class="artist-list">${artists}</div>
        ${hasGenreData ? `
        <div class="genre-chart-section">
            <h3 class="section-title" style="display:flex;align-items:center;justify-content:space-between">
                音楽の傾向
                <button class="more-btn" id="${genreChartId}-toggle" onclick="toggleGenreChart('${genreChartId}')">隠す</button>
            </h3>
            <div id="${genreChartId}-wrap" class="genre-chart-wrap"><canvas id="${genreChartId}" width="400" height="400"></canvas></div>
        </div>` : ""}
        <h3 class="section-title">演奏一覧 (${member.total_bands}回)</h3>
        ${bands || '<div class="placeholder">データなし</div>'}
    `;

    // レーダーチャート描画
    if (hasGenreData) {
        const ctx = document.getElementById(genreChartId).getContext("2d");
        const values = GENRES.map(g => genreDist[g] || 0);
        new Chart(ctx, {
            type: "radar",
            data: {
                labels: GENRE_LABELS,
                datasets: [{
                    data: values,
                    backgroundColor: "rgba(66, 133, 244, 0.18)",
                    borderColor: "rgba(66, 133, 244, 0.85)",
                    borderWidth: 2,
                    pointBackgroundColor: "rgba(66, 133, 244, 0.9)",
                    pointRadius: 3,
                }]
            },
            options: {
                responsive: false,
                layout: { padding: 30 },
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        beginAtZero: true,
                        ticks: { display: false, stepSize: 1 },
                        pointLabels: { font: { size: 12 }, color: "#444" },
                        grid: { color: "rgba(0,0,0,0.08)" },
                        angleLines: { color: "rgba(0,0,0,0.08)" },
                    }
                }
            }
        });
    }
}

// --- 折りたたみタグリスト ---
function collapsibleTags(tags, limit, uid) {
    if (!tags.length) return '<span style="color:#aaa">データなし</span>';
    if (tags.length <= limit) return tags.join("");
    const visible = tags.slice(0, limit).join("");
    const hidden = tags.slice(limit).join("");
    const more = tags.length - limit;
    return `${visible}<span id="${uid}-more" class="hidden">${hidden}</span>
        <button class="more-btn" id="${uid}-btn" onclick="toggleMoreTags('${uid}', ${more})">残り${more}件を表示</button>`;
}
function toggleMoreTags(uid, more) {
    const el = document.getElementById(`${uid}-more`);
    const btn = document.getElementById(`${uid}-btn`);
    const isHidden = el.classList.toggle("hidden");
    btn.textContent = isHidden ? `残り${more}件を表示` : "閉じる";
}

// --- チャートトグル ---
function toggleGenreChart(id) {
    const wrap = document.getElementById(`${id}-wrap`);
    const btn = document.getElementById(`${id}-toggle`);
    const isHidden = wrap.classList.toggle("hidden");
    btn.textContent = isHidden ? "表示" : "隠す";
}

// --- ユーティリティ ---
function showMoreRows(uid, btn) {
    document.querySelectorAll(`[data-more="${uid}"]`).forEach(el => el.classList.remove("hidden"));
    btn.textContent = "閉じる";
    btn.onclick = () => {
        document.querySelectorAll(`[data-more="${uid}"]`).forEach(el => el.classList.add("hidden"));
        btn.textContent = btn.dataset.label;
        btn.onclick = () => showMoreRows(uid, btn);
    };
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

// --- イベント一覧タブ（年度フィルター+サムネイル） ---
function getFiscalYear(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const y = d.getFullYear();
    const m = d.getMonth() + 1; // 1-12
    return m >= 4 ? y : y - 1; // 4月始まり
}
function buildEventYearFilter() {
    const events = rankingsData?.event_stats || [];
    const years = new Set();
    for (const e of events) { const fy = getFiscalYear(e.date); if (fy) years.add(fy); }
    const sorted = [...years].sort((a, b) => b - a);
    const container = document.querySelector(".event-filter");
    if (!container) return;
    container.innerHTML = `<button class="ranking-tab active" onclick="filterEventsByYear('all', this)">すべて</button>` +
        sorted.map(y => `<button class="ranking-tab" onclick="filterEventsByYear(${y}, this)">${y}年度</button>`).join("");
}
function filterEventsByYear(year, btn) {
    document.querySelectorAll(".event-filter .ranking-tab").forEach(b => b.classList.remove("active"));
    if (btn) btn.classList.add("active");
    renderEventsTab(year === "all" ? null : year);
}
function renderEventsTab(fiscalYear) {
    const events = rankingsData?.event_stats || [];
    const filtered = fiscalYear
        ? events.filter(e => getFiscalYear(e.date) === fiscalYear)
        : events;
    const container = document.getElementById("events-list");
    if (!filtered.length) { container.innerHTML = '<div class="placeholder">データなし</div>'; document.getElementById("events-index").innerHTML = ""; return; }
    // イベント名インデックス（年度別）生成
    const indexEl = document.getElementById("events-index");
    if (indexEl) {
        const byYear = {};
        filtered.forEach((e, i) => {
            const fy = getFiscalYear(e.date) || "不明";
            if (!byYear[fy]) byYear[fy] = [];
            byYear[fy].push({ e, i });
        });
        const sortedYears = Object.keys(byYear).sort((a, b) => b - a);
        indexEl.innerHTML = sortedYears.map(y =>
            `<div class="events-index-year">
                <div class="events-index-year-label">${y}年度</div>
                <div class="events-index-grid">${byYear[y].map(({ e, i }) =>
                    `<a href="#" onclick="event.preventDefault();document.getElementById('ev-${i}').scrollIntoView({behavior:'smooth',block:'start'})">${escapeHtml(e.event)}</a>`
                ).join("")}</div>
            </div>`
        ).join("");
    }
    container.innerHTML = filtered.map((e, i) => {
        const noData = e.songs === 0 && e.members === 0;
        const plUrl = e.playlist_id ? `https://www.youtube.com/playlist?list=${encodeURIComponent(e.playlist_id)}` : "";
        // YouTubeサムネイル: プレイリスト内動画から取得
        let thumbHtml = "";
        if (e.playlist_id && videosData) {
            const eventVids = videosData.videos.filter(v => v.event_name === e.event);
            const firstVid = eventVids.find(v => v.url);
            if (firstVid) {
                const vidId = extractVideoId(firstVid.url);
                if (vidId) {
                    thumbHtml = `<img src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" alt="${escapeHtml(e.event)}" class="event-card-thumb" onclick="showEventDetail('${escapeAttr(e.event)}')">`;
                }
            }
        }
        return `
        <div class="band-card" id="ev-${i}">
            <div class="band-date">${escapeHtml(e.date || "日付不明")}</div>
            <div class="member-name clickable" style="font-size:1.1rem;margin:0.3rem 0" onclick="showEventDetail('${escapeAttr(e.event)}')">${escapeHtml(e.event)}</div>
            ${thumbHtml}
            ${noData ? `<div class="no-data-notice">概要欄無記入につき、情報不足</div>` : `
            <div class="member-stats" style="font-size:0.85rem">
                <span>バンド数 <strong>${e.bands}</strong></span>
                <span>曲数 <strong>${e.songs}</strong></span>
                <span>参加者 <strong>${e.members}人</strong></span>
                <span>アーティスト <strong>${e.artists}</strong></span>
                ${e.total_views ? `<span>総視聴 <strong>${e.total_views.toLocaleString()}回</strong></span>` : ""}
            </div>`}
            ${plUrl ? `<a href="${plUrl}" target="_blank" rel="noopener" class="band-link">YouTubeプレイリスト →</a>` : ""}
        </div>`;
    }).join("");
}
function extractVideoId(url) {
    if (!url) return null;
    const m = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

// --- 掲示板（サーバー共有） ---
const BOARD_API_URL = "api/board.php";
let boardPostsCache = [];

async function fetchBoardPosts() {
    try {
        const res = await fetch(BOARD_API_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const posts = await res.json();
        boardPostsCache = Array.isArray(posts) ? posts : [];
    } catch (e) {
        console.warn("掲示板API取得失敗、localStorageフォールバック:", e);
        // API未設置時はlocalStorageフォールバック
        try { boardPostsCache = JSON.parse(localStorage.getItem("keion_board_posts") || "[]"); }
        catch { boardPostsCache = []; }
    }
    return boardPostsCache;
}

function renderBoardPosts() {
    const container = document.getElementById("board-posts");
    if (!container) return;
    fetchBoardPosts().then(posts => {
        if (!posts.length) {
            container.innerHTML = '<div class="placeholder">まだ投稿がありません</div>';
            return;
        }
        container.innerHTML = posts.slice().reverse().map(p => `
            <div class="board-post">
                <div class="board-post-header">
                    <span class="board-post-name">${escapeHtml(p.name)}</span>
                    <span class="board-post-date">${p.date}</span>
                </div>
                <div class="board-post-body">${escapeHtml(p.content)}</div>
            </div>
        `).join("");
    });
}

async function submitBoardPost() {
    const nameInput = document.getElementById("board-name");
    const contentInput = document.getElementById("board-content");
    const errorEl = document.getElementById("board-error");
    const submitBtn = document.getElementById("board-submit");
    const name = nameInput.value.trim();
    const content = contentInput.value.trim();
    errorEl.classList.add("hidden");
    if (!name) { errorEl.textContent = "ニックネームを入力してください"; errorEl.classList.remove("hidden"); return; }
    if (content.length < 10) { errorEl.textContent = "内容は10文字以上で入力してください"; errorEl.classList.remove("hidden"); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "投稿中...";

    try {
        const res = await fetch(BOARD_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, content }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
        }
        nameInput.value = "";
        contentInput.value = "";
        document.getElementById("board-char-count").textContent = "0/500";
        renderBoardPosts();
    } catch (e) {
        // APIが使えない場合はlocalStorageフォールバック
        if (e.message.includes("Failed to fetch") || e.message.includes("NetworkError")) {
            const now = new Date();
            const dateStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
            const posts = boardPostsCache;
            posts.push({ name, content, date: dateStr });
            localStorage.setItem("keion_board_posts", JSON.stringify(posts));
            nameInput.value = "";
            contentInput.value = "";
            document.getElementById("board-char-count").textContent = "0/500";
            renderBoardPosts();
        } else {
            errorEl.textContent = e.message;
            errorEl.classList.remove("hidden");
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "投稿する";
    }
}

// --- 全体統計グラフ描画 ---
let genrePieRendered = false;
function renderStatsCharts() {
    if (genrePieRendered) return;
    genrePieRendered = true;
    renderGenrePieChart();
    renderPartPieChart();
    renderDeptPieChart();
    renderDeptDetailPieChart();
    renderGenreArtistDetail();
}
function renderGenrePieChart() {
    if (!rankingsData?.popular_artists) return;
    const genreMap = {};
    // genre_map.jsonはfetchしてキャッシュ
    fetch("data/genre_map.json?v=" + Date.now()).then(r => r.json()).then(gm => {
        for (const a of rankingsData.popular_artists) {
            const genre = gm[a.artist] || "その他";
            genreMap[genre] = (genreMap[genre] || 0) + a.song_count;
        }
        const labels = Object.keys(genreMap);
        const data = Object.values(genreMap);
        const total = data.reduce((a, b) => a + b, 0);
        const el = document.getElementById("genre-chart-stat");
        if (el) el.textContent = `(${labels.length}ジャンル / ${total}曲)`;
        const legendLabels = labels.map((l, i) => `${l} ${data[i]}曲`);
        const colors = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#FF6384", "#9966FF"];
        const ctx = document.getElementById("genre-pie-chart")?.getContext("2d");
        if (!ctx) return;
        new Chart(ctx, {
            type: "doughnut",
            data: { labels: legendLabels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }] },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } }
        });
    }).catch(() => {});
}
function renderPartPieChart() {
    if (!rankingsData?.part_stats) return;
    const top = rankingsData.part_stats.slice(0, 8);
    const labels = top.map(p => p.part);
    const data = top.map(p => p.unique_members);
    const total = data.reduce((a, b) => a + b, 0);
    const el = document.getElementById("part-chart-stat");
    if (el) el.textContent = `(${labels.length}パート / ${total}人)`;
    const legendLabels = labels.map((l, i) => `${l} ${data[i]}人`);
    const colors = ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#FF6384", "#9966FF"];
    const ctx = document.getElementById("part-pie-chart")?.getContext("2d");
    if (!ctx) return;
    new Chart(ctx, {
        type: "doughnut",
        data: { labels: legendLabels, datasets: [{ data, backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } }
    });
}
function renderDeptPieChart() {
    if (!membersData?.members) return;
    const deptCount = {};
    for (const name of Object.keys(membersData.members)) {
        const raw = departmentMap?.[name];
        // 学部名を抽出（"理学部第一部 数学科" → "理学部第一部"）
        const faculty = raw ? raw.split(/\s+/)[0] : "不明";
        deptCount[faculty] = (deptCount[faculty] || 0) + 1;
    }
    // 人数降順ソート（不明は最後）
    const sorted = Object.entries(deptCount).sort((a, b) => {
        if (a[0] === "不明") return 1;
        if (b[0] === "不明") return -1;
        return b[1] - a[1];
    });
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);
    const total = data.reduce((a, b) => a + b, 0);
    const known = total - (deptCount["不明"] || 0);
    const el = document.getElementById("dept-chart-stat");
    if (el) el.textContent = `(${labels.length - (deptCount["不明"] ? 1 : 0)}学部 / 判明${known}人)`;
    const legendLabels = labels.map((l, i) => `${l} ${data[i]}人`);
    const colors = ["#4472C4", "#ED7D31", "#70AD47", "#FFC000", "#5B9BD5", "#A5A5A5", "#FF6384", "#9966FF", "#36A2EB", "#FF9F40", "#C9CBCF", "#4BC0C0", "#F67019", "#8B5CF6"];
    const ctx = document.getElementById("dept-pie-chart")?.getContext("2d");
    if (!ctx) return;
    new Chart(ctx, {
        type: "doughnut",
        data: { labels: legendLabels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: "bottom", labels: { font: { size: 11 } } } } }
    });
}
function renderDeptDetailPieChart() {
    if (!membersData?.members) return;
    const deptCount = {};
    for (const name of Object.keys(membersData.members)) {
        const raw = departmentMap?.[name];
        const dept = raw || "不明";
        deptCount[dept] = (deptCount[dept] || 0) + 1;
    }
    const sorted = Object.entries(deptCount).sort((a, b) => {
        if (a[0] === "不明") return 1;
        if (b[0] === "不明") return -1;
        return b[1] - a[1];
    });
    const labels = sorted.map(e => e[0]);
    const data = sorted.map(e => e[1]);
    const total = data.reduce((a, b) => a + b, 0);
    const known = total - (deptCount["不明"] || 0);
    const el = document.getElementById("dept-detail-chart-stat");
    if (el) el.textContent = `(${labels.length - (deptCount["不明"] ? 1 : 0)}学科 / 判明${known}人)`;
    const legendLabels = labels.map((l, i) => `${l} ${data[i]}人`);
    const colors = [
        "#4472C4", "#ED7D31", "#70AD47", "#FFC000", "#5B9BD5", "#A5A5A5",
        "#FF6384", "#9966FF", "#36A2EB", "#FF9F40", "#C9CBCF", "#4BC0C0",
        "#F67019", "#8B5CF6", "#2ECC71", "#E74C3C", "#1ABC9C", "#F39C12",
        "#9B59B6", "#34495E", "#E67E22", "#27AE60", "#D35400", "#7F8C8D"
    ];
    const ctx = document.getElementById("dept-detail-pie-chart")?.getContext("2d");
    if (!ctx) return;
    const chartColors = colors.slice(0, labels.length);
    const deptDetailChart = new Chart(ctx, {
        type: "doughnut",
        data: { labels: legendLabels, datasets: [{ data, backgroundColor: chartColors }] },
        options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } } }
    });
    // スクロール可能なHTML凡例を生成
    const legendEl = document.getElementById("dept-detail-legend");
    if (legendEl) {
        legendEl.innerHTML = legendLabels.map((lbl, i) =>
            `<span class="legend-item" data-index="${i}"><span class="legend-color" style="background:${chartColors[i]}"></span>${escapeHtml(lbl)}</span>`
        ).join("");
        legendEl.querySelectorAll(".legend-item").forEach(item => {
            item.addEventListener("click", () => {
                const idx = parseInt(item.dataset.index);
                const meta = deptDetailChart.getDatasetMeta(0);
                meta.data[idx].hidden = !meta.data[idx].hidden;
                item.classList.toggle("hidden-legend");
                deptDetailChart.update();
            });
        });
    }
}
function renderGenreArtistDetail() {
    fetch("data/genre_map.json?v=" + Date.now()).then(r => r.json()).then(gm => {
        if (!rankingsData?.popular_artists) return;
        const genreArtists = {};
        for (const a of rankingsData.popular_artists) {
            const genre = gm[a.artist] || "その他";
            if (!genreArtists[genre]) genreArtists[genre] = [];
            genreArtists[genre].push(a);
        }
        const container = document.getElementById("genre-artist-list");
        if (!container) return;
        const GENRES = ["邦ロック", "J-POP", "ボカロ/アニソン", "洋楽", "テクニカル", "昭和/歌謡曲", "パンク/ヘビー", "その他"];
        container.innerHTML = GENRES.filter(g => genreArtists[g]).map(g => {
            const artists = genreArtists[g].slice(0, 15);
            const tags = artists.map(a =>
                `<span class="artist-tag clickable" onclick="showArtistDetail('${escapeAttr(a.artist)}')">${escapeHtml(a.artist)} <span class="count">(${a.song_count})</span></span>`
            ).join("");
            return `<div class="genre-detail-section">
                <div class="genre-detail-header" onclick="this.nextElementSibling.classList.toggle('hidden')">${escapeHtml(g)} (${genreArtists[g].length}組)</div>
                <div class="genre-detail-artists hidden">${tags}</div>
            </div>`;
        }).join("");
    }).catch(() => {});
}

// --- サイトログイン ---
async function handleSiteLogin() {
    const input = document.getElementById("password-input");
    const err = document.getElementById("login-error");
    const pw = input.value;
    if (!pw) return;
    try {
        const r = await fetch("api/login.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw })
        });
        const data = await r.json();
        if (data.ok) {
            document.getElementById("login-screen").classList.add("hidden");
            document.getElementById("app-content").classList.remove("hidden");
            loadData();
        } else {
            err.classList.remove("hidden");
        }
    } catch (e) {
        err.textContent = "サーバーに接続できません";
        err.classList.remove("hidden");
    }
}

// --- イベント ---
document.addEventListener("DOMContentLoaded", () => {
    // ログインボタン
    document.getElementById("login-btn").addEventListener("click", handleSiteLogin);
    document.getElementById("password-input").addEventListener("keydown", e => {
        if (e.key === "Enter") handleSiteLogin();
    });

    // セッション確認 → 認証済みなら直接データ表示
    fetch("api/data.php?file=rankings&_=" + Date.now()).then(r => {
        if (r.ok) {
            document.getElementById("login-screen").classList.add("hidden");
            document.getElementById("app-content").classList.remove("hidden");
            loadData();
        } else {
            document.getElementById("login-screen").classList.remove("hidden");
        }
    }).catch(() => {
        document.getElementById("login-screen").classList.remove("hidden");
    });

    // タブ切り替え（トップ＋ボトム両方）
    document.querySelectorAll(".tab, .btab").forEach(btn => {
        btn.addEventListener("click", () => {
            const tabName = btn.dataset.tab;
            syncTabActive(tabName);
            document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
            document.getElementById(tabName).classList.add("active");
            currentView = { type: "tab", tab: tabName };
            if (tabName === "news") renderBoardPosts();
            if (tabName === "overview") {
                const details = document.getElementById("stats-charts");
                if (details?.open) renderStatsCharts();
            }
        });
    });

    // グラフ: detailsが開いたときに描画
    const statsCharts = document.getElementById("stats-charts");
    if (statsCharts) {
        statsCharts.addEventListener("toggle", () => { if (statsCharts.open) renderStatsCharts(); });
    }

    // 掲示板文字数カウント
    const boardContent = document.getElementById("board-content");
    if (boardContent) {
        boardContent.addEventListener("input", () => {
            document.getElementById("board-char-count").textContent = `${boardContent.value.length}/500`;
        });
    }

    // ランキングサブタブ
    document.querySelectorAll(".ranking-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".ranking-tab").forEach(t => t.classList.remove("active"));
            btn.classList.add("active");
            renderRanking(btn.dataset.ranking);
            currentView = { type: "tab", tab: "rankings", rankingTab: btn.dataset.ranking };
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

    // 管理タブ初期化
    initAdminTab();
});

// =========================
// アカウント機能
// =========================

let accountUser = null;
let userFavorites = new Set();

async function refreshAccountState() {
    try {
        const res = await fetch("api/account.php?action=me");
        const data = await res.json();
        if (data.logged_in) {
            accountUser = data.user;
            document.getElementById("account-guest").classList.add("hidden");
            const li = document.getElementById("account-logged-in");
            if (li) li.classList.remove("hidden");
            document.getElementById("acc-name").textContent = data.user.real_name;
            const eml = document.getElementById("acc-email-display");
            if (eml) eml.textContent = data.user.email;
            const nmInput = document.getElementById("mp-name-input");
            if (nmInput) nmInput.value = data.user.real_name;
            // お気に入りを取得
            const fres = await fetch("api/favorite.php");
            const fdata = await fres.json();
            userFavorites = new Set((fdata.favorites || []).map(f => f.video_id));
        } else {
            accountUser = null;
            document.getElementById("account-guest").classList.remove("hidden");
            const li = document.getElementById("account-logged-in");
            if (li) li.classList.add("hidden");
            userFavorites = new Set();
        }
    } catch (e) {
        console.warn("account state fetch failed", e);
    }
}

// アカウントタブ切替（ログイン/登録）
document.addEventListener("click", e => {
    const t = e.target.closest(".acc-tab");
    if (!t) return;
    document.querySelectorAll(".acc-tab").forEach(b => b.classList.remove("active"));
    t.classList.add("active");
    const mode = t.dataset.acc;
    document.getElementById("acc-login-form").classList.toggle("hidden", mode !== "login");
    document.getElementById("acc-register-form").classList.toggle("hidden", mode !== "register");
    document.getElementById("acc-verify-form").classList.add("hidden");
});

async function accountRegister() {
    const email = document.getElementById("acc-reg-email").value.trim();
    const real_name = document.getElementById("acc-reg-name").value.trim();
    const password = document.getElementById("acc-reg-password").value;
    const errEl = document.getElementById("acc-reg-error");
    errEl.classList.add("hidden");
    if (!document.getElementById("acc-consent-check").checked) {
        errEl.textContent = "利用規約とプライバシーポリシーに同意してください";
        errEl.classList.remove("hidden");
        return;
    }
    try {
        const res = await fetch("api/account.php?action=register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, real_name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "失敗");
        // 認証コード入力へ
        document.getElementById("acc-register-form").classList.add("hidden");
        document.getElementById("acc-login-form").classList.add("hidden");
        document.getElementById("acc-verify-form").classList.remove("hidden");
        document.getElementById("acc-verify-form").dataset.email = email;
        alert(data.message);
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
    }
}

async function accountVerify() {
    const email = document.getElementById("acc-verify-form").dataset.email;
    const code = document.getElementById("acc-verify-code").value.trim();
    const errEl = document.getElementById("acc-verify-error");
    errEl.classList.add("hidden");
    try {
        const res = await fetch("api/account.php?action=verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "失敗");
        alert("認証完了！ログインしました");
        await refreshAccountState();
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
    }
}

async function accountResend() {
    const email = document.getElementById("acc-verify-form").dataset.email;
    const errEl = document.getElementById("acc-verify-error");
    errEl.classList.add("hidden");
    try {
        const res = await fetch("api/account.php?action=resend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "失敗");
        alert(data.message);
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
    }
}

async function accountLogin() {
    const email = document.getElementById("acc-login-email").value.trim();
    const password = document.getElementById("acc-login-password").value;
    const errEl = document.getElementById("acc-login-error");
    errEl.classList.add("hidden");
    try {
        const res = await fetch("api/account.php?action=login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
            if (data.need_verify) {
                document.getElementById("acc-login-form").classList.add("hidden");
                document.getElementById("acc-verify-form").classList.remove("hidden");
                document.getElementById("acc-verify-form").dataset.email = email;
                alert("メール認証が未完了です。コードを入力してください");
                return;
            }
            throw new Error(data.error || "ログイン失敗");
        }
        await refreshAccountState();
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.remove("hidden");
    }
}

async function accountLogout() {
    await fetch("api/account.php?action=logout", { method: "POST" });
    await refreshAccountState();
}

// =========================
// 投票・お気に入り・コメント
// =========================

// イベントグループ名（日目除去）
function normalizeEventGroup(eventName) {
    return (eventName || "").replace(/\s*[\(（]?[1-9一二三四]\s*日目[\)）]?/u, "").trim();
}

async function toggleFavorite(videoId, btn) {
    if (!accountUser) {
        alert("お気に入りはアカウントログイン後に利用できます");
        switchTab("news");
        return;
    }
    try {
        const res = await fetch("api/favorite.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.state === "added") {
            userFavorites.add(videoId);
            if (btn) btn.classList.add("active");
        } else {
            userFavorites.delete(videoId);
            if (btn) btn.classList.remove("active");
        }
    } catch (e) {
        alert("失敗: " + e.message);
    }
}

async function castVote(videoId, eventGroup) {
    if (!accountUser) {
        alert("投票はアカウントログイン後に利用できます");
        switchTab("news");
        return;
    }
    if (!confirm("この動画に投票します。投票は変更できません。よろしいですか？")) return;
    try {
        const res = await fetch("api/vote.php?action=vote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId, event_group: eventGroup }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(`投票完了！残り ${data.remaining} 票`);
        // 再描画
        if (typeof showVideoDetail === "function") showVideoDetail(videoId);
    } catch (e) {
        alert("投票失敗: " + e.message);
    }
}

async function submitComment(videoId) {
    if (!accountUser) {
        alert("コメントはアカウントログイン後に利用できます");
        switchTab("news");
        return;
    }
    const ta = document.getElementById("vid-comment-input");
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) return;
    try {
        const res = await fetch("api/comment.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId, content }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        ta.value = "";
        loadComments(videoId);
    } catch (e) {
        alert("失敗: " + e.message);
    }
}

async function loadComments(videoId) {
    try {
        const res = await fetch("api/comment.php?video_id=" + encodeURIComponent(videoId));
        const data = await res.json();
        const el = document.getElementById("vid-comment-list");
        if (!el) return;
        if (!data.comments || !data.comments.length) {
            el.innerHTML = '<p class="placeholder" style="padding:1rem">まだコメントはありません</p>';
            return;
        }
        el.innerHTML = data.comments.map(c =>
            `<div class="comment-item">
                <div class="comment-meta"><strong>${escapeHtml(c.author)}</strong> <span class="comment-date">${escapeHtml(c.created_at)}</span></div>
                <div class="comment-content">${escapeHtml(c.content)}</div>
            </div>`
        ).join("");
    } catch (e) {
        console.warn("comments load failed", e);
    }
}

function switchTab(tabId) {
    document.querySelectorAll(".tab, .btab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(b => b.classList.add("active"));
    document.getElementById(tabId)?.classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

// お気に入り一覧表示
function showFavoritesPage() {
    if (!accountUser) return;
    if (!videosData) return;
    const favIds = Array.from(userFavorites);
    const favs = videosData.videos.filter(v => favIds.includes(v.video_id));
    const container = document.getElementById("search-result");
    if (!container) return;
    container.innerHTML = `
        <h3 class="section-title">お気に入り (${favs.length})</h3>
        ${favs.length === 0 ? '<p class="placeholder">お気に入りはまだありません</p>' :
            favs.map(v => {
                const vidId = v.video_id;
                const thumb = `<img src="https://img.youtube.com/vi/${vidId}/mqdefault.jpg" class="event-card-thumb">`;
                return `<div class="band-card">
                    <a href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${thumb}</a>
                    <div class="member-name clickable" onclick="showVideoDetail('${escapeAttr(vidId)}')">${escapeHtml(v.band_name || v.title)}</div>
                    <div style="font-size:0.75rem;color:var(--text-muted)">${v.event_name || ""} ／ ${v.date || ""}</div>
                </div>`;
            }).join("")
        }
    `;
    switchTab("search-result");
}

// 動画コメントのトグル表示
async function toggleVideoComments(videoId, btn) {
    const sec = document.getElementById("cs-" + videoId);
    if (!sec) return;
    if (!sec.classList.contains("hidden")) {
        sec.classList.add("hidden");
        return;
    }
    sec.classList.remove("hidden");
    sec.innerHTML = `
        <div class="comment-form">
            ${accountUser ? `
                <textarea id="vid-comment-input-${videoId}" placeholder="コメントを入力（500文字まで）" maxlength="500"></textarea>
                <button onclick="submitVideoComment('${escapeAttr(videoId)}')">投稿</button>
            ` : `<p class="acc-hint">アカウントログイン後に投稿できます</p>`}
        </div>
        <div id="vid-comment-list-${videoId}" class="comment-list"></div>
    `;
    await reloadVideoComments(videoId);
}

async function reloadVideoComments(videoId) {
    try {
        const res = await fetch("api/comment.php?video_id=" + encodeURIComponent(videoId));
        const data = await res.json();
        const el = document.getElementById("vid-comment-list-" + videoId);
        if (!el) return;
        if (!data.comments || !data.comments.length) {
            el.innerHTML = '<p class="placeholder" style="padding:0.6rem">まだコメントはありません</p>';
            return;
        }
        el.innerHTML = data.comments.map(c => {
            const isMine = accountUser && Number(c.user_id) === Number(accountUser.id);
            const deleteBtn = isMine
                ? `<button class="comment-delete-btn" onclick="deleteComment(${c.id}, '${escapeAttr(videoId)}')">削除</button>`
                : "";
            return `<div class="comment-item">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(c.author)}</span>
                    <span class="comment-date">${escapeHtml(c.created_at)}</span>
                    ${deleteBtn}
                </div>
                <div class="comment-content">${escapeHtml(c.content)}</div>
            </div>`;
        }).join("");
    } catch (e) { console.warn("comments load failed", e); }
}

async function deleteComment(commentId, videoId) {
    if (!confirm("このコメントを削除しますか？")) return;
    try {
        const res = await fetch("api/comment.php?id=" + commentId, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        reloadVideoComments(videoId);
    } catch (e) {
        alert("削除失敗: " + e.message);
    }
}

async function submitVideoComment(videoId) {
    const ta = document.getElementById("vid-comment-input-" + videoId);
    if (!ta) return;
    const content = ta.value.trim();
    if (!content) return;
    try {
        const res = await fetch("api/comment.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: videoId, content }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        ta.value = "";
        reloadVideoComments(videoId);
    } catch (e) {
        alert("失敗: " + e.message);
    }
}

// === マイページ・パスワードリセット ===
function showAccForm(mode) {
    document.querySelectorAll(".acc-form").forEach(f => f.classList.add("hidden"));
    const targetId = {
        login: "acc-login-form",
        register: "acc-register-form",
        verify: "acc-verify-form",
        forgot: "acc-forgot-form",
        reset: "acc-reset-form",
    }[mode];
    if (targetId) document.getElementById(targetId).classList.remove("hidden");
    document.querySelectorAll(".acc-tab").forEach(b => b.classList.remove("active"));
    if (mode === "login" || mode === "forgot") document.querySelector('[data-acc="login"]')?.classList.add("active");
    if (mode === "register") document.querySelector('[data-acc="register"]')?.classList.add("active");
}

function toggleMypageSection(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden");
}

async function updateProfileName() {
    const real_name = document.getElementById("mp-name-input").value.trim();
    const msg = document.getElementById("mp-name-msg");
    msg.textContent = "";
    try {
        const res = await fetch("api/account.php?action=update_profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ real_name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = "✓ 更新しました";
        await refreshAccountState();
    } catch (e) {
        msg.textContent = "失敗: " + e.message;
    }
}

async function changePassword() {
    const current = document.getElementById("mp-curpw").value;
    const next = document.getElementById("mp-newpw").value;
    const msg = document.getElementById("mp-pw-msg");
    msg.textContent = "";
    try {
        const res = await fetch("api/account.php?action=change_password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ current_password: current, new_password: next }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        msg.textContent = "✓ パスワードを変更しました";
        document.getElementById("mp-curpw").value = "";
        document.getElementById("mp-newpw").value = "";
    } catch (e) {
        msg.textContent = "失敗: " + e.message;
    }
}

async function deleteAccount() {
    if (!confirm("本当にアカウントを削除しますか？投票・コメント・お気に入りも完全削除され、元に戻せません。")) return;
    const password = document.getElementById("mp-delete-pw").value;
    const msg = document.getElementById("mp-delete-msg");
    msg.textContent = "";
    try {
        const res = await fetch("api/account.php?action=delete_account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(data.message || "削除しました");
        await refreshAccountState();
    } catch (e) {
        msg.textContent = "失敗: " + e.message;
    }
}

async function accountForgotPassword() {
    const email = document.getElementById("acc-forgot-email").value.trim();
    const err = document.getElementById("acc-forgot-error");
    err.classList.add("hidden");
    try {
        const res = await fetch("api/account.php?action=forgot_password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(data.message);
        showAccForm("reset");
        document.getElementById("acc-reset-form").dataset.email = email;
    } catch (e) {
        err.textContent = e.message;
        err.classList.remove("hidden");
    }
}

async function accountResetPassword() {
    const email = document.getElementById("acc-reset-form").dataset.email;
    const code = document.getElementById("acc-reset-code").value.trim();
    const new_password = document.getElementById("acc-reset-newpw").value;
    const err = document.getElementById("acc-reset-error");
    err.classList.add("hidden");
    try {
        const res = await fetch("api/account.php?action=reset_password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code, new_password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        alert(data.message);
        showAccForm("login");
    } catch (e) {
        err.textContent = e.message;
        err.classList.remove("hidden");
    }
}
