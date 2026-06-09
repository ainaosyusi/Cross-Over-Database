<?php
/**
 * お気に入りAPI
 *
 * エンドポイント:
 *   GET                            → 自分のお気に入り一覧（video_idの配列）
 *   POST   {video_id}              → お気に入り追加/トグル
 *   DELETE ?video_id=...           → お気に入り削除
 */

require_once __DIR__ . '/db.php';

requireSiteAuth();
$user = requireAccount();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = getDB();

    if ($method === 'GET') {
        $stmt = $pdo->prepare('SELECT video_id, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC');
        $stmt->execute([$user['id']]);
        jsonResponse(['favorites' => $stmt->fetchAll()]);
    }

    if ($method === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $video_id = trim($input['video_id'] ?? '');
        if (!$video_id) jsonResponse(['error' => 'video_id必須'], 400);

        // 既存チェック
        $stmt = $pdo->prepare('SELECT 1 FROM favorites WHERE user_id = ? AND video_id = ?');
        $stmt->execute([$user['id'], $video_id]);
        if ($stmt->fetch()) {
            $pdo->prepare('DELETE FROM favorites WHERE user_id = ? AND video_id = ?')->execute([$user['id'], $video_id]);
            jsonResponse(['ok' => true, 'state' => 'removed']);
        } else {
            $pdo->prepare('INSERT INTO favorites (user_id, video_id) VALUES (?, ?)')->execute([$user['id'], $video_id]);
            jsonResponse(['ok' => true, 'state' => 'added']);
        }
    }

    if ($method === 'DELETE') {
        $video_id = $_GET['video_id'] ?? '';
        if (!$video_id) jsonResponse(['error' => 'video_id必須'], 400);
        $pdo->prepare('DELETE FROM favorites WHERE user_id = ? AND video_id = ?')->execute([$user['id'], $video_id]);
        jsonResponse(['ok' => true]);
    }

    jsonResponse(['error' => '不明なメソッド'], 405);
} catch (Throwable $e) {
    error_log('favorite.php: ' . $e->getMessage());
    jsonResponse(['error' => 'サーバーエラー'], 500);
}
