"use strict";

// ============================================================
// --- 管理機能（index.html 内組み込み） ---
// ============================================================

const API_KEY_STORAGE = "keion_youtube_api_key";

let adminVideoData = null;
let adminSongs = [];
let adminMembers = [];

async function checkAdminAuth() {
    try {
        const res = await fetch("api/login.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "admin_check" }),
        });
        return res.ok;
    } catch { return false; }
}

async function handleAdminLogin() {
    const input = document.getElementById("admin-password");
    const error = document.getElementById("admin-login-error");
    const pw = input.value.trim();
    if (!pw) return;
    try {
        const res = await fetch("api/login.php", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw, type: "admin" }),
        });
        if (res.ok) {
            error.classList.add("hidden");
            showAdminPanel();
        } else {
            const data = await res.json().catch(() => ({}));
            error.textContent = data.error || "パスワードが違います";
            error.classList.remove("hidden");
            input.value = "";
            input.focus();
        }
    } catch (e) {
        error.textContent = "通信エラーが発生しました";
        error.classList.remove("hidden");
    }
}

function showAdminPanel() {
    document.getElementById("admin-login-gate").classList.add("hidden");
    document.getElementById("admin-panel").classList.remove("hidden");
    const key = localStorage.getItem(API_KEY_STORAGE);
    if (key) document.getElementById("admin-api-key").value = key;
}

function adminExtractVideoId(url) {
    const m = url.match(/(?:v=|youtu\.be\/)([\w-]+)/);
    return m ? m[1] : null;
}

