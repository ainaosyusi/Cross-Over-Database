<?php
/**
 * アカウント管理API
 *
 * エンドポイント:
 *   POST   ?action=register     {email, password, real_name}        → 認証コード送信
 *   POST   ?action=verify       {email, code}                       → メール認証完了
 *   POST   ?action=resend       {email}                             → 認証コード再送
 *   POST   ?action=login        {email, password}                   → ログイン
 *   POST   ?action=logout                                           → ログアウト
 *   GET    ?action=me                                               → 現在のユーザー情報
 */

require_once __DIR__ . '/db.php';

requireSiteAuth();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET' && $action === 'me') {
    $user = getCurrentUser();
    if (!$user) jsonResponse(['logged_in' => false]);
    jsonResponse([
        'logged_in' => true,
        'user' => [
            'id' => $user['id'],
            'email' => $user['email'],
            'real_name' => $user['real_name'],
            'email_verified' => (bool)$user['email_verified'],
        ],
    ]);
}

if ($method !== 'POST') {
    jsonResponse(['error' => 'POSTメソッドのみ対応'], 405);
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

try {
    $pdo = getDB();

    switch ($action) {
        case 'register':
            $email = trim($input['email'] ?? '');
            $password = (string)($input['password'] ?? '');
            $real_name = trim($input['real_name'] ?? '');

            if (!isValidEmail($email)) {
                jsonResponse(['error' => '学校のメールアドレス（@ed.tus.ac.jp）を入力してください'], 400);
            }
            if (strlen($password) < 8) {
                jsonResponse(['error' => 'パスワードは8文字以上'], 400);
            }
            if (mb_strlen($real_name) < 2 || mb_strlen($real_name) > 30) {
                jsonResponse(['error' => '本名は2〜30文字'], 400);
            }

            // 既存ユーザー確認
            $stmt = $pdo->prepare('SELECT id, email_verified FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $existing = $stmt->fetch();
            if ($existing && $existing['email_verified']) {
                jsonResponse(['error' => 'このメールアドレスは既に登録されています'], 409);
            }

            $hash = password_hash($password, PASSWORD_BCRYPT);

            if ($existing) {
                $stmt = $pdo->prepare('UPDATE users SET password_hash = ?, real_name = ? WHERE id = ?');
                $stmt->execute([$hash, $real_name, $existing['id']]);
            } else {
                $stmt = $pdo->prepare('INSERT INTO users (email, password_hash, real_name) VALUES (?, ?, ?)');
                $stmt->execute([$email, $hash, $real_name]);
            }

            // 既存の未使用コードを失効
            $pdo->prepare('UPDATE email_verifications SET used = 1 WHERE email = ? AND used = 0')->execute([$email]);

            $code = generateVerificationCode();
            $expires = date('Y-m-d H:i:s', time() + 600); // 10分
            $stmt = $pdo->prepare('INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)');
            $stmt->execute([$email, $code, $expires]);

            $sent = sendVerificationCode($email, $code);
            $resp = [
                'ok' => true,
                'message' => '認証コードをメールで送信しました。10分以内に入力してください。',
                'mail_sent' => $sent,
            ];
            if (defined('TEST_MODE') && TEST_MODE) {
                $resp['test_code'] = $code;
                $resp['message'] .= "（TEST_MODE: code={$code}）";
            }
            jsonResponse($resp);

        case 'verify':
            $email = trim($input['email'] ?? '');
            $code = trim($input['code'] ?? '');
            if (!$email || !$code) jsonResponse(['error' => 'メールとコードが必要'], 400);

            $stmt = $pdo->prepare('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND used = 0');
            $stmt->execute([$email, $code]);
            $row = $stmt->fetch();
            if (!$row) jsonResponse(['error' => 'コードが無効です'], 400);
            if (strtotime($row['expires_at']) < time()) {
                jsonResponse(['error' => 'コードの有効期限切れです。再送してください'], 400);
            }

            $pdo->prepare('UPDATE email_verifications SET used = 1 WHERE email = ? AND code = ?')->execute([$email, $code]);
            $pdo->prepare('UPDATE users SET email_verified = 1 WHERE email = ?')->execute([$email]);

            // 自動ログイン
            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $uid = (int)$stmt->fetchColumn();
            initSecureSession();
            $_SESSION['account_user_id'] = $uid;
            jsonResponse(['ok' => true, 'message' => '認証完了。ログインしました']);

        case 'resend':
            $email = trim($input['email'] ?? '');
            if (!isValidEmail($email)) jsonResponse(['error' => '無効なメール'], 400);

            $stmt = $pdo->prepare('SELECT id, email_verified FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user) jsonResponse(['error' => '未登録のメール'], 404);
            if ($user['email_verified']) jsonResponse(['error' => 'すでに認証済みです'], 400);

            $pdo->prepare('UPDATE email_verifications SET used = 1 WHERE email = ? AND used = 0')->execute([$email]);
            $code = generateVerificationCode();
            $expires = date('Y-m-d H:i:s', time() + 600);
            $pdo->prepare('INSERT INTO email_verifications (email, code, expires_at) VALUES (?, ?, ?)')->execute([$email, $code, $expires]);

            $sent = sendVerificationCode($email, $code);
            jsonResponse(['ok' => true, 'message' => '再送しました', 'mail_sent' => $sent]);

        case 'login':
            $email = trim($input['email'] ?? '');
            $password = (string)($input['password'] ?? '');
            if (!$email || !$password) jsonResponse(['error' => '入力不足'], 400);

            $stmt = $pdo->prepare('SELECT id, password_hash, email_verified FROM users WHERE email = ?');
            $stmt->execute([$email]);
            $user = $stmt->fetch();
            if (!$user || !password_verify($password, $user['password_hash'])) {
                jsonResponse(['error' => 'メールまたはパスワードが正しくありません'], 401);
            }
            if (!$user['email_verified']) {
                jsonResponse(['error' => 'メール認証が未完了です', 'need_verify' => true], 403);
            }

            initSecureSession();
            $_SESSION['account_user_id'] = (int)$user['id'];
            jsonResponse(['ok' => true]);

        case 'logout':
            initSecureSession();
            unset($_SESSION['account_user_id']);
            jsonResponse(['ok' => true]);

        case 'update_profile':
            // ログイン必須
            $user = getCurrentUser();
            if (!$user) jsonResponse(['error' => 'ログインしてください'], 401);
            $real_name = trim($input['real_name'] ?? '');
            if (mb_strlen($real_name) < 2 || mb_strlen($real_name) > 30) {
                jsonResponse(['error' => '本名は2〜30文字'], 400);
            }
            $stmt = $pdo->prepare('UPDATE users SET real_name = ? WHERE id = ?');
            $stmt->execute([$real_name, $user['id']]);
            jsonResponse(['ok' => true, 'real_name' => $real_name]);

        case 'change_password':
            $user = getCurrentUser();
            if (!$user) jsonResponse(['error' => 'ログインしてください'], 401);
            $current = (string)($input['current_password'] ?? '');
            $new = (string)($input['new_password'] ?? '');
            if (strlen($new) < 8) jsonResponse(['error' => '新パスワードは8文字以上'], 400);

            $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
            $stmt->execute([$user['id']]);
            $hash = $stmt->fetchColumn();
            if (!password_verify($current, $hash)) {
                jsonResponse(['error' => '現在のパスワードが正しくありません'], 401);
            }

            $new_hash = password_hash($new, PASSWORD_BCRYPT);
            $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([$new_hash, $user['id']]);
            jsonResponse(['ok' => true, 'message' => 'パスワードを変更しました']);

        case 'forgot_password':
            $email = trim($input['email'] ?? '');
            if (!isValidEmail($email)) jsonResponse(['error' => '学校のメールを入力してください'], 400);

            $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? AND email_verified = 1');
            $stmt->execute([$email]);
            if (!$stmt->fetch()) {
                // セキュリティのため、未登録でも同じ応答
                jsonResponse(['ok' => true, 'message' => '登録されているメールにリセットコードを送信しました（10分以内有効）']);
            }

            $pdo->prepare('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0')->execute([$email]);
            $code = generateVerificationCode();
            $expires = date('Y-m-d H:i:s', time() + 600);
            $pdo->prepare('INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, ?)')->execute([$email, $code, $expires]);

            $from = defined('MAIL_FROM') ? MAIL_FROM : 'noreply@example.com';
            $subject = '=?UTF-8?B?' . base64_encode('CrossOverデータベース パスワードリセット') . '?=';
            $body = "パスワードリセットコード: {$code}\n\n10分以内に入力してください。\n\n心当たりがない場合は無視してください。";
            $headers = "From: {$from}\r\nContent-Type: text/plain; charset=UTF-8\r\n";
            if (defined('TEST_MODE') && TEST_MODE) {
                error_log("[TEST_MODE] password reset code for {$email}: {$code}");
            } else {
                @mail($email, $subject, $body, $headers);
            }
            $resp = ['ok' => true, 'message' => 'リセットコードを送信しました（10分以内有効）'];
            if (defined('TEST_MODE') && TEST_MODE) {
                $resp['test_code'] = $code;
            }
            jsonResponse($resp);

        case 'reset_password':
            $email = trim($input['email'] ?? '');
            $code = trim($input['code'] ?? '');
            $new = (string)($input['new_password'] ?? '');
            if (!$email || !$code || strlen($new) < 8) {
                jsonResponse(['error' => '入力不足またはパスワードが短い（8文字以上）'], 400);
            }

            $stmt = $pdo->prepare('SELECT * FROM password_resets WHERE email = ? AND code = ? AND used = 0');
            $stmt->execute([$email, $code]);
            $row = $stmt->fetch();
            if (!$row) jsonResponse(['error' => 'コードが無効です'], 400);
            if (strtotime($row['expires_at']) < time()) {
                jsonResponse(['error' => 'コードの有効期限切れです'], 400);
            }

            $new_hash = password_hash($new, PASSWORD_BCRYPT);
            $pdo->prepare('UPDATE users SET password_hash = ? WHERE email = ?')->execute([$new_hash, $email]);
            $pdo->prepare('UPDATE password_resets SET used = 1 WHERE email = ? AND code = ?')->execute([$email, $code]);
            jsonResponse(['ok' => true, 'message' => 'パスワードをリセットしました。再ログインしてください']);

        case 'delete_account':
            $user = getCurrentUser();
            if (!$user) jsonResponse(['error' => 'ログインしてください'], 401);
            $password = (string)($input['password'] ?? '');
            $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
            $stmt->execute([$user['id']]);
            $hash = $stmt->fetchColumn();
            if (!password_verify($password, $hash)) {
                jsonResponse(['error' => 'パスワードが違います'], 401);
            }
            $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$user['id']]);
            initSecureSession();
            unset($_SESSION['account_user_id']);
            jsonResponse(['ok' => true, 'message' => 'アカウントを削除しました']);

        default:
            jsonResponse(['error' => '不明なアクション'], 400);
    }
} catch (Throwable $e) {
    error_log('account.php: ' . $e->getMessage());
    jsonResponse(['error' => 'サーバーエラー'], 500);
}
