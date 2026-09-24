<?php
/* ============================================================
 * 勤務区分 取込スクリプト（JOYNUS II 勤務管理システム対応）
 *
 * JoyKinmData（勤務データ）から職員ごと・日ごとの勤務区分を取得し、
 * 保育園食システムに返します。
 *
 *   JoyKinmData.KinmuTbl = 勤務CD(3バイト) × 31日分 の固定長文字列
 *   → これを1日ずつに分解し、JoyKinmu（勤務種類マスタ）の名称に変換します。
 *
 * ▼ 設定でやること
 *   下の【接続設定】の $DB_HOST に、JOYNUSのデータベースサーバーの
 *   IPアドレス（またはホスト名）を入れるだけです。
 *   DBの種類が分からない場合は $DB_TYPE = 'auto' のままで構いません
 *   （利用可能なドライバを順に試し、つながったものを使います）。
 *
 * ▼ 動作確認（ブラウザで開いてください）
 *   1) 接続確認とテーブル調査
 *      sync_shifts.php?probe=1
 *      → つながったDSN、JoyKinmData / JoyKinmu の列名が表示されます
 *   2) 取込内容の確認
 *      sync_shifts.php?year=2026&month=9&debug=1
 *      → 取得件数・勤務種類マスタ・生データのサンプルが表示されます
 *
 * ▼ 注意
 *   必ず参照専用（SELECTのみ）のアカウントを使用してください。
 * ============================================================ */

/* ===================== 【接続設定】ここから ===================== */

// --- 1) データベース接続 ---
// $DB_TYPE: 'auto' | 'sqlsrv'(SQL Server) | 'oci'(Oracle) | 'pgsql' | 'mysql'
$DB_TYPE = 'auto';
$DB_HOST = '10.20.1.36';  // JOYNUSのDBサーバー
$DB_PORT = '';            // 既定ポート以外の場合のみ指定（例: '1433'）
$DB_NAME = 'nagasakidb';
$DB_USER = 'viewer';
$DB_PASS = '';            // パスワードなし

// --- 2) 取得する勤務データの種類 ---
// '1' = 予定勤務（翌月の食事注文にはこちらを使います）
// '2' = 実績勤務、'0' = 希望勤務
$KBN = '1';

// --- 3) YYMM（年月）の格納形式 ---
// 'auto'（既定）なら 202609 と 2609 の両方を試します。
$YYMM_FORMAT = 'auto';

// --- 4) 部署の絞り込み（任意）---
// 例: $BUSYO_FILTER = array('001', '002');  空なら全部署
$BUSYO_FILTER = array();

// --- 5) 勤務種類マスタ（勤務CD → 表示名）---
// probe=1 で調べた実際の列名に合わせてください。
// 変換せず勤務CDのまま取り込む場合は $USE_KINMU_MASTER = false にします。
// （勤務CDのままでも、保育園の「勤務区分マスタ」の勤務CD欄で対応づけできます）
$USE_KINMU_MASTER = true;
$KINMU_TABLE      = 'JoyKinmu';
$KINMU_CD_COL     = 'Kinmu';      // 勤務CDの列名
$KINMU_NAME_COL   = 'Ryaku';      // 表示名の列名（略称）

// --- 6) 職員IDの対応づけ（重要）---
// JOYNUSの個人CDは6桁、給食システムの職員IDは電子カルテIDの8桁で桁数が違います。
// 1対1で対応しているため、下記のいずれかの方法で変換します。
//
//   'auto'  : ①手動対応表 → ②そのまま一致 → ③ゼロ埋め8桁で一致 → ④氏名で一致
//             の順に試します（推奨。設定不要で多くの場合つながります）
//   'pad8'  : 先頭をゼロ埋めして8桁にするだけ（例: 123456 → 00123456）
//   'name'  : JoyKojin.KjName と給食システムの職員氏名で突き合わせる
//   'map'   : 手動対応表だけを使う
//   'none'  : 変換しない（JOYNUSの6桁のまま取り込む）
$ID_MAP_MODE = 'auto';

// 手動対応表。{"JOYNUS個人CD": "給食システムの職員ID"} の形式のJSONファイル。
// 自動で対応づかない職員だけをここに書けば済みます。
$ID_MAP_FILE = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'shift_idmap.json';

// 給食システムの職員マスタ（氏名突合とID確認に使用）
$STAFF_FILE = __DIR__ . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'staff.json';

