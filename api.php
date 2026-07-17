<?php
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store');

$dataDir = __DIR__ . DIRECTORY_SEPARATOR . 'data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0777, true);
}

$allowed = array(
    'staff', 'orders', 'holidays', 'history', 'children', 'config',
    'confirmed', 'hoiku_orders', 'hoiku_history', 'hoiku_confirmed', 'kensa'
);

$defaults = array(
    'staff'=>'[]', 'orders'=>'{}', 'holidays'=>'[]', 'history'=>'[]',
    'children'=>'[]', 'config'=>'{}', 'confirmed'=>'{}',
    'hoiku_orders'=>'{}', 'hoiku_history'=>'[]', 'hoiku_confirmed'=>'{}',
    'kensa'=>'{}'
);

$key = isset($_GET['key']) ? $_GET['key'] : '';

if ($key === 'all') {
    $result = array();
    foreach ($allowed as $k) {
        $file = $dataDir . DIRECTORY_SEPARATOR . $k . '.json';
        if (file_exists($file)) {
            $result[$k] = json_decode(file_get_contents($file), true);
        } else {
            $result[$k] = json_decode($defaults[$k], true);
        }
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!in_array($key, $allowed)) {
    http_response_code(400);
    echo json_encode(array('error' => 'Invalid key'));
    exit;
}

$file = $dataDir . DIRECTORY_SEPARATOR . $key . '.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($file)) {
        readfile($file);
    } else {
        echo $defaults[$key];
    }
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = file_get_contents('php://input');
    $decoded = json_decode($input, true);
    if ($decoded === null && $input !== 'null') {
        http_response_code(400);
        echo json_encode(array('error' => 'Invalid JSON'));
        exit;
    }
    $action = isset($_GET['action']) ? $_GET['action'] : '';
    $written = false;
    $errMsg = '';
    $fp = @fopen($file, 'c+');
    if ($fp === false) {
        $errMsg = 'ファイルを開けません: ' . $key . '.json（dataフォルダの書き込み権限、ファイルの読み取り専用属性を確認してください）';
    } elseif (!flock($fp, LOCK_EX)) {
        $errMsg = 'ファイルロックに失敗しました: ' . $key . '.json';
        fclose($fp);
    } else {
        if ($action === 'merge' && is_array($decoded)) {
            $current = '';
            $stat = fstat($fp);
            if ($stat['size'] > 0) {
                $current = fread($fp, $stat['size']);
            }
            $data = json_decode($current, true);
            if (!is_array($data)) $data = array();
            $depth = isset($_GET['depth']) ? intval($_GET['depth']) : 1;
            if ($depth >= 2) {
                foreach ($decoded as $k1 => $v1) {
                    if (!isset($data[$k1]) || !is_array($data[$k1])) $data[$k1] = array();
                    if (is_array($v1)) {
                        foreach ($v1 as $k2 => $v2) {
                            if ($v2 === null) {
                                unset($data[$k1][$k2]);
                            } else {
                                $data[$k1][$k2] = $v2;
                            }
                        }
                    }
                }
            } else {
                foreach ($decoded as $k => $v) {
                    if ($v === null) {
                        unset($data[$k]);
                    } else {
                        $data[$k] = $v;
                    }
                }
            }
            $out = json_encode($data, JSON_UNESCAPED_UNICODE);
            if ($out === false) {
                $errMsg = 'JSONエンコードに失敗しました（文字コードを確認してください）';
            } else {
                fseek($fp, 0);
                ftruncate($fp, 0);
                $written = (fwrite($fp, $out) !== false);
                if (!$written) $errMsg = 'ファイル書き込みに失敗しました: ' . $key . '.json';
            }
        } else {
            ftruncate($fp, 0);
            $written = (fwrite($fp, $input) !== false);
            if (!$written) $errMsg = 'ファイル書き込みに失敗しました: ' . $key . '.json';
        }
        fflush($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
    }
    if ($written) {
        echo json_encode(array('ok' => true), JSON_UNESCAPED_UNICODE);
    } else {
        http_response_code(500);
        echo json_encode(array('error' => $errMsg), JSON_UNESCAPED_UNICODE);
    }
}
