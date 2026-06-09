<?php
/**
 * SQLite DB接続ヘルパー
 */

// エラーはログに出してJSONレスポンスを壊さない
ini_set('display_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

require_once __DIR__ . '/config.php';

define('DB_PATH', __DIR__ . '/account_data.sqlite');
define('SCHEMA_SQLITE', __DIR__ . '/schema.sql');
define('SCHEMA_MYSQL', __DIR__ . '/schema_mysql.sql');
define('ALLOWED_EMAIL_DOMAIN', '@ed.tus.ac.jp');

/**
 * DB接続を取得（初回は自動的にスキーマ作成）
 * DB_TYPE 設定により mysql / sqlite を切り替え
 */
function getDB(): PDO {
    if (DB_TYPE === 'mysql') {
        return _getMySQL();
    }
    return _getSQLite();
}

function _getMySQL(): PDO {
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4, time_zone='+09:00'",
    ]);
    // 初回マイグレーション（テーブルが無ければ作成）
    $exists = $pdo->query("SHOW TABLES LIKE 'users'")->fetch();
    if (!$exists && file_exists(SCHEMA_MYSQL)) {
        $sql = file_get_contents(SCHEMA_MYSQL);
        // 複数ステートメントを順に実行
        foreach (array_filter(array_map('trim', explode(';', $sql))) as $stmt) {
            if ($stmt) $pdo->exec($stmt);
        }
    }
    return $pdo;
}

function _getSQLite(): PDO {
    $is_new = !file_exists(DB_PATH);
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');

    if ($is_new && file_exists(SCHEMA_SQLITE)) {
        $schema = file_get_contents(SCHEMA_SQLITE);
        $pdo->exec($schema);
        @chmod(DB_PATH, 0660);
    }

    // SQLite既存DBへのマイグレーション
    $pdo->exec("CREATE TABLE IF NOT EXISTS password_resets (
        email TEXT NOT NULL, code TEXT NOT NULL, expires_at TEXT NOT NULL,
        used INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now', 'localtime')),
        PRIMARY KEY (email, code)
    )");

    return $pdo;
}

/**
 * 現在ログイン中のユーザーIDを取得（未ログインならnull）
 */
function getCurrentUserId(): ?int {
    initSecureSession();
    return $_SESSION['account_user_id'] ?? null;
}

/**
 * 現在ログイン中のユーザー情報を取得
 */
function getCurrentUser(): ?array {
    $uid = getCurrentUserId();
    if (!$uid) return null;
    $pdo = getDB();
    $stmt = $pdo->prepare('SELECT id, email, real_name, email_verified, created_at FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    return $stmt->fetch() ?: null;
}

/**
 * メールアドレスの形式とドメインを検証
 */
function isValidEmail(string $email): bool {
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return false;
    return str_ends_with(strtolower($email), ALLOWED_EMAIL_DOMAIN);
}

/**
 * 6桁の認証コード生成
 */
function generateVerificationCode(): string {
    return str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
}

/**
 * 認証コードをメール送信（mail()関数使用）
 * TEST_MODE ではメール送信をスキップして true を返す
 */
function sendVerificationCode(string $email, string $code): bool {
    if (defined('TEST_MODE') && TEST_MODE) {
        // ローカルテスト: ログに記録して送信成功扱い
        error_log("[TEST_MODE] verification code for $email: $code");
        return true;
    }
    $from = defined('MAIL_FROM') ? MAIL_FROM : 'noreply@example.com';
    $subject = '=?UTF-8?B?' . base64_encode('CrossOverデータベース 認証コード') . '?=';
    $body = "認証コード: $code\n\n10分以内に入力してください。\n\n心当たりがない場合は無視してください。";
    $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    return @mail($email, $subject, $body, $headers);
}

/**
 * JSONレスポンス送信
 */
function jsonResponse(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * サイト認証チェック（既存のisAuthenticated）
 */
function requireSiteAuth(): void {
    initSecureSession();
    if (!isAuthenticated()) {
        jsonResponse(['error' => 'サイト認証が必要です'], 401);
    }
}

/**
 * アカウント認証チェック
 */
function requireAccount(): array {
    requireSiteAuth();
    $user = getCurrentUser();
    if (!$user) {
        jsonResponse(['error' => 'アカウントログインが必要です'], 401);
    }
    return $user;
}