// 勤務個人マスタ（氏名・在籍状態の取得元）
$KOJIN_TABLE     = 'JoyKojin';
$KOJIN_CD_COL    = 'Code';        // 個人CD
$KOJIN_NAME_COL  = 'KjName';      // 職員氏名
$KOJIN_STATE_COL = 'KyutaiKbn';   // 所属の状態 0:在籍 1:退職 2:異動
$EXCLUDE_RETIRED = true;          // 退職者(1)を取り込み対象から外す

// --- 7) テーブル名（通常は変更不要）---
$KINMDATA_TABLE = 'JoyKinmData';

/* ===================== 【接続設定】ここまで ===================== */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

// 1つのドライバを試す際の接続待ち時間（秒）。順に試すので短めにする。
define('CONNECT_TIMEOUT', 5);

$debug = isset($_GET['debug']) && $_GET['debug'] == '1';
$probe = isset($_GET['probe']) && $_GET['probe'] == '1';

function fail($msg, $extra = null) {
    $out = array('ok' => false, 'error' => $msg);
    if ($extra !== null) $out['detail'] = $extra;
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

/** 設定から接続文字列の候補を組み立てる
 *  SQL Server は接続オプションの違いで失敗しやすいため、複数の書き方を順に試す。
 *  戻り値: array( array('driver'=>..., 'dsn'=>..., 'label'=>...), ... ) */
function buildDsnCandidates($type, $host, $port, $name) {
    $avail = PDO::getAvailableDrivers();
    $srv   = $host . ($port ? ',' . $port : '');

    $mk = array();

    // --- SQL Server (Microsoft製 pdo_sqlsrv) ---
    // ODBC Driver 18 以降は既定で暗号化必須になり、証明書が院内発行だと
    // 「SSL Provider ... certificate chain」で弾かれる。順に緩めて試す。
    $mk['sqlsrv'] = array(
        array('dsn' => 'sqlsrv:Server=' . $srv . ';Database=' . $name . ';LoginTimeout=' . CONNECT_TIMEOUT,
              'label' => '標準'),
        array('dsn' => 'sqlsrv:Server=' . $srv . ';Database=' . $name . ';LoginTimeout=' . CONNECT_TIMEOUT
                     . ';TrustServerCertificate=1',
              'label' => 'サーバー証明書を検証しない'),
        array('dsn' => 'sqlsrv:Server=' . $srv . ';Database=' . $name . ';LoginTimeout=' . CONNECT_TIMEOUT
                     . ';Encrypt=0;TrustServerCertificate=1',
              'label' => '暗号化なし'),
    );

    // --- SQL Server (ODBC経由。pdo_sqlsrv が無い環境向け) ---
    $mk['odbc'] = array(
        array('dsn' => 'odbc:Driver={ODBC Driver 17 for SQL Server};Server=' . $srv . ';Database=' . $name
                     . ';TrustServerCertificate=yes',
              'label' => 'ODBC Driver 17'),
        array('dsn' => 'odbc:Driver={SQL Server};Server=' . $srv . ';Database=' . $name,
              'label' => 'SQL Server（旧ドライバ）'),
    );

    $mk['pgsql'] = array(
        array('dsn' => 'pgsql:host=' . $host . ';port=' . ($port ? $port : '5432') . ';dbname=' . $name
                     . ';connect_timeout=' . CONNECT_TIMEOUT, 'label' => '標準'),
    );
    $mk['mysql'] = array(
        array('dsn' => 'mysql:host=' . $host . ';port=' . ($port ? $port : '3306') . ';dbname=' . $name
                     . ';charset=utf8mb4', 'label' => '標準'),
    );
    $mk['oci'] = array(
        array('dsn' => 'oci:dbname=//' . $host . ':' . ($port ? $port : '1521') . '/' . $name
                     . ';charset=AL32UTF8', 'label' => '標準'),
    );

    $order = ($type === 'auto') ? array('sqlsrv', 'odbc', 'oci', 'pgsql', 'mysql') : array($type);
    $out = array();
    foreach ($order as $d) {
        if (!isset($mk[$d])) continue;
        if (!in_array($d, $avail)) continue;   // 未導入のドライバは試さない
        foreach ($mk[$d] as $c) {
            $out[] = array('driver' => $d, 'dsn' => $c['dsn'], 'label' => $d . '（' . $c['label'] . '）');
        }
    }
    return $out;
}

/** 接続時に渡すPDOオプション。
 *  pdo_sqlsrv は PDO::ATTR_TIMEOUT を受け付けず
 *  「SQLSTATE[IMSSP]: An unsupported attribute was designated on the PDO object.」
 *  で失敗するため、ドライバごとに渡すものを変える。
 *  接続待ち時間はDSNの LoginTimeout で指定している。 */
function pdoOptionsFor($driver) {
    $opt = array(PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION);
    if ($driver !== 'sqlsrv' && $driver !== 'odbc') {
        $opt[PDO::ATTR_TIMEOUT] = CONNECT_TIMEOUT;
    }
    return $opt;
}

/** 候補を順に試して接続する */
function connectDb($cands, $user, $pass, &$usedDriver, &$tried, &$usedDsn) {
    foreach ($cands as $c) {
        $drv = $c['driver'];
        try {
            $pdo = new PDO($c['dsn'], $user, $pass, pdoOptionsFor($drv));
            // 取得形式は接続後に設定する（コンストラクタで渡すとドライバによっては弾かれる）
            try { $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC); } catch (Exception $e) {}
            $usedDriver = $drv;
            $usedDsn    = $c['dsn'];
            return $pdo;
        } catch (Exception $e) {
            $tried[] = $c['label'] . ': ' . $e->getMessage();
        }
    }
    return null;
}

