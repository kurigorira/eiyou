'use strict';
// 職員給食・保育園食で共有する XLSX(OpenXML) 出力ライブラリ。
// dayOfWeek / getHolidayName / pad は読み込み側のアプリが定義している前提。

// ===== 本物のXLSX(OpenXML)を生成（外部ライブラリ不要・オフライン動作） =====
// スタイル索引: 0=既定 1=見出し 2=中央罫線 3=太字合計 4=左寄せ罫線
//   5=土曜 6=日曜 7=祝日 8=土見出し 9=日見出し 10=祝見出し 11=タイトル左 12=タイトル中央
function xlsxColLetter(n) {
  var s = ''; n = n + 1;
  while (n > 0) { var r = (n-1) % 26; s = String.fromCharCode(65+r) + s; n = Math.floor((n-1)/26); }
  return s;
}
function xmlEsc(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function XC(v, s) { return {v: v, s: s || 0}; }
function XF(formula, s) { return {f: formula, s: s || 0}; }
function xlsxCellXml(rowNum, colIdx, cell) {
  var ref = xlsxColLetter(colIdx) + rowNum;
  var s = cell.s || 0;
  if (cell.f) return '<c r="'+ref+'" s="'+s+'"><f>'+xmlEsc(cell.f)+'</f></c>';
  if (cell.v === '' || cell.v === null || cell.v === undefined) return '<c r="'+ref+'" s="'+s+'"/>';
  if (typeof cell.v === 'number') return '<c r="'+ref+'" s="'+s+'"><v>'+cell.v+'</v></c>';
  return '<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xmlEsc(cell.v)+'</t></is></c>';
}
function xlsxSheetXml(sheet) {
  var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  xml += '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  if (sheet.cols && sheet.cols.length) {
    xml += '<cols>';
    for (var i=0; i<sheet.cols.length; i++) xml += '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+sheet.cols[i]+'" customWidth="1"/>';
    xml += '</cols>';
  }
  xml += '<sheetData>';
  for (var r=0; r<sheet.rows.length; r++) {
    var row = sheet.rows[r];
    xml += '<row r="'+(r+1)+'">';
    for (var c=0; c<row.length; c++) {
      if (row[c] === null || row[c] === undefined) continue;
      xml += xlsxCellXml(r+1, c, row[c]);
    }
    xml += '</row>';
  }
  xml += '</sheetData>';
  if (sheet.merges && sheet.merges.length) {
    xml += '<mergeCells count="'+sheet.merges.length+'">';
    for (var i=0; i<sheet.merges.length; i++) xml += '<mergeCell ref="'+sheet.merges[i]+'"/>';
    xml += '</mergeCells>';
  }
  xml += '</worksheet>';
  return xml;
}
function xlsxStylesXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<fonts count="3">'
  + '<font><sz val="11"/><name val="ＭＳ Ｐゴシック"/></font>'
  + '<font><b/><sz val="11"/><name val="ＭＳ Ｐゴシック"/></font>'
  + '<font><b/><sz val="14"/><name val="ＭＳ Ｐゴシック"/></font>'
  + '</fonts>'
  + '<fills count="6">'
  + '<fill><patternFill patternType="none"/></fill>'
  + '<fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE8EAF6"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4EC"/><bgColor indexed="64"/></patternFill></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill>'
  + '</fills>'
  + '<borders count="2">'
  + '<border><left/><right/><top/><bottom/><diagonal/></border>'
  + '<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>'
  + '</borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="13">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';
}
function xlsxSanitizeName(name) {
  var n = String(name).replace(/[\[\]\*\?\/\\:]/g, '');
  return n.length > 31 ? n.slice(0, 31) : (n || 'Sheet1');
}
function crc32(bytes) {
  var table = crc32._t;
  if (!table) {
    table = crc32._t = [];
    for (var n=0; n<256; n++) { var c=n; for (var k=0;k<8;k++) c = (c&1)?(0xEDB88320^(c>>>1)):(c>>>1); table[n]=c>>>0; }
  }
  var crc = 0xFFFFFFFF;
  for (var i=0; i<bytes.length; i++) crc = (crc>>>8) ^ table[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  var enc = new TextEncoder();
  function u16(n){ return [n&0xFF,(n>>>8)&0xFF]; }
  function u32(n){ return [n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]; }
  var parts = [], central = [], offset = 0;
  for (var i=0; i<files.length; i++) {
    var nameBytes = enc.encode(files[i].name);
    var data = files[i].data;
    var crc = crc32(data);
    var local = [].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0));
    parts.push(new Uint8Array(local)); parts.push(nameBytes); parts.push(data);
    var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset));
    central.push(new Uint8Array(cen)); central.push(nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  var centralStart = offset, centralSize = 0;
  for (var i=0; i<central.length; i++) centralSize += central[i].length;
  var end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart), u16(0)));
  var all = parts.concat(central).concat([end]);
  var total = 0; for (var i=0; i<all.length; i++) total += all[i].length;
  var out = new Uint8Array(total), p = 0;
  for (var i=0; i<all.length; i++) { out.set(all[i], p); p += all[i].length; }
  return out;
}
// 1シートのブックを出力（従来互換）
function downloadXlsx(sheet, filename) {
  downloadXlsxBook([sheet], filename);
}

// 複数シートのブックを出力
function downloadXlsxBook(sheets, filename) {
  var enc = new TextEncoder();
  var n = sheets.length;
  var usedNames = {};
  var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  var sheetsXml = '', wbRels = '', files = [];
  for (var i = 0; i < n; i++) {
    var idx = i + 1;
    // シート名はブック内で一意でなければならない
    var nm = xlsxSanitizeName(sheets[i].name || ('Sheet' + idx));
    if (usedNames[nm]) {
      var suffix = 2;
      while (usedNames[nm + '(' + suffix + ')']) suffix++;
      nm = xlsxSanitizeName(nm.slice(0, 27) + '(' + suffix + ')');
    }
    usedNames[nm] = true;
    ct += '<Override PartName="/xl/worksheets/sheet' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    sheetsXml += '<sheet name="' + xmlEsc(nm) + '" sheetId="' + idx + '" r:id="rId' + idx + '"/>';
    wbRels += '<Relationship Id="rId' + idx + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + idx + '.xml"/>';
    files.push({name: 'xl/worksheets/sheet' + idx + '.xml', data: enc.encode(xlsxSheetXml(sheets[i]))});
  }
  ct += '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
  wbRels += '<Relationship Id="rId' + (n + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + sheetsXml + '</sheets></workbook>';
  var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + wbRels + '</Relationships>';
  var all = [
    {name:'[Content_Types].xml', data: enc.encode(ct)},
    {name:'_rels/.rels', data: enc.encode(rootRels)},
    {name:'xl/workbook.xml', data: enc.encode(workbook)},
    {name:'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels)},
    {name:'xl/styles.xml', data: enc.encode(xlsxStylesXml())}
  ].concat(files);
  var zip = zipStore(all);
  var blob = new Blob([zip], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 日ごとの塗り分けスタイル索引（通常=2, 土=5, 日=6, 祝=7 / 見出しは +3 相当を別途）
function dayFillStyle(y, m, d, isHeader) {
  var dow = dayOfWeek(y, m, d);
  var hol = getHolidayName(y+'-'+pad(m)+'-'+pad(d));
  if (isHeader) {
    if (hol) return 10; if (dow===0) return 9; if (dow===6) return 8; return 1;
  }
  if (hol) return 7; if (dow===0) return 6; if (dow===6) return 5; return 2;
}
