<?php
require_once __DIR__ . '/config.php';
initSecureSession();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');

if (!isAuthenticated()) {
    http_response_code(403);
    echo json_encode(['error' => '認証が必要です']);
    exit;
}

// 許可するファイル名のホワイトリスト（パストラバーサル防止）
$allowed = ['members', 'rankings', 'videos', 'department_map', 'genre_map', 'meta'];
$file = $_GET['file'] ?? '';

if (!in_array($file, $allowed, true)) {
    http_response_code(400);
    echo json_encode(['error' => '不正なファイル名']);
    exit;
}

$path = __DIR__ . '/../data/' . $file . '.json';
if (!file_exists($path)) {
    http_response_code(404);
    echo json_encode(['error' => 'ファイルが見つかりません']);
    exit;
}

readfile($path);