/** 接続エラーの文面から、具体的な対処を日本語で組み立てる */
function hintsForErrors($tried, $user, $pass) {
    $all = implode(' / ', $tried);
    $h = array();
    if (strpos($all, 'IMSSP') !== false && strpos($all, 'unsupported attribute') !== false) {
        $h[] = 'このメッセージが出る場合、sync_shifts.php が古い版です。最新に入れ替えてください。';
    }
    if (strpos($all, '18456') !== false || stripos($all, 'Login failed for user') !== false) {
        $h[] = 'アカウントかパスワードが違います。JOYNUSの管理者に、参照専用（SELECTのみ）の'
             . 'SQL Server認証アカウントとパスワードをご確認ください。'
             . ($pass === '' ? '（現在パスワードは未設定です。SQL Server認証ではパスワードが必要なことがほとんどです）' : '');
    }
    if (stripos($all, 'certificate') !== false || strpos($all, 'SSL Provider') !== false) {
        $h[] = 'サーバー証明書で弾かれています。本スクリプトは自動で'
             . ' TrustServerCertificate / Encrypt=0 も試します。それでも駄目な場合は'
             . 'JOYNUS側の暗号化設定をご確認ください。';
    }
    if (strpos($all, '08001') !== false || stripos($all, 'server was not found') !== false
        || strpos($all, '2002') !== false || stripos($all, 'timeout') !== false) {
        $h[] = '給食サーバーからDBサーバーへ届いていません。IPアドレス・ポート（SQL Serverは既定1433）・'
             . 'ファイアウォールをネットワーク担当にご確認ください。'
             . '名前付きインスタンスの場合は $DB_HOST を「10.20.1.36\\インスタンス名」の形にします。';
    }
    if (stripos($all, 'Cannot open database') !== false || strpos($all, '4060') !== false) {
        $h[] = 'データベース名が違うか、そのアカウントに参照権限がありません。';
    }
    if ($user !== '' && $pass === '') {
        $h[] = 'パスワードが空欄のため、SQL Serverでは Windows認証（Apacheの実行アカウント）で'
             . '接続を試みることがあります。SQL Server認証を使う場合は $DB_PASS にパスワードを設定してください。';
    }
    return $h;
}

/** テーブル名・列名をDBの種類に合わせて引用符で囲む
 *  PostgreSQL / Oracle は大文字小文字を区別するため、JoyKinmData のような
 *  大小混在の名前はそのまま書くと見つからない。 */
function qid($driver, $name) {
    switch ($driver) {
        case 'mysql':  return '`' . str_replace('`', '``', $name) . '`';
        case 'sqlsrv':
        case 'odbc':   return '[' . str_replace(']', ']]', $name) . ']';
        default:       return '"' . str_replace('"', '""', $name) . '"';  // pgsql / oci
    }
}

/* ==================== テーブルの自動探索 ====================
 * SQL Server では、テーブルが dbo 以外のスキーマにあったり、別のデータベースに
 * あったりすると「オブジェクト名 'JoyKinmData' が無効です」になる。
 * 決め打ちせず、サーバーに実際にある表の一覧から探す。 */

/** 接続中のデータベースの表の一覧を取得する
 *  戻り値: array( array('schema'=>..,'name'=>..), ... ) */
