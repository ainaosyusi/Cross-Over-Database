<?php
/**
 * 訪問者カウンターAPI
 *
 * GET /api/counter.php → 今日の訪問者数を返し、アクセスを記録
 *
 * IPアドレスのハッシュで重複排除（同一人物は1日1カウント）
 * データは日付ごとにJSONファイルに保存
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$dataFile = __DIR__ . '/counter_data.json';

// データ読み込み
function loadData() {
    global $dataFile;
    if (!file_exists($dataFile)) return [];
    $json = file_get_contents($dataFile);
    $data = json_decode($json, true);
    return is_array($data) ? $data : [];
}

// データ保存
function saveData($data) {
    global $dataFile;
    file_put_contents($dataFile, json_encode($data, JSON_UNESCAPED_UNICODE));
}

$today = date('Y-m-d');
$data = loadData();

// 古いデータを削除（7日分のみ保持）
foreach (array_keys($data) as $date) {
    if ($date < date('Y-m-d', strtotime('-7 days'))) {
        unset($data[$date]);
    }
}

// 今日のエントリがなければ作成
if (!isset($data[$today])) {
    $data[$today] = [];
}

// 訪問者を記録（IPハッシュで重複排除、プライバシー配慮）
$ip = $_SERVER['REMOTE_ADDR'] ?? '';
$ipHash = substr(hash('sha256', $ip . $today), 0, 16);

if (!in_array($ipHash, $data[$today])) {
    $data[$today][] = $ipHash;
    saveData($data);
}

// レスポンス
$todayCount = count($data[$today]);
$yesterdayCount = isset($data[date('Y-m-d', strtotime('-1 day'))]) ? count($data[date('Y-m-d', strtotime('-1 day'))]) : 0;

echo json_encode([
    'today' => $todayCount,
    'yesterday' => $yesterdayCount,
]);
