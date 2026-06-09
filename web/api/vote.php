<?php
/**
 * 投票API
 *
 * エンドポイント:
 *   GET    ?action=status&event=...       → 投票状況（期限、自分の投票数、残り票）
 *   GET    ?action=results&event=...      → 投票結果（期限後のみ TOP3）
 *   POST   ?action=vote     {video_id, event_group}  → 投票実行
 *
 * イベントグループ判定:
 *   "5月ライブ1日目" と "5月ライブ2日目" は同じグループ → "5月ライブ"
 *   日目部分を除去した文字列がグループキー
 *
 * 公開日と期限:
 *   イベントグループの最初の動画参照時に published_at を記録
 *   vote_closes_at = published_at + 3日
 */

require_once __DIR__ . '/db.php';

requireSiteAuth();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

/**
 * 動画リストから event_group を計算（日目部分を除去）
 */
function normalizeEventGroup(string $event_name): string {
    $s = preg_replace('/\s*[\(（]?[1-9一二三四]\s*日目[\)）]?/u', '', $event_name);
    return trim($s);
}

/**
 * 指定 event_group に属する全動画を videos.json から取得
 */
function getVideosInEventGroup(string $event_group): array {
    $videos_json = __DIR__ . '/../data/videos.json';
    if (!file_exists($videos_json)) return [];
    $data = json_decode(file_get_contents($videos_json), true) ?? [];
    $vids = $data['videos'] ?? [];
    $result = [];
    foreach ($vids as $v) {
        if (normalizeEventGroup($v['event_name'] ?? '') === $event_group) {
            $result[] = $v;
        }
    }
    return $result;
}

/**
 * イベントグループの公開日と期限を取得・記録
 * 初回参照時に DB に保存
 */
function ensureEventPublished(PDO $pdo, string $event_group): array {
    $stmt = $pdo->prepare('SELECT published_at, vote_closes_at FROM event_published WHERE event_group = ?');
    $stmt->execute([$event_group]);
    $row = $stmt->fetch();
    if ($row) return $row;

    // 初回: 現時点を公開日とする
    $videos = getVideosInEventGroup($event_group);
    if (empty($videos)) return ['published_at' => null, 'vote_closes_at' => null];

    $published_at = date('Y-m-d H:i:s');
    $vote_closes_at = date('Y-m-d H:i:s', time() + 3 * 86400);
    $stmt = $pdo->prepare('INSERT INTO event_published (event_group, published_at, vote_closes_at) VALUES (?, ?, ?)');
    $stmt->execute([$event_group, $published_at, $vote_closes_at]);
    return ['published_at' => $published_at, 'vote_closes_at' => $vote_closes_at];
}

/**
 * ユーザーが指定 event_group で投票可能な総票数を計算
 * = (現時点での出演バンド数) / 10 を四捨五入
 */
function calcVoteAllowance(string $real_name): int {
    $members_json = __DIR__ . '/../data/members.json';
    if (!file_exists($members_json)) return 0;
    $data = json_decode(file_get_contents($members_json), true) ?? [];
    $member = $data['members'][$real_name] ?? null;
    if (!$member) return 0;
    $bands = (int)($member['total_bands'] ?? 0);
    return (int)round($bands / 10);
}

/**
 * 自分の出演動画 ID 一覧
 */
function getOwnVideoIds(string $real_name): array {
    $videos_json = __DIR__ . '/../data/videos.json';
    if (!file_exists($videos_json)) return [];
    $data = json_decode(file_get_contents($videos_json), true) ?? [];
    $ids = [];
    foreach ($data['videos'] ?? [] as $v) {
        foreach ($v['members'] ?? [] as $m) {
            if (($m['name'] ?? '') === $real_name) {
                $ids[] = $v['video_id'];
                break;
            }
        }
    }
    return $ids;
}