function loadTableCatalog($pdo, $driver = '', $dbName = '') {
    $out = array();
    try {
        // システム用の表は除く（これが混ざると本来の表が埋もれる）
        $sql = 'SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES'
             . " WHERE TABLE_SCHEMA NOT IN ('information_schema','pg_catalog','sys','INFORMATION_SCHEMA')";
        if ($driver === 'mysql' && $dbName !== '') {
            // MySQLのINFORMATION_SCHEMAは全DBを返すので、対象DBに絞る
            $sql .= ' AND TABLE_SCHEMA = ' . $pdo->quote($dbName);
        }
        foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
            // 列名の大文字小文字はDBMSによって違うので両方見る
            $sc = isset($r['TABLE_SCHEMA']) ? $r['TABLE_SCHEMA'] : (isset($r['table_schema']) ? $r['table_schema'] : '');
            $nm = isset($r['TABLE_NAME'])   ? $r['TABLE_NAME']   : (isset($r['table_name'])   ? $r['table_name']   : '');
            if ($nm === '') continue;
            $out[] = array('schema' => (string)$sc, 'name' => (string)$nm);
        }
    } catch (Exception $e) {
        // 一覧が引けない場合は探索なしで続行する
    }
    return $out;
}

/** SQL Server で、同じサーバー上の他のデータベースを一覧する */
function listDatabases($pdo, $driver) {
    $out = array();
    try {
        if ($driver === 'sqlsrv' || $driver === 'odbc') {
            $sql = "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb')"
                 . " AND state = 0 ORDER BY name";
        } elseif ($driver === 'mysql') {
            $sql = "SHOW DATABASES";
        } elseif ($driver === 'pgsql') {
            $sql = "SELECT datname AS name FROM pg_database WHERE datistemplate = false ORDER BY 1";
        } else {
            return $out;
        }
        foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_NUM) as $r) {
            $out[] = (string)$r[0];
        }
    } catch (Exception $e) {}
    return $out;
}

/** 表の一覧から、探している名前に当たるものを見つける
 *  ① 完全一致（大文字小文字は無視） ② 部分一致
 *  戻り値: array('schema'=>..,'name'=>..) または null */
function findTable($catalog, $wanted) {
    $w = strtolower(trim($wanted));
    if ($w === '') return null;
    foreach ($catalog as $t) {
        if (strtolower($t['name']) === $w) return $t;
    }
    // dbo を優先しつつ部分一致で探す（例: JoyKinmData → TJoyKinmData）
    $hit = null;
    foreach ($catalog as $t) {
        if (strpos(strtolower($t['name']), $w) === false) continue;
        if ($hit === null || strtolower($t['schema']) === 'dbo') $hit = $t;
    }
    return $hit;
}

/** スキーマ付きのテーブル名を組み立てる（例: [dbo].[JoyKinmData]） */
function qtable($driver, $t, $fallbackName) {
    if ($t === null) return qid($driver, $fallbackName);
    if ($t['schema'] === '') return qid($driver, $t['name']);
    return qid($driver, $t['schema']) . '.' . qid($driver, $t['name']);
}

/** 表が見つからないときの説明文を作る */
function tableNotFoundNote($wanted, $catalog, $dbName) {
    if (count($catalog) === 0) {
        return 'テーブル ' . $wanted . ' が見つからず、表の一覧も取得できませんでした。'
             . 'アカウントに参照権限があるかご確認ください。';
    }
    $names = array();
    foreach ($catalog as $t) {
        $names[] = ($t['schema'] !== '' && strtolower($t['schema']) !== 'dbo')
                 ? $t['schema'] . '.' . $t['name'] : $t['name'];
        if (count($names) >= 12) break;
    }
    return 'データベース ' . $dbName . ' に ' . $wanted . ' がありません。'
         . '（このDBにある表: ' . implode(', ', $names)
         . (count($catalog) > 12 ? ' ほか' . (count($catalog) - 12) . '個' : '') . '）';
}

/** 氏名を比較用に正規化する（全角・半角スペースを除去） */
function normName($s) {
    $s = trim((string)$s);
    return str_replace(array(' ', '　', "\t"), '', $s);
}

