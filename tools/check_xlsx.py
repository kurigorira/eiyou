#!/usr/bin/env python3.13
"""出力したxlsxが本当にExcelで開けるかを検査する。

openpyxl はタグの順序を見ないため、要素の順番違いを見逃す。
Excelは順序を厳密に検査して「XMLエラー」でファイルを修復してしまうので、
ここでは OOXML の仕様どおりの順序になっているかを直接確かめる。
"""
import sys, zipfile, re

# CT_Worksheet の子要素の順序（ECMA-376）
WS_ORDER = [
    'sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData',
    'sheetCalcPr', 'sheetProtection', 'protectedRanges', 'scenarios', 'autoFilter',
    'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr',
    'conditionalFormatting', 'dataValidations', 'hyperlinks', 'printOptions',
    'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
    'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing',
    'legacyDrawing', 'picture', 'oleObjects', 'controls', 'tableParts', 'extLst',
]
# CT_SheetView の子要素の順序
SV_ORDER = ['pane', 'selection', 'pivotSelection', 'extLst']

# CT_Workbook の子要素の順序
WB_ORDER = [
    'fileVersion', 'fileSharing', 'workbookPr', 'workbookProtection', 'bookViews',
    'sheets', 'functionGroups', 'externalReferences', 'definedNames', 'calcPr',
    'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes',
    'webPublishing', 'fileRecoveryPr', 'webPublishObjects', 'extLst',
]


def children_of(xml, parent_tag):
    """親要素の直下にある子要素名を、出てくる順に返す"""
    m = re.search(r'<' + parent_tag + r'(?:\s[^>]*)?>(.*)</' + parent_tag + r'>', xml, re.S)
    if not m:
        return []
    body, depth, out = m.group(1), 0, []
    for tm in re.finditer(r'<(/?)([A-Za-z0-9_]+)([^>]*?)(/?)>', body):
        close, name, attrs, selfclose = tm.group(1), tm.group(2), tm.group(3), tm.group(4)
        if close:
            depth -= 1
            continue
        if depth == 0:
            out.append(name)
        if not selfclose:
            depth += 1
    return out


def check_order(found, order, where, errors):
    idx = -1
    for name in found:
        if name not in order:
            continue
        i = order.index(name)
        if i < idx:
            errors.append(f'{where}: <{name}> の位置が仕様と違います'
                          f'（{order[idx]} より後ろに来ています）'
                          f' / 実際の並び: {", ".join(found)}')
            return
        idx = i


def check(path):
    errors = []
    z = zipfile.ZipFile(path)
    names = z.namelist()

    for required in ('[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml'):
        if required not in names:
            errors.append(f'{required} がありません')

    for n in names:
        if not n.endswith('.xml'):
            continue
        data = z.read(n).decode('utf-8')
        # XMLとして壊れていないか
        try:
            from lxml import etree
            etree.fromstring(data.encode('utf-8'))
        except Exception as e:
            errors.append(f'{n}: XMLとして壊れています: {e}')
            continue
        if n.startswith('xl/worksheets/sheet'):
            check_order(children_of(data, 'worksheet'), WS_ORDER, n, errors)
            for sv in re.findall(r'<sheetView\b.*?</sheetView>', data, re.S):
                check_order(children_of(sv, 'sheetView'), SV_ORDER, n + ' の sheetView', errors)
        elif n == 'xl/workbook.xml':
            check_order(children_of(data, 'workbook'), WB_ORDER, n, errors)
    return errors


if __name__ == '__main__':
    bad = 0
    for p in sys.argv[1:]:
        errs = check(p)
        label = p.split('/')[-1]
        if errs:
            bad += 1
            print(f'✗ {label}')
            for e in errs:
                print('    ' + e)
        else:
            print(f'○ {label}  要素の順序・XML構文とも問題なし')
    sys.exit(1 if bad else 0)
