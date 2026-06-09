<?php
/**
 * 動画コメントAPI
 *
 * エンドポイント:
 *   GET    ?video_id=...                → 動画のコメント一覧
 *   POST                 {video_id, content}  → コメント投稿
 *   DELETE ?id=...                       → 自分のコメント削除
 */

require_once __DIR__ . '/db.php';

requireSiteAuth();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = getDB();

    if ($method === 'GET') {
        $video_id = $_GET['video_id'] ?? '';
        if (!$video_id) jsonResponse(['error' => 'video_id必須'], 400);
        $stmt = $pdo->prepare(
            'SELECT c.id, c.content, c.created_at, c.user_id, u.real_name AS author
             FROM comments c JOIN users u ON u.id = c.user_id
             WHERE c.video_id = ? ORDER BY c.created_at DESC LIMIT 200'
        );
        $stmt->execute([$video_id]);
        jsonResponse(['comments' => $stmt->fetchAll()]);
    }

    if ($method === 'POST') {
        $user = requireAccount();
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $video_id = trim($input['video_id'] ?? '');
        $content = trim($input['content'] ?? '');
        if (!$video_id || !$content) jsonResponse(['error' => '入力不足'], 400);
        if (mb_strlen($content) > 500) jsonResponse(['error' => '500文字以内'], 400);
        $content = strip_tags($content);

        $stmt = $pdo->prepare('INSERT INTO comments (user_id, video_id, content) VALUES (?, ?, ?)');
        $stmt->execute([$user['id'], $video_id, $content]);
        jsonResponse(['ok' => true, 'id' => $pdo->lastInsertId()]);
    }

    if ($method === 'DELETE') {
        $user = requireAccount();
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) jsonResponse(['error' => 'id必須'], 400);
        $stmt = $pdo->prepare('DELETE FROM comments WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $user['id']]);
        if ($stmt->rowCount() === 0) jsonResponse(['error' => '削除権限なし'], 403);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['error' => '不明なメソッド'], 405);
} catch (Throwable $e) {
    error_log('comment.php: ' . $e->getMessage());
    jsonResponse(['error' => 'サーバーエラー'], 500);
}