/** JoyKojin から 個人CD => [氏名, 在籍状態] を読む。$table は修飾済みの表名 */
function loadKojin($pdo, $driver, $table, $cdCol, $nameCol, $stateCol) {
    $out = array();
    try {
        $sql = 'SELECT ' . qid($driver,$cdCol) . ' AS "cd", ' . qid($driver,$nameCol) . ' AS "nm"';
        if ($stateCol) $sql .= ', ' . qid($driver,$stateCol) . ' AS "st"';
        $sql .= ' FROM ' . $table;
        foreach ($pdo->query($sql)->fetchAll() as $r) {
            $cd = trim((string)$r['cd']);
            if ($cd === '') continue;
            $out[$cd] = array(
                'name'  => trim((string)$r['nm']),
                'state' => isset($r['st']) ? trim((string)$r['st']) : '0',
            );
        }
    } catch (Exception $e) {
        // 読めなくても同期は続行する（IDそのまま・ゼロ埋めでの対応づけは可能）
    }
    return $out;
}

/** 給食システムの職員マスタ（staff.json）を読む */
function loadStaffMaster($file) {
    $byId = array(); $byName = array();
    if (is_file($file)) {
        $j = json_decode((string)file_get_contents($file), true);
        if (is_array($j)) {
            foreach ($j as $st) {
                if (!isset($st['id'])) continue;
                $id = trim((string)$st['id']);
                if ($id === '') continue;
                $byId[$id] = true;
                $nm = normName(isset($st['name']) ? $st['name'] : '');
                if ($nm !== '') {
                    // 同姓同名は誤対応を避けるため対象外にする
                    $byName[$nm] = isset($byName[$nm]) ? '__DUP__' : $id;
                }
            }
        }
    }
    return array('byId' => $byId, 'byName' => $byName);
}

/** JOYNUSの個人CDを給食システムの職員IDに変換する */
function mapKojinToStaffId($cd, $mode, $manual, $kojin, $staff, &$how) {
    $how = '';
    if ($mode === 'none') { $how = 'そのまま'; return $cd; }

    // ① 手動対応表
    if (($mode === 'auto' || $mode === 'map') && isset($manual[$cd]) && $manual[$cd] !== '') {
        $how = '対応表'; return trim((string)$manual[$cd]);
    }
    if ($mode === 'map') return '';

    // ② そのまま職員マスタにある
    if ($mode === 'auto' && isset($staff['byId'][$cd])) { $how = '一致'; return $cd; }

    // ③ ゼロ埋めして8桁
    if ($mode === 'auto' || $mode === 'pad8') {
        $p = str_pad($cd, 8, '0', STR_PAD_LEFT);
        if ($mode === 'pad8') { $how = 'ゼロ埋め'; return $p; }
        if (isset($staff['byId'][$p])) { $how = 'ゼロ埋め'; return $p; }
    }

    // ④ 氏名で突き合わせ
    if ($mode === 'auto' || $mode === 'name') {
        $nm = isset($kojin[$cd]) ? normName($kojin[$cd]['name']) : '';
        if ($nm !== '' && isset($staff['byName'][$nm]) && $staff['byName'][$nm] !== '__DUP__') {
            $how = '氏名'; return $staff['byName'][$nm];
        }
    }
    return '';
}

/** テーブルの列名を1行だけ読んで調べる。$qualified は [dbo].[JoyKinmData] 形式 */
function probeColumns($pdo, $qualified) {
    try {
        $st = $pdo->query('SELECT * FROM ' . $qualified);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        $st->closeCursor();
        if ($row === false) return array('table' => $qualified, 'columns' => array(),
                                         'note' => 'テーブルは存在しますが行がありません');
        return array('table' => $qualified, 'columns' => array_keys($row), 'sample' => $row);
    } catch (Exception $e) {
        return array('table' => $qualified, 'error' => $e->getMessage());
    }
}

if ($DB_HOST === '') {
    fail('データベースサーバーのアドレスが未設定です。サーバーの sync_shifts.php を開き、'
       . '【接続設定】の $DB_HOST にJOYNUSのDBサーバーのIPアドレスを記入してください。'
       . '（データベース名 ' . $DB_NAME . ' ／ アカウント ' . $DB_USER . ' は設定済みです）'
       . ' 設定が済むまではCSV取込をご利用ください。');
}

$cands = buildDsnCandidates($DB_TYPE, $DB_HOST, $DB_PORT, $DB_NAME);
if (count($cands) === 0) {
    fail('利用できるデータベースドライバがPHPに入っていません。'
       . 'php.ini で pdo_sqlsrv / pdo_oci / pdo_pgsql / pdo_mysql のいずれかを有効にし、'
       . 'Apacheを再起動してください。（現在利用可能: ' . implode(', ', PDO::getAvailableDrivers()) . '）');
}

