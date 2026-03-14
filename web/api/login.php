<?php
require_once __DIR__ . '/config.php';
initSecureSession();

header('Content-Type: application/json; charset=utf-8');

// OPTIONSプリフライト
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$password = $input['password'] ?? '';
$type = $input['type'] ?? 'site';

// 管理者セッションチェック（パスワード不要）
if ($type === 'admin_check') {
    if (isAdminAuthenticated()) {
        echo json_encode(['ok' => true, 'type' => 'admin']);
    } else {
        http_response_code(401);
        echo json_encode(['error' => '管理者認証が必要です']);
    }
    exit;
}

// 管理者ログイン
if ($type === 'admin') {
    if (!isAuthenticated()) {
        http_response_code(403);
        echo json_encode(['error' => 'サイト認証が必要です']);
        exit;
    }
    if (password_verify($password, ADMIN_PASSWORD_HASH)) {
        $_SESSION['admin_authenticated'] = true;
        echo json_encode(['ok' => true, 'type' => 'admin']);
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'パスワードが違います']);
    }
    exit;
}

// サイトログイン
if (password_verify($password, SITE_PASSWORD_HASH)) {
    $_SESSION['authenticated'] = true;
    echo json_encode(['ok' => true]);
} else {
    http_response_code(401);
    echo json_encode(['error' => 'パスワードが違います']);
}