async function adminFetchVideo() {
    const url = document.getElementById("admin-video-url").value.trim();
    const status = document.getElementById("admin-fetch-status");
    if (!url) return;
    const vid = adminExtractVideoId(url);
    if (!vid) { status.textContent = "有効なYouTube URLを入力してください"; status.className = "admin-status error"; status.classList.remove("hidden"); return; }
    const apiKey = localStorage.getItem(API_KEY_STORAGE);
    if (!apiKey) { status.textContent = "APIキーが未設定です。下の「YouTube API設定」で設定してください"; status.className = "admin-status error"; status.classList.remove("hidden"); return; }
    status.textContent = "取得中..."; status.className = "admin-status loading"; status.classList.remove("hidden");
    document.getElementById("admin-fetch-btn").disabled = true;
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${vid}&key=${apiKey}`);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `HTTP ${res.status}`); }
        const data = await res.json();
        if (!data.items?.length) throw new Error("動画が見つかりません");
        const item = data.items[0];
        const sn = item.snippet, st = item.statistics || {};
        const ud = (sn.publishedAt || "").slice(0, 10).replace(/-/g, "");
        adminVideoData = { video_id: vid, title: sn.title, description: sn.description || "", upload_date: ud, view_count: parseInt(st.viewCount || "0") };
        document.getElementById("admin-title").textContent = sn.title;
        document.getElementById("admin-vid").textContent = vid;
        document.getElementById("admin-date").textContent = ud ? `${ud.slice(0,4)}/${ud.slice(4,6)}/${ud.slice(6)}` : "-";
        document.getElementById("admin-views").textContent = adminVideoData.view_count.toLocaleString() + "回";
        document.getElementById("admin-desc-box").textContent = sn.description || "(概要欄なし)";
        const parsed = adminParseDescription(sn.description || "");
        adminSongs = parsed.songs; adminMembers = parsed.members;
        adminRenderSongs(); adminRenderMembers();
        const badge = document.getElementById("admin-parse-badge");
        if (parsed.warnings.length === 0) { badge.textContent = "OK"; badge.className = "admin-badge ok"; }
        else { badge.textContent = `警告 ${parsed.warnings.length}件`; badge.className = "admin-badge warn"; }
        if (parsed.warnings.length > 0) {
            document.getElementById("admin-warnings").classList.remove("hidden");
            document.getElementById("admin-warnings-list").innerHTML = parsed.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("");
        } else { document.getElementById("admin-warnings").classList.add("hidden"); }
        document.getElementById("admin-result").classList.remove("hidden");
        status.textContent = "取得完了"; status.className = "admin-status success";
    } catch (e) {
        status.textContent = e.message; status.className = "admin-status error";
        document.getElementById("admin-result").classList.add("hidden");
    } finally { document.getElementById("admin-fetch-btn").disabled = false; }
}

// --- 概要欄パーサー（JS版） ---
const SONG_RE = /^[0-9]{1,2}\s*[.．、,，)）]\s*(.+?)(?:\s*[/／]\s*|\s*[(（]\s*)(.+?)[)）]?\s*$/;
const MEMBER_RE = /^([BMDbmd]?\d)\s*年\s*[.．]?\s*生?\s*(?:[BMDbmd]?\d\s*年\s*[.．]?\s*)?((?:[A-Za-z]+\.?\/?)*\s*\S.*?)\s*$/;
const KNOWN_PARTS = new Set(["vo","gt","ba","dr","key","cho","sax","syn","pf","vn","tp","tb","fl","per","drms","perc","mand","drs","rap","dj"]);
const PART_MAP = {vo:"Vo.",gt:"Gt.",ba:"Ba.",dr:"Dr.",key:"Key.",cho:"Cho.",sax:"Sax.",syn:"Syn.",pf:"Pf.",vn:"Vn.",tp:"Tp.",tb:"Tb.",fl:"Fl.",per:"Per.",perc:"Perc.",drms:"Drms.",drs:"Drs.",rap:"Rap",dj:"DJ.",mand:"Mand.",a:"A.",c:"C.",w:"W."};
const PART_PFX = new Set(["a","c","w","sh"]);

function adminNormPart(p) {
    if (!p) return p;
    const toks = p.split(/[./\s]+/).filter(Boolean).map(t => PART_MAP[t.toLowerCase()] || (t.charAt(0).toUpperCase()+t.slice(1)+(t.endsWith(".")?""  :".")));
    const r = []; let i = 0;
    while (i < toks.length) { const b = toks[i].replace(/\.$/,"").toLowerCase(); if (PART_PFX.has(b) && i+1<toks.length) { r.push(toks[i]+toks[i+1]); i+=2; } else { r.push(toks[i]); i++; } }
    return r.join("/");
}
function adminCleanName(n) { return n.replace(/\s*[(\uFF08].*$/,"").replace(/\d+$/,"").replace(/^[\s.．]+/,"").trim(); }
function adminIsValidName(n) { if (!n || /^[\s/／.]+$/.test(n)) return false; const t = n.split(/[./\s]+/).filter(Boolean); return !(t.length>0 && t.every(x=>KNOWN_PARTS.has(x.toLowerCase()))); }
function adminExtractPart(raw) {
    let s = raw.trim().replace(/\((?![A-Za-z]+\.?\s*\))[^)]*\)?\s*$/,"").replace(/（[^）]*）?\s*$/,"").replace(/[(\uFF08)\uFF09]/g,"");
    const parts = [];
    while (s) { s = s.replace(/^[\s/／,]+/,""); const m = s.match(/^([A-Za-z]+'?[A-Za-z]*\.?)\s*/); if (m && m[1]!==s) { parts.push(m[1]); s=s.slice(m[0].length); } else break; }
    return { part: parts.join("/"), name: adminCleanName(s.trim()) };
}
function adminParseMemberName(raw) { raw=raw.trim(); if (/^[A-Za-z/]/.test(raw)) { const r=adminExtractPart(raw); if (r.name) return r; } return {part:"",name:adminCleanName(raw)}; }

function adminParseDescription(desc) {
    const text = desc.normalize("NFKC");
    const lines = text.split("\n").map(l => l.trim());
    const songs = [], members = [], warnings = [];
    for (const line of lines) {
        if (!line || /^[\s\-ー=_─━]+$/.test(line) || /^(セットリスト非公開|インタールード|MC|※|＊|頭切れ)/.test(line)) continue;
        if (/^バンド名[:：]/.test(line) || /^\d+回視聴/.test(line)) continue;
        const sm = line.match(SONG_RE);
        if (sm) { songs.push({title:sm[1].trim(),artist:sm[2].trim()}); continue; }
        const mm = line.match(MEMBER_RE);
        if (mm) {
            const grade=mm[1]; let rn=mm[2].trim().replace(/^非公開\s+/,"");
            const {part,name}=adminParseMemberName(rn); const np=adminNormPart(part);
            const names = name.includes(" / ") ? name.split(/\s*\/\s*/) : [name];
            for (const n of names) { const c=n.trim(); if (adminIsValidName(c)) members.push({grade,part:np,name:c}); }
            continue;
        }
        if (/^[A-Za-z]/.test(line)) { const {part,name}=adminExtractPart(line); if (part&&adminIsValidName(name)&&name&&!/^\d/.test(name)&&/[^\x00-\x7F]/.test(name)) { members.push({grade:"?",part:adminNormPart(part),name}); continue; } }
        if (line.length > 1) warnings.push(line);
    }
    return {songs,members,warnings};
}

// --- 管理UI描画 ---
function adminRenderSongs() {
    const body = document.getElementById("admin-songs-body");
    body.innerHTML = adminSongs.map((s,i) => `<tr><td>${i+1}</td><td><input value="${escapeAttr(s.title)}" data-f="title" data-i="${i}"></td><td><input value="${escapeAttr(s.artist)}" data-f="artist" data-i="${i}"></td><td><button class="admin-btn-remove" onclick="adminSongs.splice(${i},1);adminRenderSongs()">×</button></td></tr>`).join("");
    document.getElementById("admin-song-count").textContent = adminSongs.length;
}
function adminRenderMembers() {
    const body = document.getElementById("admin-members-body");
    body.innerHTML = adminMembers.map((m,i) => `<tr><td><input value="${escapeAttr(m.grade)}" data-f="grade" data-i="${i}" style="width:36px;text-align:center"></td><td><input value="${escapeAttr(m.part)}" data-f="part" data-i="${i}"></td><td><input value="${escapeAttr(m.name)}" data-f="name" data-i="${i}"></td><td><button class="admin-btn-remove" onclick="adminMembers.splice(${i},1);adminRenderMembers()">×</button></td></tr>`).join("");
    document.getElementById("admin-member-count").textContent = adminMembers.length;
}

function adminSyncData() {
    document.querySelectorAll("#admin-songs-body input").forEach(el => { const i=+el.dataset.i, f=el.dataset.f; if (adminSongs[i]) adminSongs[i][f]=el.value.trim(); });
    document.querySelectorAll("#admin-members-body input").forEach(el => { const i=+el.dataset.i, f=el.dataset.f; if (adminMembers[i]) adminMembers[i][f]=el.value.trim(); });
}

function adminExportJson() {
    adminSyncData();
    if (!adminVideoData) return;
    const entry = { video_id: adminVideoData.video_id };
    const songs = adminSongs.filter(s => s.title || s.artist);
    if (songs.length) entry.songs = songs.map(s => ({title:s.title,artist:s.artist}));
    const members = adminMembers.filter(m => m.name);
    if (members.length) entry.members = members.map(m => ({grade:m.grade,name:m.name,...(m.part?{part:m.part}:{})}));
    const json = JSON.stringify(entry, null, 2);
    document.getElementById("admin-export-output").textContent = json;
    document.getElementById("admin-export-output").classList.remove("hidden");
    document.getElementById("admin-copy-btn").classList.remove("hidden");
}

function adminCopyJson() {
    const text = document.getElementById("admin-export-output").textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("admin-copy-btn");
        btn.textContent = "コピーしました"; setTimeout(() => { btn.textContent = "コピー"; }, 2000);
    });
}

function adminSaveKey() {
    const key = document.getElementById("admin-api-key").value.trim();
    const st = document.getElementById("admin-key-status");
    if (key) { localStorage.setItem(API_KEY_STORAGE, key); st.textContent = "保存しました"; st.className = "admin-status success"; }
    else { localStorage.removeItem(API_KEY_STORAGE); st.textContent = "削除しました"; st.className = "admin-status"; }
}

async function adminTestKey() {
    const key = document.getElementById("admin-api-key").value.trim();
    const st = document.getElementById("admin-key-status");
    if (!key) { st.textContent = "APIキーを入力してください"; st.className = "admin-status error"; return; }
    st.textContent = "テスト中..."; st.className = "admin-status loading";
    try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${key}`);
        if (res.ok) { st.textContent = "接続成功"; st.className = "admin-status success"; }
        else { const e = await res.json().catch(()=>({})); st.textContent = `エラー: ${e?.error?.message||res.status}`; st.className = "admin-status error"; }
    } catch (e) { st.textContent = `接続エラー: ${e.message}`; st.className = "admin-status error"; }
}

async function initAdminTab() {
    if (await checkAdminAuth()) showAdminPanel();
    document.getElementById("admin-login-btn")?.addEventListener("click", handleAdminLogin);
    document.getElementById("admin-password")?.addEventListener("keydown", e => { if (e.key === "Enter") handleAdminLogin(); });
    document.getElementById("admin-fetch-btn")?.addEventListener("click", adminFetchVideo);
    document.getElementById("admin-video-url")?.addEventListener("keydown", e => { if (e.key === "Enter") adminFetchVideo(); });
    document.getElementById("admin-add-song")?.addEventListener("click", () => { adminSongs.push({title:"",artist:""}); adminRenderSongs(); });
    document.getElementById("admin-add-member")?.addEventListener("click", () => { adminMembers.push({grade:"",part:"",name:""}); adminRenderMembers(); });
    document.getElementById("admin-export-btn")?.addEventListener("click", adminExportJson);
    document.getElementById("admin-copy-btn")?.addEventListener("click", adminCopyJson);
    document.getElementById("admin-save-key")?.addEventListener("click", adminSaveKey);
    document.getElementById("admin-test-key")?.addEventListener("click", adminTestKey);
}