$usedDriver = '';
$usedDsn    = '';
$tried = array();
$labels = array();
foreach ($cands as $c) $labels[] = $c['label'];
$pdo = connectDb($cands, $DB_USER, $DB_PASS, $usedDriver, $tried, $usedDsn);
if ($pdo === null) {
    fail('データベースに接続できませんでした。サーバーアドレス・DBの種類・アカウントをご確認ください。',
         array(
             'tried'      => $tried,
             'candidates' => $labels,
             'hints'      => hintsForErrors($tried, $DB_USER, $DB_PASS),
             'host'       => $DB_HOST . ($DB_PORT ? ':' . $DB_PORT : ''),
             'database'   => $DB_NAME,
             'user'       => $DB_USER,
             'hasPassword'=> ($DB_PASS !== ''),
             'drivers'    => implode(', ', PDO::getAvailableDrivers()),
         ));
}

/* ---------- 接続中のDBにある表を調べ、目的の表を探す ---------- */
$catalog  = loadTableCatalog($pdo, $usedDriver, $DB_NAME);
$foundDb  = $DB_NAME;
$tKinm    = findTable($catalog, $KINMDATA_TABLE);
$tKinmu   = findTable($catalog, $KINMU_TABLE);
$tKojin   = findTable($catalog, $KOJIN_TABLE);
$dbSearch = array();   // 他DBを探した記録

// このDBに無い場合、同じサーバーの他のデータベースを探す
if ($tKinm === null) {
    foreach (listDatabases($pdo, $usedDriver) as $db) {
        if ($db === $DB_NAME) continue;
        try {
            if ($usedDriver === 'sqlsrv' || $usedDriver === 'odbc') {
                $sql = 'SELECT TABLE_SCHEMA, TABLE_NAME FROM ' . qid($usedDriver, $db)
                     . '.INFORMATION_SCHEMA.TABLES'
                     . " WHERE TABLE_SCHEMA NOT IN ('sys','INFORMATION_SCHEMA')";
            } elseif ($usedDriver === 'mysql') {
                $sql = 'SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES'
                     . ' WHERE TABLE_SCHEMA = ' . $pdo->quote($db);
            } else {
                continue;   // PostgreSQL は接続を張り直さないと他DBを見られない
            }
            $cat2 = array();
            foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC) as $r) {
                $sc = isset($r['TABLE_SCHEMA']) ? $r['TABLE_SCHEMA'] : '';
                $nm = isset($r['TABLE_NAME'])   ? $r['TABLE_NAME']   : '';
                if ($nm !== '') $cat2[] = array('schema' => (string)$sc, 'name' => (string)$nm);
            }
            $hit = findTable($cat2, $KINMDATA_TABLE);
            $dbSearch[] = $db . ': ' . (count($cat2) . '個の表' . ($hit ? ' → 見つかりました' : ''));
            if ($hit !== null) {
                // 見つかったDBに切り替える（表名を DB名.スキーマ.表名 で修飾する）
                $foundDb = $db;
                $catalog = $cat2;
                $tKinm   = $hit;
                $tKinmu  = findTable($cat2, $KINMU_TABLE);
                $tKojin  = findTable($cat2, $KOJIN_TABLE);
                break;
            }
        } catch (Exception $e) {
            $dbSearch[] = $db . ': 参照できません';
        }
    }
}

/** 見つかった表を、必要ならDB名付きで修飾して返す */
function qfound($driver, $t, $fallback, $foundDb, $curDb) {
    $base = qtable($driver, $t, $fallback);
    if ($t !== null && $foundDb !== $curDb) return qid($driver, $foundDb) . '.' . $base;
    return $base;
}
$qKinm  = qfound($usedDriver, $tKinm,  $KINMDATA_TABLE, $foundDb, $DB_NAME);
$qKinmu = qfound($usedDriver, $tKinmu, $KINMU_TABLE,    $foundDb, $DB_NAME);
$qKojin = qfound($usedDriver, $tKojin, $KOJIN_TABLE,    $foundDb, $DB_NAME);

