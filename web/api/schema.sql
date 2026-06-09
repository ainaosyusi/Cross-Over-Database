-- ユーザーアカウント機能用 SQLite スキーマ

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    real_name TEXT NOT NULL,
    email_verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- メール認証コード
CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (email, code)
);

-- 投票: 1ユーザー1動画に1票まで
CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id TEXT NOT NULL,
    event_group TEXT NOT NULL,
    voted_at TEXT DEFAULT (datetime('now', 'localtime')),
    UNIQUE(user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_votes_video ON votes(video_id);
CREATE INDEX IF NOT EXISTS idx_votes_event ON votes(event_group);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);

-- コメント
CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    video_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);

-- お気に入り
CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL,
    video_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (user_id, video_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id);

-- イベント公開日（投票期限計算用、初回参照時に記録）
CREATE TABLE IF NOT EXISTS event_published (
    event_group TEXT PRIMARY KEY,
    published_at TEXT NOT NULL,
    vote_closes_at TEXT NOT NULL
);

-- パスワードリセットコード
CREATE TABLE IF NOT EXISTS password_resets (
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now', 'localtime')),
    PRIMARY KEY (email, code)
);
