<?php
/* ============================================================
 * 勤務区分 取込スクリプト
 *
 * 勤務管理データベースから「職員ID・日付・勤務区分」を取得して
 * 保育園食システムに返します。
 *
 * ▼ 使い方
 *   下の【接続設定】を自院の環境に合わせて書き換えてください。
 *   書き換え後、保育園マスタ画面の「データベースから同期」で取り込めます。
 *   設定が済むまでは、画面のCSV取込をご利用ください。
 *
 * ▼ 必要なPHP拡張（DBの種類に応じてどれか1つ）
 *   SQL Server   : pdo_sqlsrv ＋ Microsoft ODBC Driver
 *   Oracle       : pdo_oci    ＋ Oracle Instant Client
 *   PostgreSQL   : pdo_pgsql
 *   MySQL/MariaDB: pdo_mysql
 *
 * ▼ 注意
 *   参照専用（SELECTのみ）のアカウントを使用してください。
 * ============================================================ */

/* ===================== 【接続設定】ここから ===================== */

// 接続文字列（DSN）。使用するDBの行だけ有効にしてください。
// SQL Server : 'sqlsrv:Server=10.20.xxx.xxx,1433;Database=KINMU'
// Oracle     : 'oci:dbname=//10.20.xxx.xxx:1521/ORCL;charset=AL32UTF8'
// PostgreSQL : 'pgsql:host=10.20.xxx.xxx;port=5432;dbname=kinmu'
// MySQL      : 'mysql:host=10.20.xxx.xxx;port=3306;dbname=kinmu;charset=utf8mb4'
$DSN  = '';
$USER = '';
$PASS = '';

// 取得SQL。:ym_start と :ym_end に対象月の初日・末日が入ります。
// 「職員ID」「日付」「勤務区分」の3列を、この別名で返してください。
$SQL = "
    SELECT
        STAFF_CD   AS staff_id,
        WORK_DATE  AS work_date,
        SHIFT_NAME AS shift_name
    FROM   KINMU_JISSEKI
    WHERE  WORK_DATE BETWEEN :ym_start AND :ym_end
";

/* ===================== 【接続設定】ここまで ===================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

function fail($msg) {
    http_response_code(200); // 画面側でメッセージを出すため 200 で返す
    echo json_encode(array('ok' => false, 'error' => $msg), JSON_UNESCAPED_UNICODE);
    exit;
}

$year  = isset($_GET['year'])  ? intval($_GET['year'])  : 0;
$month = isset($_GET['month']) ? intval($_GET['month']) : 0;
if ($year < 2000 || $month < 1 || $month > 12) {
    fail('年月の指定が正しくありません。');
}

if ($DSN === '') {
    fail('データベース接続が未設定です。サーバーの sync_shifts.php を開き、'
       . '先頭の【接続設定】に接続文字列・ユーザー・パスワード・取得SQLを記入してください。'
       . '設定が済むまではCSV取込をご利用ください。');
}

$driver = substr($DSN, 0, strpos($DSN, ':'));
if (!in_array($driver, PDO::getAvailableDrivers())) {
    fail('PHPの ' . $driver . ' ドライバが有効になっていません。'
       . 'php.ini で拡張を有効にし、Apacheを再起動してください。'
       . '（現在利用可能: ' . implode(', ', PDO::getAvailableDrivers()) . '）');
}

$start = sprintf('%04d-%02d-01', $year, $month);
$end   = date('Y-m-t', strtotime($start));

try {
    $pdo = new PDO($DSN, $USER, $PASS, array(
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ));
    $stmt = $pdo->prepare($SQL);
    $stmt->execute(array(':ym_start' => $start, ':ym_end' => $end));
    $rows = $stmt->fetchAll();
} catch (Exception $e) {
    fail('データベースへの接続・取得に失敗しました: ' . $e->getMessage());
}

// { "職員ID": { "日": "勤務区分" } } の形に組み立てる
$out = array();
$count = 0;
foreach ($rows as $r) {
    $sid   = isset($r['staff_id'])   ? trim((string)$r['staff_id'])   : '';
    $date  = isset($r['work_date'])  ? trim((string)$r['work_date'])  : '';
    $shift = isset($r['shift_name']) ? trim((string)$r['shift_name']) : '';
    if ($sid === '' || $date === '' || $shift === '') continue;
    $ts = strtotime(substr($date, 0, 10));
    if ($ts === false) continue;
    if (intval(date('Y', $ts)) !== $year || intval(date('n', $ts)) !== $month) continue;
    $day = (string)intval(date('j', $ts));
    if (!isset($out[$sid])) $out[$sid] = array();
    $out[$sid][$day] = $shift;
    $count++;
}

echo json_encode(array('ok' => true, 'shifts' => $out, 'count' => $count), JSON_UNESCAPED_UNICODE);