/* ---------- 調査モード: 接続確認とテーブルの列名を表示 ---------- */
if ($probe) {
    $tableList = array();
    foreach ($catalog as $t) {
        $tableList[] = ($t['schema'] !== '' ? $t['schema'] . '.' : '') . $t['name'];
    }
    sort($tableList);
    $notes = array();
    if ($tKinm === null)  $notes[] = tableNotFoundNote($KINMDATA_TABLE, $catalog, $DB_NAME);
    if ($foundDb !== $DB_NAME) {
        $notes[] = '目的の表は ' . $DB_NAME . ' ではなく ' . $foundDb . ' にありました。'
                 . 'sync_shifts.php の $DB_NAME を ' . $foundDb . ' に変更することをおすすめします。';
    }
    if (strtolower($DB_USER) === 'sa') {
        $notes[] = '【ご注意】sa は SQL Server の最上位管理者アカウントです。'
                 . '給食システムからは参照専用（SELECTのみ）のアカウントに変更してください。';
    }
    echo json_encode(array(
        'ok'          => true,
        'mode'        => 'probe',
        'driver'      => $usedDriver,
        'dsn'         => $usedDsn,
        'database'    => $DB_NAME,
        'foundIn'     => $foundDb,
        'tableCount'  => count($catalog),
        'tables'      => array_slice($tableList, 0, 200),
        'dbSearch'    => $dbSearch,
        'notes'       => $notes,
        'user'        => $DB_USER,
        'JoyKinmData' => probeColumns($pdo, $qKinm),
        'JoyKinmu'    => probeColumns($pdo, $qKinmu),
        'JoyKojin'    => probeColumns($pdo, $qKojin),
        'hint'        => 'JoyKinmu の列名を確認し $KINMU_CD_COL / $KINMU_NAME_COL を合わせてください。'
                       . ' また JoyKojin の Code（6桁）と給食システムの職員ID（8桁）の対応を確認してください。',
    ), JSON_UNESCAPED_UNICODE);
    exit;
}

$year  = isset($_GET['year'])  ? intval($_GET['year'])  : 0;
$month = isset($_GET['month']) ? intval($_GET['month']) : 0;
if ($year < 2000 || $month < 1 || $month > 12) {
    fail('年月の指定が正しくありません。');
}

// 検索する YYMM の候補
$ymCandidates = array();
if ($YYMM_FORMAT === 'Ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%04d%02d', $year, $month);        // 202609
}
if ($YYMM_FORMAT === 'ym' || $YYMM_FORMAT === 'auto') {
    $ymCandidates[] = sprintf('%02d%02d', $year % 100, $month);  // 2609
}

try {
    // --- 勤務データを取得（Kojin='000000' は部署行なので除外）---
    $rows = array();
    $usedYm = '';
    foreach ($ymCandidates as $ym) {
        $sql = 'SELECT ' . qid($usedDriver,'YYMM') . ' AS "YYMM", '
             . qid($usedDriver,'Busyo')    . ' AS "Busyo", '
             . qid($usedDriver,'Kojin')    . ' AS "Kojin", '
             . qid($usedDriver,'Kbn')      . ' AS "Kbn", '
             . qid($usedDriver,'KinmuTbl') . ' AS "KinmuTbl"'
             . ' FROM ' . $qKinm
             . ' WHERE ' . qid($usedDriver,'YYMM')  . ' = :ym'
             . '   AND ' . qid($usedDriver,'Kbn')   . ' = :kbn'
             . '   AND ' . qid($usedDriver,'Kojin') . ' <> :zero';
        $params = array(':ym' => $ym, ':kbn' => $KBN, ':zero' => '000000');
        if (count($BUSYO_FILTER) > 0) {
            $ph = array();
            foreach ($BUSYO_FILTER as $i => $b) { $ph[] = ':b'.$i; $params[':b'.$i] = $b; }
            $sql .= ' AND ' . qid($usedDriver,'Busyo') . ' IN (' . implode(',', $ph) . ')';
        }
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (count($rows) > 0) { $usedYm = $ym; break; }
    }

    // --- 勤務CD → 表示名 の対応表 ---
    $nameOf = array();
    $kinmuErr = '';
    if ($USE_KINMU_MASTER) {
        try {
            $ks = $pdo->query('SELECT ' . qid($usedDriver,$KINMU_CD_COL) . ' AS "cd", '
                            . qid($usedDriver,$KINMU_NAME_COL) . ' AS "nm"'
                            . ' FROM ' . $qKinmu);
            foreach ($ks->fetchAll() as $k) {
                $cd = trim((string)$k['cd']);
                $nm = trim((string)$k['nm']);
                if ($cd !== '') $nameOf[$cd] = $nm;
            }
        } catch (Exception $e) {
            // 列名が違う等で引けない場合は勤務CDのまま返す（同期は続行）
            $kinmuErr = $e->getMessage();
            $nameOf = array();
        }
    }

    // --- 職員IDの対応づけに使う情報を読む ---
    $kojin = loadKojin($pdo, $usedDriver, $qKojin, $KOJIN_CD_COL, $KOJIN_NAME_COL, $KOJIN_STATE_COL);
    $staff = loadStaffMaster($STAFF_FILE);
    $manual = array();
    if (is_file($ID_MAP_FILE)) {
        $mj = json_decode((string)file_get_contents($ID_MAP_FILE), true);
        if (is_array($mj)) $manual = $mj;
    }
} catch (Exception $e) {
    fail('勤務データの取得に失敗しました: ' . $e->getMessage(),
         array('driver' => $usedDriver, 'table' => $qKinm,
               'hints' => array($tKinm === null ? tableNotFoundNote($KINMDATA_TABLE, $catalog, $DB_NAME)
                                                : '表は見つかっています。列名（YYMM / Busyo / Kojin / Kbn / KinmuTbl）をご確認ください。')));
}

