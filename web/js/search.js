"use strict";

// --- もしかして（類似検索） ---
function similarityScore(query, target) {
    const q = query.toLowerCase(), t = target.toLowerCase();
    let score = 0;
    if (t.includes(q) || q.includes(t)) score += 10;
    for (const ch of q) { if (t.includes(ch)) score += 2; }
    if (t[0] === q[0]) score += 3;
    score -= Math.abs(target.length - query.length) * 0.5;
    if (q.length <= 8 && t.length <= 12) {
        const d = editDistance(q, t);
        if (d <= 2) score += (8 - d * 3);
    }
    return score;
}

function findSimilarItems(query, limit = 8) {
    const results = [];
    // メンバー
    if (membersData) {
        for (const name of Object.keys(membersData.members)) {
            const s = similarityScore(query, name);
            if (s > 2) results.push({ label: name, type: "member", score: s, onclick: `searchMember('${escapeAttr(name)}')` });
        }
    }
    // 曲名・アーティスト
    if (songIndex) {
        const seen = new Set();
        for (const s of songIndex) {
            // 曲名
            const key = s.title + "||" + s.artist;
            if (!seen.has(key)) {
                seen.add(key);
                const sc = similarityScore(query, s.title);
                if (sc > 2) results.push({ label: `${s.title} / ${s.artist}`, type: "song", score: sc, onclick: `showSongDetail('${escapeAttr(s.title)}', '${escapeAttr(s.artist)}')` });
            }
            // アーティスト
            if (!seen.has("art:" + s.artist)) {
                seen.add("art:" + s.artist);
                const sc = similarityScore(query, s.artist);
                if (sc > 2) results.push({ label: s.artist, type: "artist", score: sc, onclick: `showArtistDetail('${escapeAttr(s.artist)}')` });
            }
        }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// 後方互換
function findSimilarMembers(query, limit) { return findSimilarItems(query, limit).filter(i => i.type === "member").map(i => i.label); }

function editDistance(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] !== b[j-1] ? 1 : 0));
    return dp[m][n];
}

// --- サジェスト ---
function showSuggestions(query) {
    const ul = document.getElementById("suggestions");
    if (!membersData || !query) { hideSuggestions(); return; }

    const names = Object.keys(membersData.members).filter(n => n.includes(query)).slice(0, 5);
    const songItems = (songIndex && query.length >= 2)
        ? songIndex.filter(s => s.title.includes(query) || s.artist.includes(query)).slice(0, 4)
        : [];

    if (names.length === 0 && songItems.length === 0) { hideSuggestions(); return; }

    ul.innerHTML = [
        ...names.map(n => `<li onclick="searchMember('${escapeHtml(n)}')">${escapeHtml(n)} <span style="color:#aaa;font-size:0.75rem">メンバー</span></li>`),
        ...songItems.map(s => `<li onclick="showSongDetail('${escapeAttr(s.title)}', '${escapeAttr(s.artist)}')">${escapeHtml(s.title)} <span style="color:#aaa;font-size:0.75rem">/ ${escapeHtml(s.artist)}</span></li>`),
    ].join("");
    ul.classList.remove("hidden");
}

function hideSuggestions() {
    document.getElementById("suggestions").classList.add("hidden");
}
