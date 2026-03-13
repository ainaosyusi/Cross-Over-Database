<?php
/**
 * 掲示板API - JSONファイルベースの簡易バックエンド
 *
 * GET  /api/board.php          → 全投稿取得
 * POST /api/board.php          → 新規投稿 {name, content}
 * DELETE /api/board.php?id=xxx → 投稿削除（管理者用）
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// プリフライト対応
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// データファイル（web/api/ の隣にdata/を置かず、api/内に保存）
$dataFile = __DIR__ . '/board_data.json';

// 初回アクセス時にデータファイルを自動生成
if (!file_exists($dataFile)) {
    file_put_contents($dataFile, '[]');
}

// 投稿データ読み込み
function loadPosts() {
    global $dataFile;
    $json = file_get_contents($dataFile);
    $posts = json_decode($json, true);
    return is_array($posts) ? $posts : [];
}

// 投稿データ保存
function savePosts($posts) {
    global $dataFile;
    file_put_contents($dataFile, json_encode($posts, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

// --- GET: 全投稿取得 ---
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(loadPosts(), JSON_UNESCAPED_UNICODE);
    exit;
}

// --- POST: 新規投稿 ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);

    $name = isset($input['name']) ? trim($input['name']) : '';
    $content = isset($input['content']) ? trim($input['content']) : '';

    // バリデーション
    if ($name === '') {
        http_response_code(400);
        echo json_encode(['error' => 'ニックネームは必須です']);
        exit;
    }
    if (mb_strlen($name) > 20) {
        http_response_code(400);
        echo json_encode(['error' => 'ニックネームは20文字以内']);
        exit;
    }
    if (mb_strlen($content) < 10) {
        http_response_code(400);
        echo json_encode(['error' => '内容は10文字以上']);
        exit;
    }
    if (mb_strlen($content) > 500) {
        http_response_code(400);
        echo json_encode(['error' => '内容は500文字以内']);
        exit;
    }

    // HTMLタグ除去
    $name = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
    $content = htmlspecialchars($content, ENT_QUOTES, 'UTF-8');

    $posts = loadPosts();

    // レート制限: 同一IPから30秒以内の連続投稿を防止
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    $now = time();
    foreach (array_reverse($posts) as $p) {
        if (isset($p['ip']) && $p['ip'] === $ip && isset($p['timestamp'])) {
            if ($now - $p['timestamp'] < 30) {
                http_response_code(429);
                echo json_encode(['error' => '投稿間隔が短すぎます。30秒お待ちください']);
                exit;
            }
        }
        break; // 最新の1件だけチェック
    }

    // 投稿追加
    $post = [
        'id' => bin2hex(random_bytes(8)),
        'name' => $name,
        'content' => $content,
        'date' => date('Y/m/d H:i'),
        'timestamp' => $now,
        'ip' => $ip,
    ];

    $posts[] = $post;
    savePosts($posts);

    // レスポンスにはIPを含めない
    unset($post['ip'], $post['timestamp']);
    echo json_encode($post, JSON_UNESCAPED_UNICODE);
    exit;
}

// --- DELETE: 投稿削除（管理者用） ---
if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $id = $_GET['id'] ?? '';
    if ($id === '') {
        http_response_code(400);
        echo json_encode(['error' => 'idが必要です']);
        exit;
    }

    $posts = loadPosts();
    $filtered = array_values(array_filter($posts, function($p) use ($id) {
        return $p['id'] !== $id;
    }));

    if (count($filtered) === count($posts)) {
        http_response_code(404);
        echo json_encode(['error' => '投稿が見つかりません']);
        exit;
    }

    savePosts($filtered);
    echo json_encode(['ok' => true]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