if (count($rows) === 0) {
    fail($year . '年' . $month . '月の勤務データが見つかりませんでした。'
       . '（検索したYYMM: ' . implode(' / ', $ymCandidates) . ' ／ Kbn=' . $KBN . '）'
       . ' YYMMの格納形式や勤務データ区分の設定をご確認ください。'
       . ' sync_shifts.php?probe=1 で接続内容を確認できます。');
}

// --- KinmuTbl（勤務CD 3バイト × 31日分）を1日ずつに分解 ---
$days  = intval(date('t', mktime(0, 0, 0, $month, 1, $year)));
$out   = array();
$count = 0;
$rawSamples = array();

$unmapped = array();
$mappedHow = array();

foreach ($rows as $r) {
    $cd  = trim((string)$r['Kojin']);
    $tbl = (string)$r['KinmuTbl'];
    if ($cd === '') continue;

    // 退職者は取り込まない
    if ($EXCLUDE_RETIRED && isset($kojin[$cd]) && $kojin[$cd]['state'] === '1') continue;

    // JOYNUSの個人CD(6桁) → 給食システムの職員ID(8桁)
    $how = '';
    $sid = mapKojinToStaffId($cd, $ID_MAP_MODE, $manual, $kojin, $staff, $how);
    if ($sid === '') {
        $unmapped[$cd] = isset($kojin[$cd]) ? $kojin[$cd]['name'] : '';
        continue;
    }
    if (!isset($mappedHow[$how])) $mappedHow[$how] = 0;
    $mappedHow[$how]++;

    if ($debug && count($rawSamples) < 3) {
        $rawSamples[] = array(
            'JOYNUS個人CD' => $cd,
            '氏名'         => isset($kojin[$cd]) ? $kojin[$cd]['name'] : '',
            '職員ID'       => $sid,
            '対応づけ'     => $how,
            'Busyo'        => trim((string)$r['Busyo']),
            'KinmuTbl'     => $tbl,
        );
    }
    for ($d = 1; $d <= $days; $d++) {
        $cd = trim(substr($tbl, ($d - 1) * 3, 3));
        if ($cd === '' || $cd === '000') continue;   // 未設定・休みは取り込まない
        $name = isset($nameOf[$cd]) ? $nameOf[$cd] : $cd;
        if ($name === '') $name = $cd;
        if (!isset($out[$sid])) $out[$sid] = array();
        $out[$sid][(string)$d] = $name;
        $count++;
    }
}

$unmappedList = array();
foreach ($unmapped as $cd => $nm) $unmappedList[] = array('個人CD' => $cd, '氏名' => $nm);

$res = array(
    'ok'          => true,
    'shifts'      => $out,
    'count'       => $count,
    'staffCount'  => count($out),
    'unmapped'    => $unmappedList,     // 職員IDに対応づかなかった人
);
if ($debug) {
    $res['debug'] = array(
        'driver'        => $usedDriver,
        'usedYYMM'      => $usedYm,
        'kbn'           => $KBN,
        'rowCount'      => count($rows),
        'daysInMonth'   => $days,
        'idMapMode'     => $ID_MAP_MODE,
        'idMapHow'      => $mappedHow,   // どの方法で何人対応づいたか
        'kojinCount'    => count($kojin),
        'staffCount'    => count($staff['byId']),
        'kinmuMasterCt' => count($nameOf),
        'kinmuMaster'   => array_slice($nameOf, 0, 20, true),
        'kinmuError'    => $kinmuErr,
        'rawSamples'    => $rawSamples,
    );
}
echo json_encode($res, JSON_UNESCAPED_UNICODE);