try {
    $pdo = getDB();

    if ($method === 'GET' && $action === 'status') {
        $event_group = $_GET['event'] ?? '';
        if (!$event_group) jsonResponse(['error' => 'event指定必須'], 400);
        $pub = ensureEventPublished($pdo, $event_group);
        $user = getCurrentUser();
        $voted_count = 0;
        $allowance = 0;
        $voted_video_ids = [];
        if ($user) {
            $stmt = $pdo->prepare('SELECT video_id FROM votes WHERE user_id = ? AND event_group = ?');
            $stmt->execute([$user['id'], $event_group]);
            $voted_video_ids = array_column($stmt->fetchAll(), 'video_id');
            $voted_count = count($voted_video_ids);
            $allowance = calcVoteAllowance($user['real_name']);
        }
        $closed = $pub['vote_closes_at'] && strtotime($pub['vote_closes_at']) < time();
        jsonResponse([
            'event_group' => $event_group,
            'published_at' => $pub['published_at'],
            'vote_closes_at' => $pub['vote_closes_at'],
            'closed' => $closed,
            'logged_in' => (bool)$user,
            'voted_count' => $voted_count,
            'voted_video_ids' => $voted_video_ids,
            'allowance' => $allowance,
            'remaining' => max(0, $allowance - $voted_count),
        ]);
    }

    if ($method === 'GET' && $action === 'results') {
        $event_group = $_GET['event'] ?? '';
        if (!$event_group) jsonResponse(['error' => 'event指定必須'], 400);
        $pub = ensureEventPublished($pdo, $event_group);
        if (!$pub['vote_closes_at'] || strtotime($pub['vote_closes_at']) > time()) {
            jsonResponse(['error' => '投票期間中のため結果は非公開', 'closed' => false]);
        }
        // TOP3 集計
        $stmt = $pdo->prepare(
            'SELECT video_id, COUNT(*) AS cnt FROM votes WHERE event_group = ? GROUP BY video_id ORDER BY cnt DESC, video_id ASC LIMIT 3'
        );
        $stmt->execute([$event_group]);
        $rows = $stmt->fetchAll();
        jsonResponse([
            'event_group' => $event_group,
            'closed' => true,
            'top3' => $rows,
        ]);
    }

    if ($method === 'POST' && $action === 'vote') {
        $user = requireAccount();
        $input = json_decode(file_get_contents('php://input'), true) ?? [];
        $video_id = trim($input['video_id'] ?? '');
        $event_group = trim($input['event_group'] ?? '');
        if (!$video_id || !$event_group) jsonResponse(['error' => '入力不足'], 400);

        // 期限チェック
        $pub = ensureEventPublished($pdo, $event_group);
        if ($pub['vote_closes_at'] && strtotime($pub['vote_closes_at']) < time()) {
            jsonResponse(['error' => '投票期間が終了しました'], 400);
        }

        // 自分のバンドへの投票は不可
        $own = getOwnVideoIds($user['real_name']);
        if (in_array($video_id, $own, true)) {
            jsonResponse(['error' => '自分のバンドには投票できません'], 400);
        }

        // 残り票数チェック
        $stmt = $pdo->prepare('SELECT COUNT(*) FROM votes WHERE user_id = ? AND event_group = ?');
        $stmt->execute([$user['id'], $event_group]);
        $voted = (int)$stmt->fetchColumn();
        $allowance = calcVoteAllowance($user['real_name']);
        if ($voted >= $allowance) {
            jsonResponse(['error' => '投票可能数を超えています', 'allowance' => $allowance, 'voted' => $voted], 400);
        }

        // 同じ動画への重複投票チェック
        $stmt = $pdo->prepare('SELECT id FROM votes WHERE user_id = ? AND video_id = ?');
        $stmt->execute([$user['id'], $video_id]);
        if ($stmt->fetch()) jsonResponse(['error' => 'すでに投票済みです'], 400);

        // 投票実行
        $stmt = $pdo->prepare('INSERT INTO votes (user_id, video_id, event_group) VALUES (?, ?, ?)');
        $stmt->execute([$user['id'], $video_id, $event_group]);
        jsonResponse(['ok' => true, 'voted_count' => $voted + 1, 'remaining' => $allowance - $voted - 1]);
    }

    jsonResponse(['error' => '不明なアクション'], 400);
} catch (Throwable $e) {
    error_log('vote.php: ' . $e->getMessage());
    jsonResponse(['error' => 'サーバーエラー'], 500);
}
