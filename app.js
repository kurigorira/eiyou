'use strict';

var API_URL = 'api.php';
var WEEKDAYS = ['日','月','火','水','木','金','土'];

var DEFAULT_HOLIDAYS = [
  {date:'2026-01-01',name:'元日'},{date:'2026-01-12',name:'成人の日'},
  {date:'2026-02-11',name:'建国記念の日'},{date:'2026-02-23',name:'天皇誕生日'},
  {date:'2026-03-20',name:'春分の日'},{date:'2026-04-29',name:'昭和の日'},
  {date:'2026-05-03',name:'憲法記念日'},{date:'2026-05-04',name:'みどりの日'},
  {date:'2026-05-05',name:'こどもの日'},{date:'2026-05-06',name:'振替休日'},
  {date:'2026-07-20',name:'海の日'},{date:'2026-08-11',name:'山の日'},
  {date:'2026-09-21',name:'敬老の日'},{date:'2026-09-23',name:'秋分の日'},
  {date:'2026-10-12',name:'スポーツの日'},{date:'2026-11-03',name:'文化の日'},
  {date:'2026-11-23',name:'勤労感謝の日'},
  {date:'2027-01-01',name:'元日'},{date:'2027-01-11',name:'成人の日'},
  {date:'2027-02-11',name:'建国記念の日'},{date:'2027-02-23',name:'天皇誕生日'},
  {date:'2027-03-21',name:'春分の日'},{date:'2027-04-29',name:'昭和の日'},
  {date:'2027-05-03',name:'憲法記念日'},{date:'2027-05-04',name:'みどりの日'},
  {date:'2027-05-05',name:'こどもの日'},{date:'2027-07-19',name:'海の日'},
  {date:'2027-08-11',name:'山の日'},{date:'2027-09-20',name:'敬老の日'},
  {date:'2027-09-23',name:'秋分の日'},{date:'2027-10-11',name:'スポーツの日'},
  {date:'2027-11-03',name:'文化の日'},{date:'2027-11-23',name:'勤労感謝の日'},
  {date:'2028-01-01',name:'元日'},{date:'2028-01-10',name:'成人の日'},
  {date:'2028-02-11',name:'建国記念の日'},{date:'2028-02-23',name:'天皇誕生日'},
  {date:'2028-03-20',name:'春分の日'},{date:'2028-04-29',name:'昭和の日'},
  {date:'2028-05-03',name:'憲法記念日'},{date:'2028-05-04',name:'みどりの日'},
  {date:'2028-05-05',name:'こどもの日'},{date:'2028-07-17',name:'海の日'},
  {date:'2028-08-11',name:'山の日'},{date:'2028-09-18',name:'敬老の日'},
  {date:'2028-09-22',name:'秋分の日'},{date:'2028-10-09',name:'スポーツの日'},
  {date:'2028-11-03',name:'文化の日'},{date:'2028-11-23',name:'勤労感謝の日'}
];

var staffList = [];
var orders = {};
var holidays = [];
var opHistory = [];
var children = [];
var config = {};
var confirmed = {};
var kensa = {};
var toastTimer = null;
var adminMode = false;

function apiSave(key, data) {
  fetch(API_URL + '?key=' + key, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).catch(function(e) { console.error('Save failed:', key, e); });
}

function loadData() {
  return fetch(API_URL + '?key=all').then(function(r) { return r.json(); }).then(function(d) {
    staffList = d.staff || [];
    orders = d.orders || {};
    holidays = d.holidays || [];
    opHistory = d.history || [];
    children = d.children || [];
    config = d.config || {};
    confirmed = d.confirmed || {};
    kensa = d.kensa || {};
  });
}

function saveStaff() { apiSave('staff', staffList); }
function saveOrders() { apiSave('orders', orders); }
function saveOrdersForStaff(staffId, y, m) {
  var key = y + '-' + pad(m);
  var partial = {};
  partial[key] = {};
  partial[key][staffId] = (orders[key] && orders[key][staffId]) ? orders[key][staffId] : null;
  apiMerge('orders', partial, 2);
}
function apiMerge(key, data, depth) {
  var url = API_URL + '?key=' + key + '&action=merge';
  if (depth) url += '&depth=' + depth;
  fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data)
  }).catch(function(e) { console.error('Merge failed:', key, e); });
}
function saveHolidays() { apiSave('holidays', holidays); }
function saveHistory() { apiSave('history', opHistory); }
function saveChildren() { apiSave('children', children); }
function saveConfig() { apiSave('config', config); }
function saveConfirmed() { apiSave('confirmed', confirmed); }
function saveKensa() { apiSave('kensa', kensa); }

function getChildrenByStaff(staffId) {
  return children.filter(function(c) { return c.staffId === staffId; });
}

function addHistory(staffId, yearMonth, action, detail) {
  var s = getStaffById(staffId);
  var name = s ? s.name : staffId;
  opHistory.unshift({
    timestamp: new Date().toLocaleString('ja-JP'),
    staffId: staffId,
    staffName: name,
    yearMonth: yearMonth,
    action: action,
    detail: detail || ''
  });
  if (opHistory.length > 2000) opHistory = opHistory.slice(0, 2000);
  saveHistory();
}

function showToast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.classList.remove('show'); }, 2000);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function dayOfWeek(y, m, d) { return new Date(y, m-1, d).getDay(); }
function isWeekend(y, m, d) { var dow = dayOfWeek(y,m,d); return dow===0||dow===6; }
function getHolidayName(dateStr) {
  for (var i=0; i<holidays.length; i++) { if(holidays[i].date===dateStr) return holidays[i].name; }
  return null;
}
function isHoliday(dateStr) { return getHolidayName(dateStr) !== null; }
function isWorkday(y, m, d) {
  var ds = y+'-'+pad(m)+'-'+pad(d);
  return !isWeekend(y,m,d) && !isHoliday(ds);
}

function getStaffById(id) {
  for (var i=0; i<staffList.length; i++) { if(staffList[i].id===id) return staffList[i]; }
  return null;
}
function getDepartments() {
  var deps = {};
  for (var i=0; i<staffList.length; i++) deps[staffList[i].dept] = true;
  return Object.keys(deps).sort();
}
function getStaffSorted() {
  return staffList.slice().sort(function(a,b) {
    if (a.dept < b.dept) return -1; if (a.dept > b.dept) return 1;
    if (a.id < b.id) return -1; if (a.id > b.id) return 1; return 0;
  });
}

var orderLocked = true;
var orderDirty = false;

function getOrderStatus(staffId, y, m) {
  var sKey = y+'-'+pad(m)+'_'+staffId;
  return confirmed[sKey] === true;
}
function setOrderConfirmed(staffId, y, m, val) {
  var sKey = y+'-'+pad(m)+'_'+staffId;
  if (val) confirmed[sKey] = true; else delete confirmed[sKey];
  var partial = {};
  partial[sKey] = val ? true : null;
  apiMerge('confirmed', partial);
}

function emptyMeal() { return {b:false,l:false,d:false,dd:false}; }
function getOrder(staffId, y, m, d) {
  var key = y+'-'+pad(m);
  if (!orders[key] || !orders[key][staffId] || !orders[key][staffId][d]) return emptyMeal();
  var o = orders[key][staffId][d];
  return {b:!!o.b, l:!!o.l, d:!!o.d, dd:!!o.dd};
}
function setOrder(staffId, y, m, d, meal, val) {
  var key = y+'-'+pad(m);
  if (!orders[key]) orders[key] = {};
  if (!orders[key][staffId]) orders[key][staffId] = {};
  if (!orders[key][staffId][d]) orders[key][staffId][d] = emptyMeal();
  orders[key][staffId][d][meal] = val;
}

function parseCSV(text) {
  var lines = text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xFEFF) lines[0] = lines[0].substring(1);
  var result = [];
  for (var i=0; i<lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var fields = [];
    var inQuote = false, field = '';
    for (var j=0; j<line.length; j++) {
      var ch = line[j];
      if (inQuote) {
        if (ch==='"' && j+1<line.length && line[j+1]==='"') { field+='"'; j++; }
        else if (ch==='"') inQuote = false;
        else field += ch;
      } else {
        if (ch==='"') inQuote = true;
        else if (ch===',') { fields.push(field); field=''; }
        else field += ch;
      }
    }
    fields.push(field);
    result.push(fields);
  }
  return result;
}

function getEditPassword() { return config.password || ''; }
function setEditPassword(pw) {
  if (pw) config.password = pw; else delete config.password;
  saveConfig();
}

// ==================== TAB NAVIGATION ====================
function showTab(name) {
  var tabs = document.querySelectorAll('.tab-content');
  var btns = document.querySelectorAll('.tab-btn');
  for (var i=0; i<tabs.length; i++) tabs[i].classList.remove('active');
  for (var i=0; i<btns.length; i++) btns[i].classList.remove('active');
  document.getElementById('tab-'+name).classList.add('active');
  var btn = document.querySelector('[data-tab="'+name+'"]');
  if (btn) btn.classList.add('active');
  if (name==='today') renderToday();
  if (name==='staff') { renderStaffList(); populateChildStaff(); renderChildList(); }
  if (name==='order') initOrderTab();
  if (name==='report') initReportTab();
  if (name==='history') renderHistory();
  if (name==='holiday') renderHolidayList();
  if (name==='kensa') initKensaTab();
}

// ==================== TODAY TAB ====================
function renderToday() {
  fetch(API_URL + '?key=orders').then(function(r) { return r.json(); }).then(function(serverOrders) {
    orders = serverOrders || {};
    return fetch(API_URL + '?key=kensa').then(function(r) { return r.json(); }).then(function(serverKensa) {
      kensa = serverKensa || {};
    });
  }).then(function() {
    renderTodayInner();
  }).catch(function() {
    renderTodayInner();
  });
}
function renderTodayInner() {
  var dateInput = document.getElementById('today-date');
  var ds = dateInput.value;
  if (!ds) { var now=new Date(); ds=fmtDate(now); dateInput.value=ds; }
  var parts = ds.split('-');
  var y = parseInt(parts[0]), m = parseInt(parts[1]), d = parseInt(parts[2]);
  var notice = document.getElementById('today-holiday-notice');
  var hName = getHolidayName(ds);
  var dow = dayOfWeek(y,m,d);
  if (hName) { notice.textContent = ds+' は祝日（'+hName+'）です'; notice.style.display='block'; }
  else if (dow===0||dow===6) { notice.textContent = ds+' は'+WEEKDAYS[dow]+'曜日です'; notice.style.display='block'; }
  else { notice.style.display='none'; }

  var bList=[], lList=[], dList=[], ddList=[];
  var sorted = getStaffSorted();
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    var o = getOrder(s.id, y, m, d);
    if (o.b) bList.push(s);
    if (o.l) lList.push(s);
    if (o.d) dList.push(s);
    if (o.dd) ddList.push(s);
  }
  fillMealList('b-list', bList); document.getElementById('b-count').textContent = bList.length;
  fillMealList('l-list', lList); document.getElementById('l-count').textContent = lList.length;
  fillMealList('d-list', dList); document.getElementById('d-count').textContent = dList.length;
  fillMealList('dd-list', ddList); document.getElementById('dd-count').textContent = ddList.length;
  renderKensaToday(y, m, d);
}

function getKensaAssign(y, m, d, meal) {
  var ym = y+'-'+pad(m);
  if (!kensa[ym] || !kensa[ym][d]) return '';
  return kensa[ym][d][meal] || '';
}

function renderKensaToday(y, m, d) {
  var meals = ['b','l','d'];
  var ids = {b:'kensa-today-b', l:'kensa-today-l', d:'kensa-today-d'};
  for (var i=0; i<meals.length; i++) {
    var el = document.getElementById(ids[meals[i]]);
    if (!el) continue;
    var sid = getKensaAssign(y, m, d, meals[i]);
    var s = sid ? getStaffById(sid) : null;
    if (s) {
      el.textContent = s.id + ' ' + s.name + '（' + s.dept + '）';
      el.style.color = '';
    } else {
      el.textContent = '未割当';
      el.style.color = '#999';
    }
  }
}
function fillMealList(tbodyId, list) {
  var tb = document.getElementById(tbodyId);
  if (list.length===0) { tb.innerHTML='<tr><td colspan="3" style="text-align:center;color:#999">なし</td></tr>'; return; }
  var html='';
  for (var i=0; i<list.length; i++) {
    html+='<tr><td>'+esc(list[i].id)+'</td><td>'+esc(list[i].name)+'</td><td>'+esc(list[i].dept)+'</td></tr>';
  }
  tb.innerHTML = html;
}
function esc(s) { var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

// ==================== STAFF TAB ====================
var editingStaffId = null;

function renderStaffList() {
  var search = (document.getElementById('staff-search').value||'').toLowerCase();
  var sorted = getStaffSorted();
  var tb = document.getElementById('staff-list');
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    if (search && s.id.toLowerCase().indexOf(search)===-1 && s.name.toLowerCase().indexOf(search)===-1 && s.dept.toLowerCase().indexOf(search)===-1) continue;
    var cc = getChildrenByStaff(s.id).length;
    html+='<tr><td>'+esc(s.id)+'</td><td>'+esc(s.name)+'</td><td>'+esc(s.dept)+'</td>';
    html+='<td>'+(cc>0?cc+'人':'')+'</td>';
    html+='<td><button class="btn-edit" onclick="editStaff(\''+esc(s.id)+'\')">編集</button>';
    html+='<button class="btn-del" onclick="deleteStaff(\''+esc(s.id)+'\')">削除</button></td></tr>';
  }
  if (!html) html='<tr><td colspan="5" style="text-align:center;color:#999">職員データがありません</td></tr>';
  tb.innerHTML = html;
}

function submitStaff(e) {
  e.preventDefault();
  var id = document.getElementById('sf-id').value.trim();
  var name = document.getElementById('sf-name').value.trim();
  var dept = document.getElementById('sf-dept').value.trim();
  if (!id||!name||!dept) return;
  if (editingStaffId) {
    var s = getStaffById(editingStaffId);
    if (s) { s.name=name; s.dept=dept; }
    saveStaff(); cancelEditStaff();
    showToast('職員情報を更新しました');
  } else {
    if (getStaffById(id)) { showToast('このIDは既に登録されています'); return; }
    staffList.push({id:id, name:name, dept:dept});
    saveStaff();
    showToast('職員を登録しました');
  }
  document.getElementById('staff-form').reset();
  renderStaffList();
}

function editStaff(id) {
  var s = getStaffById(id);
  if (!s) return;
  editingStaffId = id;
  document.getElementById('sf-id').value = s.id;
  document.getElementById('sf-id').readOnly = true;
  document.getElementById('sf-name').value = s.name;
  document.getElementById('sf-dept').value = s.dept;
  document.getElementById('sf-submit').textContent = '更新';
  document.getElementById('sf-cancel').style.display = '';
  document.getElementById('staff-form-title').textContent = '職員編集';
}

function cancelEditStaff() {
  editingStaffId = null;
  document.getElementById('sf-id').readOnly = false;
  document.getElementById('sf-submit').textContent = '登録';
  document.getElementById('sf-cancel').style.display = 'none';
  document.getElementById('staff-form-title').textContent = '職員登録';
  document.getElementById('staff-form').reset();
}

function deleteStaff(id) {
  var s = getStaffById(id);
  if (!s) return;
  if (!confirm(s.name+'（'+id+'）を削除しますか？\n関連する注文・子供データも削除されます。')) return;
  staffList = staffList.filter(function(x){return x.id!==id;});
  children = children.filter(function(c){return c.staffId!==id;});
  for (var key in orders) { if (orders[key][id]) delete orders[key][id]; }
  saveStaff(); saveOrders(); saveChildren();
  showToast('削除しました');
  renderStaffList();
}

function importCSV() {
  var fileInput = document.getElementById('csv-file');
  if (!fileInput.files.length) { showToast('ファイルを選択してください'); return; }
  var overwrite = document.getElementById('csv-overwrite').checked;
  var reader = new FileReader();
  reader.onload = function(e) {
    var rows = parseCSV(e.target.result);
    var added=0, updated=0, skipped=0;
    for (var i=0; i<rows.length; i++) {
      var r = rows[i];
      if (r.length<3) continue;
      var id=r[0].trim(), name=r[1].trim(), dept=r[2].trim();
      if (!id||!name||!dept) continue;
      if (id==='ID'||id==='職員ID'||id==='id') continue;
      var existing = getStaffById(id);
      if (existing) {
        if (overwrite) { existing.name=name; existing.dept=dept; updated++; }
        else skipped++;
      } else { staffList.push({id:id,name:name,dept:dept}); added++; }
    }
    saveStaff(); renderStaffList();
    showToast('追加:'+added+'件 更新:'+updated+'件 スキップ:'+skipped+'件');
    fileInput.value='';
  };
  reader.readAsText(fileInput.files[0], 'UTF-8');
}

function exportCSV() {
  var sorted = getStaffSorted();
  var csv = '﻿職員ID,氏名,部署\n';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    csv += '"'+s.id.replace(/"/g,'""')+'","'+s.name.replace(/"/g,'""')+'","'+s.dept.replace(/"/g,'""')+'"\n';
  }
  downloadFile(csv, '職員マスタ_'+fmtDate(new Date())+'.csv', 'text/csv;charset=utf-8');
}

function downloadFile(content, filename, type) {
  var blob = new Blob([content], {type:type});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ==================== ORDER TAB ====================
function initOrderTab() {
  var now = new Date();
  var ySel = document.getElementById('order-year');
  var mSel = document.getElementById('order-month');
  if (ySel.options.length===0) {
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    var defM = now.getMonth()+2; var defY = now.getFullYear();
    if (defM>12) { defM=1; defY++; }
    ySel.value = defY; mSel.value = defM;
  }
  populateOrderDept();
  populateOrderStaff();
}

function populateOrderDept() {
  var sel = document.getElementById('order-dept');
  var cur = sel.value;
  sel.innerHTML = '<option value="">全部署</option>';
  var deps = getDepartments();
  for (var i=0; i<deps.length; i++) {
    var o = document.createElement('option'); o.value=deps[i]; o.textContent=deps[i]; sel.appendChild(o);
  }
  sel.value = cur;
}

function populateOrderStaff() {
  var dept = document.getElementById('order-dept').value;
  var sel = document.getElementById('order-staff');
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var sorted = getStaffSorted();
  for (var i=0; i<sorted.length; i++) {
    if (dept && sorted[i].dept !== dept) continue;
    var o = document.createElement('option');
    o.value = sorted[i].id;
    o.textContent = sorted[i].id + ' ' + sorted[i].name;
    sel.appendChild(o);
  }
  sel.value = cur;
  renderOrderGrid();
}

function renderOrderGrid() {
  var wrap = document.getElementById('order-grid-wrap');
  var summary = document.getElementById('order-summary');
  var actions = document.getElementById('order-actions');
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) {
    wrap.innerHTML = '<p class="placeholder-msg">職員を選択してください</p>';
    summary.style.display = 'none';
    actions.style.display = 'none';
    return;
  }
  fetch(API_URL + '?key=orders').then(function(r) { return r.json(); }).then(function(serverOrders) {
    orders = serverOrders || {};
    return fetch(API_URL + '?key=confirmed').then(function(r) { return r.json(); }).then(function(serverConfirmed) {
      confirmed = serverConfirmed || {};
    });
  }).then(function() {
    renderOrderGridInner();
  }).catch(function() {
    renderOrderGridInner();
  });
}

function renderOrderGridInner() {
  var wrap = document.getElementById('order-grid-wrap');
  var summary = document.getElementById('order-summary');
  var actions = document.getElementById('order-actions');
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var cfm = getOrderStatus(staffId, y, m);
  orderLocked = cfm;
  orderDirty = false;
  var days = daysInMonth(y, m);
  var todayStr = fmtDate(new Date());
  var disabled = orderLocked ? ' disabled' : '';
  var html = '<table class="order-table"><thead><tr><th>日</th><th>曜日</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>備考</th></tr></thead><tbody>';
  var totB=0, totL=0, totD=0, totDD=0;
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var cls = '';
    if (hName) cls='day-holiday'; else if (dow===0) cls='day-sun'; else if (dow===6) cls='day-sat';
    if (ds===todayStr) cls += ' day-today';
    var o = getOrder(staffId, y, m, d);
    if (o.b) totB++; if (o.l) totL++; if (o.d) totD++; if (o.dd) totDD++;
    html += '<tr class="'+cls+'">';
    html += '<td>'+d+'</td><td>'+WEEKDAYS[dow]+'</td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="b"'+(o.b?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="l"'+(o.l?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="d"'+(o.d?' checked':'')+disabled+'></td>';
    html += '<td><input type="checkbox" data-d="'+d+'" data-m="dd"'+(o.dd?' checked':'')+disabled+'></td>';
    html += '<td style="text-align:left;font-size:0.8rem;color:#999">'+(hName||'')+'</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  summary.style.display = '';
  actions.style.display = '';
  document.getElementById('os-b').textContent = totB;
  document.getElementById('os-l').textContent = totL;
  document.getElementById('os-d').textContent = totD;
  document.getElementById('os-dd').textContent = totDD;
  updateOrderButtons();

  var MEAL_NAMES = {b:'朝食',l:'昼食',d:'夕食',dd:'夕食医師'};
  var checks = wrap.querySelectorAll('input[type="checkbox"]');
  for (var i=0; i<checks.length; i++) {
    checks[i].addEventListener('change', function() {
      var sid = document.getElementById('order-staff').value;
      var cy = parseInt(document.getElementById('order-year').value);
      var cm = parseInt(document.getElementById('order-month').value);
      var day = parseInt(this.getAttribute('data-d'));
      var meal = this.getAttribute('data-m');
      setOrder(sid, cy, cm, day, meal, this.checked);
      saveOrdersForStaff(sid, cy, cm);
      var act = this.checked ? '追加' : '取消';
      addHistory(sid, cy+'-'+pad(cm), '変更', day+'日 '+MEAL_NAMES[meal]+' '+act);
      orderDirty = true;
      updateOrderSummary(cy, cm, sid);
      updateOrderButtons();
    });
  }
}

function updateOrderButtons() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var cfm = getOrderStatus(staffId, y, m);
  var status = document.getElementById('order-status');
  var confirmBtn = document.getElementById('order-confirm');
  var editBtn = document.getElementById('order-edit');

  if (cfm && !orderDirty) {
    status.textContent = '確定済み';
    status.className = 'order-status confirmed';
    confirmBtn.style.display = 'none';
    editBtn.style.display = '';
  } else if (orderDirty) {
    status.textContent = '未保存の変更があります';
    status.className = 'order-status unsaved';
    confirmBtn.style.display = '';
    confirmBtn.textContent = '確定';
    editBtn.style.display = 'none';
  } else {
    status.textContent = '未確定';
    status.className = 'order-status editing';
    confirmBtn.style.display = '';
    confirmBtn.textContent = '確定';
    editBtn.style.display = 'none';
  }
}

function getOrderSummaryText(staffId, y, m) {
  var days = daysInMonth(y, m);
  var t = {b:0,l:0,d:0,dd:0};
  for (var d=1; d<=days; d++) {
    var o = getOrder(staffId, y, m, d);
    if (o.b) t.b++; if (o.l) t.l++; if (o.d) t.d++; if (o.dd) t.dd++;
  }
  return '朝'+t.b+' 昼'+t.l+' 夕'+t.d+' 夕医'+t.dd;
}

function confirmOrder() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var wasConfirmed = getOrderStatus(staffId, y, m);
  saveOrdersForStaff(staffId, y, m);
  setOrderConfirmed(staffId, y, m, true);
  var ym = y+'-'+pad(m);
  var smry = getOrderSummaryText(staffId, y, m);
  addHistory(staffId, ym, wasConfirmed ? '修正確定' : '確定', smry);
  orderLocked = true;
  orderDirty = false;
  setCheckboxDisabled(true);
  updateOrderButtons();
  showToast(y+'年'+m+'月の注文を確定しました');
}

function editOrder() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  fetch(API_URL + '?key=config').then(function(r) { return r.json(); }).then(function(serverConfig) {
    config = serverConfig || {};
    var savedPw = getEditPassword();
    if (savedPw) {
      var input = prompt('編集パスワードを入力してください');
      if (input === null) return;
      if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
    }
    var y = parseInt(document.getElementById('order-year').value);
    var m = parseInt(document.getElementById('order-month').value);
    addHistory(staffId, y+'-'+pad(m), '修正開始', '');
    orderLocked = false;
    orderDirty = false;
    setCheckboxDisabled(false);
    var status = document.getElementById('order-status');
    status.textContent = '修正中';
    status.className = 'order-status editing';
    document.getElementById('order-confirm').style.display = '';
    document.getElementById('order-confirm').textContent = '確定';
    document.getElementById('order-edit').style.display = 'none';
    showToast('修正モードに切り替えました');
  }).catch(function() {
    showToast('サーバーとの通信に失敗しました');
  });
}

function setCheckboxDisabled(disabled) {
  var checks = document.querySelectorAll('#order-grid-wrap input[type="checkbox"]');
  for (var i=0; i<checks.length; i++) checks[i].disabled = disabled;
}

function updateOrderSummary(y, m, staffId) {
  var days = daysInMonth(y, m);
  var totB=0, totL=0, totD=0, totDD=0;
  for (var d=1; d<=days; d++) {
    var o = getOrder(staffId, y, m, d);
    if (o.b) totB++; if (o.l) totL++; if (o.d) totD++; if (o.dd) totDD++;
  }
  document.getElementById('os-b').textContent = totB;
  document.getElementById('os-l').textContent = totL;
  document.getElementById('os-d').textContent = totD;
  document.getElementById('os-dd').textContent = totDD;
}

function requireUnlocked() {
  if (orderLocked) { showToast('修正ボタンを押してから操作してください'); return false; }
  return true;
}

function bulkSetWeekday(meal) {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    if (isWorkday(y, m, d)) setOrder(staffId, y, m, d, meal, true);
  }
  var mealName = {b:'朝食',l:'昼食',d:'夕食',dd:'夕食医師'}[meal];
  saveOrdersForStaff(staffId, y, m);
  addHistory(staffId, y+'-'+pad(m), '一括操作', '平日'+mealName+'セット');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('平日の'+mealName+'をセットしました');
}

function bulkCopyPrev() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var py = m===1 ? y-1 : y;
  var pm = m===1 ? 12 : m-1;
  var prevKey = py+'-'+pad(pm);
  if (!orders[prevKey] || !orders[prevKey][staffId]) { showToast('前月のデータがありません'); return; }
  var days = daysInMonth(y, m);
  for (var d=1; d<=days; d++) {
    var prev = getOrder(staffId, py, pm, d);
    if (prev.b||prev.l||prev.d||prev.dd) {
      var key = y+'-'+pad(m);
      if (!orders[key]) orders[key] = {};
      if (!orders[key][staffId]) orders[key][staffId] = {};
      orders[key][staffId][d] = {b:prev.b, l:prev.l, d:prev.d, dd:prev.dd};
    }
  }
  saveOrdersForStaff(staffId, y, m);
  addHistory(staffId, y+'-'+pad(m), '前月コピー', py+'年'+pm+'月からコピー');
  orderDirty = true;
  renderOrderGridKeepUnlocked();
  showToast('前月のデータをコピーしました');
}

function bulkClear() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  if (!requireUnlocked()) return;
  if (!confirm('この月の注文を全てクリアしますか？')) return;
  var y = parseInt(document.getElementById('order-year').value);
  var m = parseInt(document.getElementById('order-month').value);
  var key = y+'-'+pad(m);
  if (orders[key] && orders[key][staffId]) delete orders[key][staffId];
  saveOrdersForStaff(staffId, y, m);
  setOrderConfirmed(staffId, y, m, false);
  addHistory(staffId, y+'-'+pad(m), 'クリア', '全注文を削除');
  orderDirty = false;
  orderLocked = false;
  renderOrderGridKeepUnlocked();
  showToast('クリアしました');
}

function renderOrderGridKeepUnlocked() {
  var saveLocked = orderLocked;
  var saveDirty = orderDirty;
  renderOrderGridDirect();
  orderLocked = saveLocked;
  orderDirty = saveDirty;
  setCheckboxDisabled(orderLocked);
  updateOrderButtons();
}

function renderOrderGridDirect() {
  var staffId = document.getElementById('order-staff').value;
  if (!staffId) return;
  renderOrderGridInner();
}

function navigateStaff(dir) {
  var sel = document.getElementById('order-staff');
  var idx = sel.selectedIndex + dir;
  if (idx < 1) idx = sel.options.length - 1;
  if (idx >= sel.options.length) idx = 1;
  sel.selectedIndex = idx;
  renderOrderGrid();
}

// ==================== REPORT TAB ====================
function initReportTab() {
  var now = new Date();
  var ySel = document.getElementById('rpt-year');
  var mSel = document.getElementById('rpt-month');
  if (ySel.options.length===0) {
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    ySel.value = now.getFullYear(); mSel.value = now.getMonth()+1;
  }
}

function runReport() {
  fetch(API_URL + '?key=orders').then(function(r) { return r.json(); }).then(function(serverOrders) {
    orders = serverOrders || {};
    return fetch(API_URL + '?key=kensa').then(function(r) { return r.json(); }).then(function(serverKensa) {
      kensa = serverKensa || {};
    });
  }).then(function() {
    runReportInner();
  }).catch(function() {
    runReportInner();
  });
}

function runReportInner() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var days = daysInMonth(y, m);
  var sorted = getStaffSorted();
  var totalB=0, totalL=0, totalD=0, totalDD=0, totalKB=0, totalKL=0, totalKD=0;
  var deptData = {};
  var dailyData = [];
  for (var d=1; d<=days; d++) {
    var dayB=0, dayL=0, dayD=0, dayDD=0;
    for (var i=0; i<sorted.length; i++) {
      var s = sorted[i];
      var o = getOrder(s.id, y, m, d);
      if (o.b) { dayB++; totalB++; }
      if (o.l) { dayL++; totalL++; }
      if (o.d) { dayD++; totalD++; }
      if (o.dd) { dayDD++; totalDD++; }
      if (!deptData[s.dept]) deptData[s.dept] = {b:0,l:0,d:0,dd:0};
      if (o.b) deptData[s.dept].b++;
      if (o.l) deptData[s.dept].l++;
      if (o.d) deptData[s.dept].d++;
      if (o.dd) deptData[s.dept].dd++;
    }
    var dayKB = getKensaAssign(y, m, d, 'b') ? 1 : 0;
    var dayKL = getKensaAssign(y, m, d, 'l') ? 1 : 0;
    var dayKD = getKensaAssign(y, m, d, 'd') ? 1 : 0;
    totalKB += dayKB; totalKL += dayKL; totalKD += dayKD;
    dailyData.push({day:d, dow:dayOfWeek(y,m,d), b:dayB, l:dayL, d:dayD, dd:dayDD, kb:dayKB, kl:dayKL, kd:dayKD});
  }
  var totalAll = totalB+totalL+totalD+totalDD+totalKB+totalKL+totalKD;
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 月次合計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>食事</th><th>食数</th></tr></thead><tbody>';
  html += '<tr><td>朝食</td><td>'+totalB+'</td></tr>';
  html += '<tr><td>昼食</td><td>'+totalL+'</td></tr>';
  html += '<tr><td>夕食</td><td>'+totalD+'</td></tr>';
  html += '<tr><td>夕食医師</td><td>'+totalDD+'</td></tr>';
  html += '<tr><td>検査食朝</td><td>'+totalKB+'</td></tr>';
  html += '<tr><td>検査食昼</td><td>'+totalKL+'</td></tr>';
  html += '<tr><td>検査食夕</td><td>'+totalKD+'</td></tr>';
  html += '</tbody><tfoot><tr><td>合計</td><td>'+totalAll+'</td></tr></tfoot></table></div>';
  html += '<div class="rpt-section"><h3>部署別集計</h3>';
  html += '<table class="rpt-table"><thead><tr><th>部署</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>合計</th></tr></thead><tbody>';
  var deptKeys = Object.keys(deptData).sort();
  var sumB=0,sumL=0,sumD=0,sumDD=0;
  for (var i=0; i<deptKeys.length; i++) {
    var dp = deptData[deptKeys[i]];
    html += '<tr><td>'+esc(deptKeys[i])+'</td><td>'+dp.b+'</td><td>'+dp.l+'</td><td>'+dp.d+'</td><td>'+dp.dd+'</td><td>'+(dp.b+dp.l+dp.d+dp.dd)+'</td></tr>';
    sumB+=dp.b; sumL+=dp.l; sumD+=dp.d; sumDD+=dp.dd;
  }
  html += '</tbody><tfoot><tr><td>合計</td><td>'+sumB+'</td><td>'+sumL+'</td><td>'+sumD+'</td><td>'+sumDD+'</td><td>'+(sumB+sumL+sumD+sumDD)+'</td></tr></tfoot></table></div>';
  html += '<div class="rpt-section"><h3>医師別 検査食統計</h3>';
  html += buildKensaSummaryTable(y, m, 'rpt-table');
  html += '</div>';
  html += '<div class="rpt-section"><h3>日別内訳</h3>';
  html += '<table class="rpt-table"><thead><tr><th>日</th><th>曜日</th><th>朝食</th><th>昼食</th><th>夕食</th><th>夕食医師</th><th>検査朝</th><th>検査昼</th><th>検査夕</th><th>合計</th></tr></thead><tbody>';
  for (var i=0; i<dailyData.length; i++) {
    var dy = dailyData[i];
    var ds = y+'-'+pad(m)+'-'+pad(dy.day);
    var hName = getHolidayName(ds);
    var label = WEEKDAYS[dy.dow];
    if (hName) label += '('+hName+')';
    var dyTot = dy.b+dy.l+dy.d+dy.dd+dy.kb+dy.kl+dy.kd;
    html += '<tr><td>'+dy.day+'</td><td style="text-align:center">'+label+'</td><td>'+dy.b+'</td><td>'+dy.l+'</td><td>'+dy.d+'</td><td>'+dy.dd+'</td><td>'+dy.kb+'</td><td>'+dy.kl+'</td><td>'+dy.kd+'</td><td>'+dyTot+'</td></tr>';
  }
  html += '</tbody></table></div>';
  document.getElementById('rpt-result').innerHTML = html;
}

function getKensaDoctorStats(y, m) {
  var days = daysInMonth(y, m);
  var stats = {};
  var meals = ['b','l','d'];
  for (var d=1; d<=days; d++) {
    for (var j=0; j<meals.length; j++) {
      var sid = getKensaAssign(y, m, d, meals[j]);
      if (!sid) continue;
      if (!stats[sid]) stats[sid] = {b:0,l:0,d:0};
      stats[sid][meals[j]]++;
    }
  }
  return stats;
}

function buildKensaSummaryTable(y, m, tableClass) {
  var stats = getKensaDoctorStats(y, m);
  var ids = Object.keys(stats).sort();
  var html = '<table class="'+tableClass+'"><thead><tr><th>職員ID</th><th>氏名</th><th>部署</th><th>検査朝</th><th>検査昼</th><th>検査夕</th><th>合計</th></tr></thead><tbody>';
  if (ids.length === 0) {
    html += '<tr><td colspan="7" style="text-align:center;color:#999">割り当てなし</td></tr>';
  }
  var sumB=0, sumL=0, sumD=0;
  for (var i=0; i<ids.length; i++) {
    var st = stats[ids[i]];
    var s = getStaffById(ids[i]);
    var name = s ? s.name : '';
    var dept = s ? s.dept : '';
    html += '<tr><td>'+esc(ids[i])+'</td><td>'+esc(name)+'</td><td>'+esc(dept)+'</td>';
    html += '<td>'+st.b+'</td><td>'+st.l+'</td><td>'+st.d+'</td><td>'+(st.b+st.l+st.d)+'</td></tr>';
    sumB+=st.b; sumL+=st.l; sumD+=st.d;
  }
  html += '</tbody>';
  if (ids.length > 0) {
    html += '<tfoot><tr><td colspan="3">合計</td><td>'+sumB+'</td><td>'+sumL+'</td><td>'+sumD+'</td><td>'+(sumB+sumL+sumD)+'</td></tr></tfoot>';
  }
  html += '</table>';
  return html;
}

function exportKensaCSV() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var stats = getKensaDoctorStats(y, m);
  var ids = Object.keys(stats).sort();
  if (ids.length === 0) { showToast('検査食の割り当てがありません'); return; }
  var csv = '﻿職員ID,氏名,部署,検査朝,検査昼,検査夕,合計\n';
  for (var i=0; i<ids.length; i++) {
    var st = stats[ids[i]];
    var s = getStaffById(ids[i]);
    var name = s ? s.name : '';
    var dept = s ? s.dept : '';
    csv += '"'+ids[i].replace(/"/g,'""')+'","'+name.replace(/"/g,'""')+'","'+dept.replace(/"/g,'""')+'",';
    csv += st.b+','+st.l+','+st.d+','+(st.b+st.l+st.d)+'\n';
  }
  downloadFile(csv, '検査食統計_'+y+'年'+pad(m)+'月.csv', 'text/csv;charset=utf-8');
  showToast('検査食統計CSVを出力しました');
}

// ==================== MEAL COUNT SHEETS (総務課/栄養科) ====================
function isDoctorDept(dept) {
  return !!dept && (dept.indexOf('医局') !== -1 || dept.indexOf('診療') !== -1);
}

function isKensaDept(dept) {
  return !!dept && dept.indexOf('診療') !== -1;
}

function buildMealCountData(y, m) {
  var days = daysInMonth(y, m);
  var sorted = getStaffSorted();
  var list = [];
  for (var d=1; d<=days; d++) {
    var row = {day:d, bDoc:0, bGen:0, lDoc:0, lGen:0, dDoc:0, dGen:0};
    for (var i=0; i<sorted.length; i++) {
      var s = sorted[i];
      var o = getOrder(s.id, y, m, d);
      var doc = isDoctorDept(s.dept);
      if (o.b) { if (doc) row.bDoc++; else row.bGen++; }
      if (o.l) { if (doc) row.lDoc++; else row.lGen++; }
      if (o.d) row.dGen++;
      if (o.dd) row.dDoc++;
    }
    list.push(row);
  }
  return list;
}

function fetchOrdersThen(fn) {
  var run = function() {
    try { fn(); } catch(ex) { alert('出力エラー: ' + ex.message); }
  };
  fetch(API_URL + '?key=orders').then(function(r) { return r.json(); }).then(function(serverOrders) {
    orders = serverOrders || {};
    run();
  }).catch(function() {
    run();
  });
}

function xlsWrap(sheetName, bodyHtml) {
  var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="UTF-8">';
  html += '<xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>';
  html += '<x:Name>'+sheetName+'</x:Name>';
  html += '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>';
  html += '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml>';
  html += '</head><body>' + bodyHtml + '</body></html>';
  return html;
}

function downloadXls(html, filename) {
  var blob = new Blob(['﻿' + html], {type: 'application/vnd.ms-excel'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSoumuExcel() {
  fetchOrdersThen(function() {
    var y = parseInt(document.getElementById('rpt-year').value);
    var m = parseInt(document.getElementById('rpt-month').value);
    var data = buildMealCountData(y, m);
    var days = data.length;
    var th = 'border:1px solid #000;padding:3px 6px;text-align:center;font-weight:bold;background:#f0f0f0;';
    var td = 'border:1px solid #000;padding:3px 6px;text-align:center;';
    var tdL = 'border:1px solid #000;padding:3px 6px;text-align:center;font-weight:bold;';
    var html = '<table border="1" style="border-collapse:collapse;font-size:11px">';
    html += '<tr><td colspan="'+(2+days+1)+'" style="font-size:16px;font-weight:bold;text-align:center;padding:8px">職員食実施食数表</td></tr>';
    html += '<tr><td colspan="'+(2+days+1)+'" style="padding:4px;font-weight:bold">'+y+'年'+m+'月</td></tr>';
    html += '<tr><td style="'+th+'"></td><td style="'+th+'"></td>';
    for (var d=1; d<=days; d++) html += '<td style="'+th+'">'+d+'</td>';
    html += '<td style="'+th+'">合計</td></tr>';

    function sumRow(key) {
      var t = 0;
      for (var i=0; i<data.length; i++) t += data[i][key];
      return t;
    }
    function rowHtml(label, rowspan, subLabel, key1, key2) {
      var h = '<tr>';
      if (label !== null) h += '<td rowspan="'+rowspan+'" style="'+tdL+'">'+label+'</td>';
      h += '<td style="'+td+'">'+subLabel+'</td>';
      var total = 0;
      for (var i=0; i<data.length; i++) {
        var v = key2 ? data[i][key1]+data[i][key2] : data[i][key1];
        total += v;
        h += '<td style="'+td+'">'+v+'</td>';
      }
      h += '<td style="'+tdL+'">'+total+'</td></tr>';
      return h;
    }
    html += rowHtml('朝', 3, '医局', 'bDoc');
    html += rowHtml(null, 0, '一般', 'bGen');
    html += rowHtml(null, 0, '合計', 'bDoc', 'bGen');
    html += rowHtml('昼', 3, '医局', 'lDoc');
    html += rowHtml(null, 0, '一般', 'lGen');
    html += rowHtml(null, 0, '合計', 'lDoc', 'lGen');
    html += rowHtml('夕', 3, '医局', 'dDoc');
    html += rowHtml(null, 0, '一般', 'dGen');
    html += rowHtml(null, 0, '合計', 'dDoc', 'dGen');
    html += '</table>';
    downloadXls(xlsWrap('総務課提出用', html), '職員食実施食数表(総務課提出用)_'+y+'年'+pad(m)+'月.xls');
    showToast('総務課提出用Excelを出力しました');
  });
}

function exportEiyouExcel() {
  fetchOrdersThen(function() {
    var y = parseInt(document.getElementById('rpt-year').value);
    var m = parseInt(document.getElementById('rpt-month').value);
    var data = buildMealCountData(y, m);
    var days = data.length;
    var th = 'border:1px solid #000;padding:3px 8px;text-align:center;font-weight:bold;background:#f0f0f0;';
    var td = 'border:1px solid #000;padding:3px 8px;text-align:center;';
    var gap = 'border:none;padding:0 6px;';
    var html = '<table style="border-collapse:collapse;font-size:11px">';
    html += '<tr><td colspan="11" style="font-size:16px;font-weight:bold;text-align:center;padding:8px;border:none">'+y+'年　'+m+'月　　職員食食数表</td></tr>';
    html += '<tr>';
    html += '<td style="'+th+'">日</td><td style="'+th+'">朝</td><td style="'+th+'">昼</td><td style="'+th+'">夕</td><td style="'+th+'">医局</td>';
    html += '<td style="'+gap+'"></td>';
    html += '<td style="'+th+'">日</td><td style="'+th+'">朝</td><td style="'+th+'">昼</td><td style="'+th+'">夕</td><td style="'+th+'">医局</td>';
    html += '</tr>';
    var rows = Math.max(15, days - 15);
    for (var i=0; i<rows; i++) {
      var left = (i < 15) ? data[i] : null;
      var right = (15+i < days) ? data[15+i] : null;
      html += '<tr>';
      if (left) {
        html += '<td style="'+td+'">'+left.day+'</td>';
        html += '<td style="'+td+'">'+(left.bDoc+left.bGen)+'</td>';
        html += '<td style="'+td+'">'+(left.lDoc+left.lGen+1)+'</td>';
        html += '<td style="'+td+'">'+(left.dDoc+left.dGen)+'</td>';
        html += '<td style="'+td+'">'+left.dDoc+'</td>';
      } else {
        html += '<td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td>';
      }
      html += '<td style="'+gap+'"></td>';
      if (right) {
        html += '<td style="'+td+'">'+right.day+'</td>';
        html += '<td style="'+td+'">'+(right.bDoc+right.bGen)+'</td>';
        html += '<td style="'+td+'">'+(right.lDoc+right.lGen+1)+'</td>';
        html += '<td style="'+td+'">'+(right.dDoc+right.dGen)+'</td>';
        html += '<td style="'+td+'">'+right.dDoc+'</td>';
      } else {
        html += '<td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td><td style="'+td+'"></td>';
      }
      html += '</tr>';
    }
    html += '</table>';
    downloadXls(xlsWrap('栄養科掲示用', html), '職員食食数表(栄養科掲示用)_'+y+'年'+pad(m)+'月.xls');
    showToast('栄養科掲示用Excelを出力しました');
  });
}

// ==================== KENSA TAB ====================
function initKensaTab() {
  var ySel = document.getElementById('kensa-year');
  var mSel = document.getElementById('kensa-month');
  if (ySel.options.length === 0) {
    var now = new Date();
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+2; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y; ySel.appendChild(opt);
    }
    for (var m=1; m<=12; m++) {
      var opt = document.createElement('option'); opt.value=m; opt.textContent=m; mSel.appendChild(opt);
    }
    ySel.value = now.getFullYear(); mSel.value = now.getMonth()+1;
  }
  fetch(API_URL + '?key=kensa').then(function(r) { return r.json(); }).then(function(serverKensa) {
    kensa = serverKensa || {};
    renderKensaGrid();
  }).catch(function() {
    renderKensaGrid();
  });
}

function renderKensaGrid() {
  var wrap = document.getElementById('kensa-grid-wrap');
  var y = parseInt(document.getElementById('kensa-year').value);
  var m = parseInt(document.getElementById('kensa-month').value);
  var days = daysInMonth(y, m);
  var todayStr = fmtDate(new Date());
  var sorted = getStaffSorted();
  var doctors = sorted.filter(function(s) { return isKensaDept(s.dept); });
  if (doctors.length === 0) doctors = sorted;
  var doctorIds = {};
  var opts = '<option value="">-- 未割当 --</option>';
  for (var i=0; i<doctors.length; i++) {
    doctorIds[doctors[i].id] = true;
    opts += '<option value="'+esc(doctors[i].id)+'">'+esc(doctors[i].id+' '+doctors[i].name)+'</option>';
  }
  var html = '<table class="order-table"><thead><tr><th>日</th><th>曜日</th><th>検査朝</th><th>検査昼</th><th>検査夕</th><th>備考</th></tr></thead><tbody>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var cls = '';
    if (hName) cls='day-holiday'; else if (dow===0) cls='day-sun'; else if (dow===6) cls='day-sat';
    if (ds===todayStr) cls += ' day-today';
    html += '<tr class="'+cls+'">';
    html += '<td>'+d+'</td><td>'+WEEKDAYS[dow]+'</td>';
    html += '<td><select class="kensa-sel" data-d="'+d+'" data-m="b">'+opts+'</select></td>';
    html += '<td><select class="kensa-sel" data-d="'+d+'" data-m="l">'+opts+'</select></td>';
    html += '<td><select class="kensa-sel" data-d="'+d+'" data-m="d">'+opts+'</select></td>';
    html += '<td style="text-align:left;font-size:0.8rem;color:#999">'+(hName||'')+'</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
  var sels = wrap.querySelectorAll('select.kensa-sel');
  for (var i=0; i<sels.length; i++) {
    var day = parseInt(sels[i].getAttribute('data-d'));
    var meal = sels[i].getAttribute('data-m');
    var assigned = getKensaAssign(y, m, day, meal);
    if (assigned && !doctorIds[assigned]) {
      var as = getStaffById(assigned);
      var extra = document.createElement('option');
      extra.value = assigned;
      extra.textContent = assigned + ' ' + (as ? as.name : '');
      sels[i].appendChild(extra);
    }
    sels[i].value = assigned;
    sels[i].addEventListener('change', function() {
      var dd = parseInt(this.getAttribute('data-d'));
      var mm = this.getAttribute('data-m');
      setKensaAssign(y, m, dd, mm, this.value);
      renderKensaSummary(y, m);
    });
  }
  renderKensaSummary(y, m);
}

function setKensaAssign(y, m, d, meal, staffId) {
  var ym = y+'-'+pad(m);
  if (!kensa[ym]) kensa[ym] = {};
  if (!kensa[ym][d]) kensa[ym][d] = {};
  if (staffId) kensa[ym][d][meal] = staffId; else delete kensa[ym][d][meal];
  var partial = {};
  partial[ym] = {};
  partial[ym][d] = kensa[ym][d];
  apiMerge('kensa', partial, 2);
}

function saveKensaMonth() {
  var y = parseInt(document.getElementById('kensa-year').value);
  var m = parseInt(document.getElementById('kensa-month').value);
  var ym = y+'-'+pad(m);
  var statusEl = document.getElementById('kensa-save-status');
  statusEl.textContent = '登録中...';
  var partial = {};
  partial[ym] = kensa[ym] || {};
  fetch(API_URL + '?key=kensa&action=merge', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(partial)
  }).then(function(r) { return r.json(); }).then(function(res) {
    if (res && res.ok) {
      statusEl.textContent = '登録しました（' + new Date().toLocaleTimeString('ja-JP') + '）';
      showToast(y+'年'+m+'月の検査食割り当てを登録しました');
    } else {
      statusEl.textContent = '登録に失敗しました';
      var msg = res && res.error ? res.error : '不明なエラー';
      alert('登録に失敗しました: ' + msg + '\n\nサーバーの api.php が古い可能性があります。api.php を最新版に更新してください。');
    }
  }).catch(function(e) {
    statusEl.textContent = '登録に失敗しました';
    alert('登録に失敗しました（通信エラー）: ' + e.message);
  });
}

function exportKensaExcel() {
  var y = parseInt(document.getElementById('kensa-year').value);
  var m = parseInt(document.getElementById('kensa-month').value);
  var days = daysInMonth(y, m);
  var sat = 'background:#e8eaf6;';
  var sun = 'background:#fce4ec;';
  var hol = 'background:#fff8e1;';
  var th = 'border:1px solid #000;padding:3px 8px;text-align:center;font-weight:bold;background:#f0f0f0;';
  var td = 'border:1px solid #000;padding:3px 8px;text-align:center;';
  var tdL = 'border:1px solid #000;padding:3px 8px;text-align:left;';
  function doctorName(sid) {
    if (!sid) return '';
    var s = getStaffById(sid);
    return s ? s.name : sid;
  }
  var html = '<table border="1" style="border-collapse:collapse;font-size:11px">';
  html += '<tr><td colspan="6" style="font-size:16px;font-weight:bold;text-align:center;padding:8px;border:none">'+y+'年　'+m+'月　　検査食割り当て表</td></tr>';
  html += '<tr>';
  html += '<td style="'+th+'">日</td><td style="'+th+'">曜日</td>';
  html += '<td style="'+th+'">検査朝</td><td style="'+th+'">検査昼</td><td style="'+th+'">検査夕</td>';
  html += '<td style="'+th+'">備考</td>';
  html += '</tr>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var ds = y+'-'+pad(m)+'-'+pad(d);
    var hName = getHolidayName(ds);
    var bg = '';
    if (hName) bg = hol; else if (dow===0) bg = sun; else if (dow===6) bg = sat;
    html += '<tr>';
    html += '<td style="'+td+bg+'">'+d+'</td>';
    html += '<td style="'+td+bg+'">'+WEEKDAYS[dow]+'</td>';
    html += '<td style="'+td+bg+'">'+esc(doctorName(getKensaAssign(y, m, d, 'b')))+'</td>';
    html += '<td style="'+td+bg+'">'+esc(doctorName(getKensaAssign(y, m, d, 'l')))+'</td>';
    html += '<td style="'+td+bg+'">'+esc(doctorName(getKensaAssign(y, m, d, 'd')))+'</td>';
    html += '<td style="'+tdL+bg+'">'+esc(hName||'')+'</td>';
    html += '</tr>';
  }
  html += '</table>';
  html += '<br>';
  html += '<table border="1" style="border-collapse:collapse;font-size:11px">';
  html += '<tr><td colspan="7" style="font-weight:bold;padding:4px;border:none">医師別 検査食集計</td></tr>';
  html += '<tr>';
  html += '<td style="'+th+'">職員ID</td><td style="'+th+'">氏名</td><td style="'+th+'">部署</td>';
  html += '<td style="'+th+'">検査朝</td><td style="'+th+'">検査昼</td><td style="'+th+'">検査夕</td><td style="'+th+'">合計</td>';
  html += '</tr>';
  var stats = getKensaDoctorStats(y, m);
  var ids = Object.keys(stats).sort();
  var sumB=0, sumL=0, sumD=0;
  for (var i=0; i<ids.length; i++) {
    var st = stats[ids[i]];
    var s = getStaffById(ids[i]);
    html += '<tr>';
    html += '<td style="'+tdL+'">'+esc(ids[i])+'</td>';
    html += '<td style="'+tdL+'">'+esc(s?s.name:'')+'</td>';
    html += '<td style="'+tdL+'">'+esc(s?s.dept:'')+'</td>';
    html += '<td style="'+td+'">'+st.b+'</td><td style="'+td+'">'+st.l+'</td><td style="'+td+'">'+st.d+'</td>';
    html += '<td style="'+td+'font-weight:bold">'+(st.b+st.l+st.d)+'</td>';
    html += '</tr>';
    sumB+=st.b; sumL+=st.l; sumD+=st.d;
  }
  html += '<tr>';
  html += '<td colspan="3" style="'+th+'">合計</td>';
  html += '<td style="'+th+'">'+sumB+'</td><td style="'+th+'">'+sumL+'</td><td style="'+th+'">'+sumD+'</td>';
  html += '<td style="'+th+'">'+(sumB+sumL+sumD)+'</td>';
  html += '</tr>';
  html += '</table>';
  downloadXls(xlsWrap('検査食割り当て', html), '検査食割り当て表_'+y+'年'+pad(m)+'月.xls');
  showToast('検査食割り当て表Excelを出力しました');
}

function renderKensaSummary(y, m) {
  var tb = document.getElementById('kensa-summary-list');
  var stats = getKensaDoctorStats(y, m);
  var ids = Object.keys(stats).sort();
  if (ids.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999">割り当てなし</td></tr>';
    return;
  }
  var html = '';
  for (var i=0; i<ids.length; i++) {
    var st = stats[ids[i]];
    var s = getStaffById(ids[i]);
    html += '<tr><td>'+esc(ids[i])+'</td><td>'+esc(s?s.name:'')+'</td><td>'+esc(s?s.dept:'')+'</td>';
    html += '<td>'+st.b+'</td><td>'+st.l+'</td><td>'+st.d+'</td><td>'+(st.b+st.l+st.d)+'</td></tr>';
  }
  tb.innerHTML = html;
}

function runDetailReport() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var days = daysInMonth(y, m);
  var sorted = getStaffSorted();
  var staffWithOrders = [];
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    var hasOrder = false;
    var totals = {b:0,l:0,d:0,dd:0};
    for (var d=1; d<=days; d++) {
      var o = getOrder(s.id, y, m, d);
      if (o.b) { totals.b++; hasOrder=true; }
      if (o.l) { totals.l++; hasOrder=true; }
      if (o.d) { totals.d++; hasOrder=true; }
      if (o.dd) { totals.dd++; hasOrder=true; }
    }
    if (hasOrder) staffWithOrders.push({staff:s, totals:totals});
  }
  if (staffWithOrders.length === 0) {
    document.getElementById('rpt-result').innerHTML = '<p style="text-align:center;color:#999;padding:20px">注文データがありません</p>';
    return;
  }
  var html = '<div class="rpt-section"><h3>'+y+'年'+m+'月 全注文者一覧（'+staffWithOrders.length+'名）</h3>';
  html += '<div style="overflow-x:auto"><table class="rpt-table rpt-detail-table"><thead><tr>';
  html += '<th rowspan="2">ID</th><th rowspan="2">氏名</th><th rowspan="2">部署</th>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    html += '<th colspan="4" style="border-bottom:none;';
    if (dow===0) html += 'background:#fce4ec;';
    else if (dow===6) html += 'background:#e8eaf6;';
    else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) html += 'background:#fff8e1;';
    html += '">'+d+'<br><span style="font-size:0.7rem">'+WEEKDAYS[dow]+'</span></th>';
  }
  html += '<th colspan="4" style="border-bottom:none;">合計</th>';
  html += '</tr><tr>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var bg = '';
    if (dow===0) bg = 'background:#fce4ec;';
    else if (dow===6) bg = 'background:#e8eaf6;';
    else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) bg = 'background:#fff8e1;';
    html += '<th style="font-size:0.65rem;padding:2px;'+bg+'">朝</th>';
    html += '<th style="font-size:0.65rem;padding:2px;'+bg+'">昼</th>';
    html += '<th style="font-size:0.65rem;padding:2px;'+bg+'">夕</th>';
    html += '<th style="font-size:0.65rem;padding:2px;'+bg+'">医</th>';
  }
  html += '<th style="font-size:0.65rem;padding:2px;">朝</th>';
  html += '<th style="font-size:0.65rem;padding:2px;">昼</th>';
  html += '<th style="font-size:0.65rem;padding:2px;">夕</th>';
  html += '<th style="font-size:0.65rem;padding:2px;">医</th>';
  html += '</tr></thead><tbody>';
  for (var i=0; i<staffWithOrders.length; i++) {
    var sw = staffWithOrders[i];
    var s = sw.staff;
    html += '<tr>';
    html += '<td style="text-align:left;white-space:nowrap">'+esc(s.id)+'</td>';
    html += '<td style="text-align:left;white-space:nowrap">'+esc(s.name)+'</td>';
    html += '<td style="text-align:left;white-space:nowrap">'+esc(s.dept)+'</td>';
    for (var d=1; d<=days; d++) {
      var o = getOrder(s.id, y, m, d);
      var dow = dayOfWeek(y,m,d);
      var bg = '';
      if (dow===0) bg = 'background:#fce4ec;';
      else if (dow===6) bg = 'background:#e8eaf6;';
      else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) bg = 'background:#fff8e1;';
      html += '<td style="text-align:center;padding:2px;'+bg+'">'+(o.b?'○':'')+'</td>';
      html += '<td style="text-align:center;padding:2px;'+bg+'">'+(o.l?'○':'')+'</td>';
      html += '<td style="text-align:center;padding:2px;'+bg+'">'+(o.d?'○':'')+'</td>';
      html += '<td style="text-align:center;padding:2px;'+bg+'">'+(o.dd?'○':'')+'</td>';
    }
    html += '<td style="text-align:center;font-weight:bold">'+sw.totals.b+'</td>';
    html += '<td style="text-align:center;font-weight:bold">'+sw.totals.l+'</td>';
    html += '<td style="text-align:center;font-weight:bold">'+sw.totals.d+'</td>';
    html += '<td style="text-align:center;font-weight:bold">'+sw.totals.dd+'</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  document.getElementById('rpt-result').innerHTML = html;
}

function exportDetailExcel() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var days = daysInMonth(y, m);
  var sorted = getStaffSorted();
  var staffWithOrders = [];
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    var hasOrder = false;
    var totals = {b:0,l:0,d:0,dd:0};
    var perDay = [];
    for (var d=1; d<=days; d++) {
      var o = getOrder(s.id, y, m, d);
      perDay.push(o);
      if (o.b) { totals.b++; hasOrder=true; }
      if (o.l) { totals.l++; hasOrder=true; }
      if (o.d) { totals.d++; hasOrder=true; }
      if (o.dd) { totals.dd++; hasOrder=true; }
    }
    if (hasOrder) staffWithOrders.push({staff:s, totals:totals, perDay:perDay});
  }
  if (staffWithOrders.length === 0) {
    showToast('注文データがありません');
    return;
  }
  var sat = 'background:#e8eaf6;';
  var sun = 'background:#fce4ec;';
  var hol = 'background:#fff8e1;';
  var th = 'border:1px solid #999;padding:2px 4px;text-align:center;font-weight:bold;background:#f0f0f0;';
  var td = 'border:1px solid #999;padding:2px 4px;text-align:center;';
  var tdL = 'border:1px solid #999;padding:2px 4px;text-align:left;';
  var tdB = 'border:1px solid #999;padding:2px 4px;text-align:center;font-weight:bold;';
  var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">';
  html += '<head><meta charset="UTF-8">';
  html += '<xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>';
  html += '<x:Name>'+y+'年'+m+'月注文一覧</x:Name>';
  html += '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>';
  html += '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml>';
  html += '</head><body>';
  html += '<table border="1" style="border-collapse:collapse;font-size:10px">';
  html += '<tr><td colspan="'+(3+days*4+4)+'" style="font-size:14px;font-weight:bold;padding:6px">'+y+'年'+m+'月 全注文者一覧（'+staffWithOrders.length+'名）</td></tr>';
  html += '<tr>';
  html += '<td rowspan="2" style="'+th+'">ID</td>';
  html += '<td rowspan="2" style="'+th+'">氏名</td>';
  html += '<td rowspan="2" style="'+th+'">部署</td>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var bg = '';
    if (dow===0) bg = sun;
    else if (dow===6) bg = sat;
    else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) bg = hol;
    html += '<td colspan="4" style="'+th+bg+'">'+d+'日('+WEEKDAYS[dow]+')</td>';
  }
  html += '<td colspan="4" style="'+th+'">合計</td>';
  html += '</tr>';
  html += '<tr>';
  for (var d=1; d<=days; d++) {
    var dow = dayOfWeek(y,m,d);
    var bg = '';
    if (dow===0) bg = sun;
    else if (dow===6) bg = sat;
    else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) bg = hol;
    html += '<td style="'+th+bg+'">朝</td>';
    html += '<td style="'+th+bg+'">昼</td>';
    html += '<td style="'+th+bg+'">夕</td>';
    html += '<td style="'+th+bg+'">医</td>';
  }
  html += '<td style="'+th+'">朝</td>';
  html += '<td style="'+th+'">昼</td>';
  html += '<td style="'+th+'">夕</td>';
  html += '<td style="'+th+'">医</td>';
  html += '</tr>';
  for (var i=0; i<staffWithOrders.length; i++) {
    var sw = staffWithOrders[i];
    var s = sw.staff;
    html += '<tr>';
    html += '<td style="'+tdL+'">'+esc(s.id)+'</td>';
    html += '<td style="'+tdL+'">'+esc(s.name)+'</td>';
    html += '<td style="'+tdL+'">'+esc(s.dept)+'</td>';
    for (var d=1; d<=days; d++) {
      var o = sw.perDay[d-1];
      var dow = dayOfWeek(y,m,d);
      var bg = '';
      if (dow===0) bg = sun;
      else if (dow===6) bg = sat;
      else if (getHolidayName(y+'-'+pad(m)+'-'+pad(d))) bg = hol;
      html += '<td style="'+td+bg+'">'+(o.b?'○':'')+'</td>';
      html += '<td style="'+td+bg+'">'+(o.l?'○':'')+'</td>';
      html += '<td style="'+td+bg+'">'+(o.d?'○':'')+'</td>';
      html += '<td style="'+td+bg+'">'+(o.dd?'○':'')+'</td>';
    }
    html += '<td style="'+tdB+'">'+sw.totals.b+'</td>';
    html += '<td style="'+tdB+'">'+sw.totals.l+'</td>';
    html += '<td style="'+tdB+'">'+sw.totals.d+'</td>';
    html += '<td style="'+tdB+'">'+sw.totals.dd+'</td>';
    html += '</tr>';
  }
  html += '</table></body></html>';
  var blob = new Blob(['﻿' + html], {type: 'application/vnd.ms-excel'});
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = '注文者一覧_'+y+'年'+pad(m)+'月.xls';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Excelファイルを出力しました');
}

function exportReportCSV() {
  var y = parseInt(document.getElementById('rpt-year').value);
  var m = parseInt(document.getElementById('rpt-month').value);
  var days = daysInMonth(y, m);
  var sorted = getStaffSorted();
  var csv = '﻿職員ID,氏名,部署,朝食,昼食,夕食,夕食医師,合計\n';
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    var t = {b:0,l:0,d:0,dd:0};
    for (var d=1; d<=days; d++) {
      var o = getOrder(s.id, y, m, d);
      if (o.b) t.b++; if (o.l) t.l++; if (o.d) t.d++; if (o.dd) t.dd++;
    }
    var total = t.b + t.l + t.d + t.dd;
    if (total === 0) continue;
    csv += '"'+s.id.replace(/"/g,'""')+'","'+s.name.replace(/"/g,'""')+'","'+s.dept.replace(/"/g,'""')+'",';
    csv += t.b+','+t.l+','+t.d+','+t.dd+','+total+'\n';
  }
  downloadFile(csv, '月間注文集計_'+y+'年'+pad(m)+'月.csv', 'text/csv;charset=utf-8');
  showToast('CSVを出力しました');
}

// ==================== HISTORY TAB ====================
function renderHistory() {
  populateHistoryFilters();
  var dateF = document.getElementById('hist-date-filter').value;
  var staffF = document.getElementById('hist-staff-filter').value;
  var actionF = document.getElementById('hist-action-filter').value;
  var tb = document.getElementById('history-list');
  if (!dateF) {
    tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#999">日付を指定してください</td></tr>';
    return;
  }
  var html = '';
  var count = 0;
  for (var i=0; i<opHistory.length; i++) {
    var h = opHistory[i];
    var hDateRaw = h.timestamp ? h.timestamp.split(' ')[0] : '';
    var hParts = hDateRaw.split('/');
    var hDate = hParts.length === 3 ? hParts[0]+'-'+pad(parseInt(hParts[1]))+'-'+pad(parseInt(hParts[2])) : hDateRaw.replace(/\//g, '-');
    if (dateF !== hDate) continue;
    if (staffF && h.staffId !== staffF) continue;
    if (actionF && h.action !== actionF) continue;
    html += '<tr>';
    html += '<td style="white-space:nowrap">'+esc(h.timestamp)+'</td>';
    html += '<td>'+esc(h.staffId)+' '+esc(h.staffName)+'</td>';
    html += '<td>'+esc(h.yearMonth)+'</td>';
    html += '<td>'+esc(h.action)+'</td>';
    html += '<td>'+esc(h.detail)+'</td>';
    html += '</tr>';
    count++;
  }
  if (!html) html = '<tr><td colspan="5" style="text-align:center;color:#999">該当する履歴なし</td></tr>';
  tb.innerHTML = html;
}

function populateHistoryFilters() {
  var staffSel = document.getElementById('hist-staff-filter');
  var curStaff = staffSel.value;
  var staffIds = {};
  for (var i=0; i<opHistory.length; i++) {
    staffIds[opHistory[i].staffId] = opHistory[i].staffName;
  }
  staffSel.innerHTML = '<option value="">全職員</option>';
  Object.keys(staffIds).sort().forEach(function(id) {
    var o = document.createElement('option'); o.value=id; o.textContent=id+' '+staffIds[id]; staffSel.appendChild(o);
  });
  staffSel.value = curStaff;
}

function clearHistory() {
  fetch(API_URL + '?key=config').then(function(r) { return r.json(); }).then(function(serverConfig) {
    config = serverConfig || {};
    var savedPw = getEditPassword();
    if (savedPw) {
      var input = prompt('管理者パスワードを入力してください');
      if (input === null) return;
      if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
    }
    if (!confirm('履歴を全て削除しますか？')) return;
    opHistory = [];
    saveHistory();
    renderHistory();
    showToast('履歴を削除しました');
  }).catch(function() {
    showToast('サーバーとの通信に失敗しました');
  });
}

// ==================== HOLIDAY TAB ====================
function renderHolidayList() {
  var yearFilter = document.getElementById('holiday-year-filter');
  if (yearFilter.options.length===0) {
    var now = new Date();
    for (var y=now.getFullYear()-1; y<=now.getFullYear()+3; y++) {
      var opt = document.createElement('option'); opt.value=y; opt.textContent=y+'年'; yearFilter.appendChild(opt);
    }
    yearFilter.value = now.getFullYear();
  }
  var fy = yearFilter.value;
  var sorted = holidays.slice().sort(function(a,b) { return a.date<b.date?-1:a.date>b.date?1:0; });
  var tb = document.getElementById('holiday-list');
  var html = '';
  for (var i=0; i<sorted.length; i++) {
    var h = sorted[i];
    if (h.date.substring(0,4) !== fy) continue;
    var parts = h.date.split('-');
    var dow = dayOfWeek(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
    html += '<tr><td>'+h.date+'</td><td>'+WEEKDAYS[dow]+'</td><td>'+esc(h.name)+'</td>';
    html += '<td><button class="btn-del" onclick="deleteHoliday(\''+h.date+'\')">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="4" style="text-align:center;color:#999">データなし</td></tr>';
  tb.innerHTML = html;
}

function submitHoliday(e) {
  e.preventDefault();
  var date = document.getElementById('hf-date').value;
  var name = document.getElementById('hf-name').value.trim();
  if (!date||!name) return;
  if (isHoliday(date)) { showToast('この日付は既に登録されています'); return; }
  holidays.push({date:date, name:name});
  saveHolidays();
  document.getElementById('holiday-form').reset();
  renderHolidayList();
  showToast('休日を登録しました');
}

function deleteHoliday(date) {
  holidays = holidays.filter(function(h){return h.date!==date;});
  saveHolidays(); renderHolidayList();
  showToast('削除しました');
}

function initHolidays() {
  if (!confirm('2026-2028年の祝日データ（'+DEFAULT_HOLIDAYS.length+'件）を追加します。\n既存データと重複する日付はスキップされます。')) return;
  var added = 0;
  for (var i=0; i<DEFAULT_HOLIDAYS.length; i++) {
    if (!isHoliday(DEFAULT_HOLIDAYS[i].date)) {
      holidays.push({date:DEFAULT_HOLIDAYS[i].date, name:DEFAULT_HOLIDAYS[i].name});
      added++;
    }
  }
  saveHolidays(); renderHolidayList();
  showToast(added+'件追加しました');
}

// ==================== CHILDREN MANAGEMENT ====================
function populateChildStaff() {
  var sel = document.getElementById('child-staff');
  var cur = sel.value;
  var search = (document.getElementById('child-staff-search').value || '').toLowerCase().trim();
  sel.innerHTML = '<option value="">-- 選択 --</option>';
  var sorted = getStaffSorted();
  var firstMatchId = '';
  var exactMatchId = '';
  var matchCount = 0;
  for (var i=0; i<sorted.length; i++) {
    var s = sorted[i];
    if (search && s.id.toLowerCase().indexOf(search)===-1 && s.name.toLowerCase().indexOf(search)===-1 && s.dept.toLowerCase().indexOf(search)===-1) continue;
    var o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.id + ' ' + s.name + '（' + s.dept + '）';
    sel.appendChild(o);
    matchCount++;
    if (!firstMatchId) firstMatchId = s.id;
    if (search && s.id.toLowerCase() === search) exactMatchId = s.id;
  }
  if (exactMatchId) {
    sel.value = exactMatchId;
  } else if (cur && matchCount > 0 && sel.querySelector('option[value="'+CSS.escape(cur)+'"]')) {
    sel.value = cur;
  } else if (search && matchCount === 1) {
    sel.value = firstMatchId;
  }
}

function renderChildList() {
  var tb = document.getElementById('child-list');
  var html = '';
  var sorted = children.slice().sort(function(a,b) {
    if (a.staffId < b.staffId) return -1; if (a.staffId > b.staffId) return 1;
    return 0;
  });
  for (var i=0; i<sorted.length; i++) {
    var c = sorted[i];
    var s = getStaffById(c.staffId);
    var pName = s ? s.name+'('+c.staffId+')' : c.staffId;
    html += '<tr><td>'+esc(c.name)+'</td><td>'+esc(pName)+'</td>';
    html += '<td><button class="btn-del" onclick="deleteChild(\''+esc(c.id)+'\')">削除</button></td></tr>';
  }
  if (!html) html = '<tr><td colspan="3" style="text-align:center;color:#999">子供の登録なし</td></tr>';
  tb.innerHTML = html;
}

function submitChild(e) {
  e.preventDefault();
  var staffId = document.getElementById('child-staff').value;
  if (!staffId) { showToast('職員を選択してください'); return; }
  var name = document.getElementById('cf-name').value.trim();
  if (!name) return;
  var id = 'C' + Date.now();
  children.push({id: id, staffId: staffId, name: name});
  saveChildren();
  document.getElementById('cf-name').value = '';
  renderChildList();
  renderStaffList();
  showToast(name + 'を登録しました');
}

function deleteChild(childId) {
  var c = null;
  for (var i=0; i<children.length; i++) { if (children[i].id===childId) { c=children[i]; break; } }
  if (!c) return;
  if (!confirm(c.name + 'を削除しますか？')) return;
  children = children.filter(function(x){return x.id!==childId;});
  saveChildren();
  renderChildList();
  renderStaffList();
  showToast('削除しました');
}

// ==================== DATA MANAGEMENT ====================
function updatePwStatus() {
  var el = document.getElementById('pw-status');
  if (getEditPassword()) {
    el.textContent = '※ パスワードが設定されています。確定済み注文の修正時にパスワード入力が必要です。';
    el.style.color = '#28a745';
  } else {
    el.textContent = '※ パスワード未設定。誰でも確定済み注文を修正できます。';
    el.style.color = '#dc3545';
  }
}

function dataExport() {
  var data = { staff: staffList, orders: orders, holidays: holidays, history: opHistory, children: children, config: config, confirmed: confirmed, kensa: kensa, exportDate: fmtDate(new Date()) };
  var json = JSON.stringify(data, null, 2);
  downloadFile(json, '給食管理データ_'+fmtDate(new Date())+'.json', 'application/json');
  showToast('エクスポートしました');
}

function dataImport() {
  var fileInput = document.getElementById('data-import-file');
  if (!fileInput.files.length) { showToast('ファイルを選択してください'); return; }
  if (!confirm('現在のデータは全て上書きされます。よろしいですか？')) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (data.staff) staffList = data.staff;
      if (data.orders) orders = data.orders;
      if (data.holidays) holidays = data.holidays;
      if (data.history) opHistory = data.history;
      if (data.children) children = data.children;
      if (data.config) config = data.config;
      if (data.confirmed) confirmed = data.confirmed;
      if (data.kensa) kensa = data.kensa;
      saveStaff(); saveOrders(); saveHolidays(); saveHistory(); saveChildren(); saveConfig(); saveConfirmed(); saveKensa();
      showToast('インポートしました');
      showTab('today');
    } catch(ex) { showToast('ファイル形式が不正です'); }
  };
  reader.readAsText(fileInput.files[0], 'UTF-8');
}

function dataClear() {
  if (!confirm('全データを削除します。この操作は元に戻せません。\n本当に削除しますか？')) return;
  staffList=[]; orders={}; holidays=[]; opHistory=[]; children=[]; config={}; confirmed={}; kensa={};
  saveStaff(); saveOrders(); saveHolidays(); saveHistory(); saveChildren(); saveConfig(); saveConfirmed(); saveKensa();
  showToast('全データを削除しました');
  showTab('today');
}

// ==================== ADMIN MODE ====================
function toggleAdmin() {
  if (adminMode) {
    adminMode = false;
    applyAdminMode();
    showTab('today');
    showToast('管理者モードを解除しました');
    return;
  }
  fetch(API_URL + '?key=config').then(function(r) { return r.json(); }).then(function(serverConfig) {
    config = serverConfig || {};
    var savedPw = getEditPassword();
    if (savedPw) {
      var input = prompt('管理者パスワードを入力してください');
      if (input === null) return;
      if (input !== savedPw) { showToast('パスワードが正しくありません'); return; }
    }
    adminMode = true;
    applyAdminMode();
    showToast('管理者モードに入りました');
  }).catch(function() {
    showToast('サーバーとの通信に失敗しました');
  });
}

function applyAdminMode() {
  var els = document.querySelectorAll('.admin-only');
  for (var i = 0; i < els.length; i++) {
    els[i].style.display = adminMode ? '' : 'none';
  }
  var btn = document.getElementById('admin-toggle');
  if (adminMode) {
    btn.textContent = '管理者モード解除';
    btn.classList.add('active-admin');
  } else {
    btn.textContent = '管理者';
    btn.classList.remove('active-admin');
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
  loadData().then(function() {
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
      if (btn.id === 'admin-toggle') return;
      btn.addEventListener('click', function() { showTab(this.getAttribute('data-tab')); });
    });
    document.getElementById('admin-toggle').addEventListener('click', toggleAdmin);

    var todayInput = document.getElementById('today-date');
    todayInput.value = fmtDate(new Date());
    todayInput.addEventListener('change', renderToday);
    document.getElementById('today-prev').addEventListener('click', function() {
      var d = new Date(todayInput.value); d.setDate(d.getDate()-1); todayInput.value=fmtDate(d); renderToday();
    });
    document.getElementById('today-next').addEventListener('click', function() {
      var d = new Date(todayInput.value); d.setDate(d.getDate()+1); todayInput.value=fmtDate(d); renderToday();
    });
    document.getElementById('today-reset').addEventListener('click', function() {
      todayInput.value = fmtDate(new Date()); renderToday();
    });

    document.getElementById('staff-form').addEventListener('submit', submitStaff);
    document.getElementById('sf-cancel').addEventListener('click', cancelEditStaff);
    document.getElementById('staff-search').addEventListener('input', renderStaffList);
    document.getElementById('csv-import').addEventListener('click', importCSV);
    document.getElementById('csv-export').addEventListener('click', exportCSV);
    document.getElementById('child-staff-search').addEventListener('input', populateChildStaff);
    document.getElementById('child-staff').addEventListener('change', renderChildList);
    document.getElementById('child-form').addEventListener('submit', submitChild);

    document.getElementById('order-year').addEventListener('change', renderOrderGrid);
    document.getElementById('order-month').addEventListener('change', renderOrderGrid);
    document.getElementById('order-dept').addEventListener('change', populateOrderStaff);
    document.getElementById('order-staff').addEventListener('change', renderOrderGrid);
    document.getElementById('order-prev-staff').addEventListener('click', function(){navigateStaff(-1);});
    document.getElementById('order-next-staff').addEventListener('click', function(){navigateStaff(1);});
    document.getElementById('bulk-weekday-b').addEventListener('click', function(){bulkSetWeekday('b');});
    document.getElementById('bulk-weekday-l').addEventListener('click', function(){bulkSetWeekday('l');});
    document.getElementById('bulk-weekday-d').addEventListener('click', function(){bulkSetWeekday('d');});
    document.getElementById('bulk-weekday-dd').addEventListener('click', function(){bulkSetWeekday('dd');});
    document.getElementById('bulk-copy-prev').addEventListener('click', bulkCopyPrev);
    document.getElementById('bulk-clear').addEventListener('click', bulkClear);
    document.getElementById('order-confirm').addEventListener('click', confirmOrder);
    document.getElementById('order-edit').addEventListener('click', editOrder);

    document.getElementById('rpt-run').addEventListener('click', runReport);
    document.getElementById('rpt-detail').addEventListener('click', runDetailReport);
    document.getElementById('rpt-detail-excel').addEventListener('click', exportDetailExcel);
    document.getElementById('rpt-kensa-csv').addEventListener('click', exportKensaCSV);
    document.getElementById('rpt-soumu-excel').addEventListener('click', exportSoumuExcel);
    document.getElementById('rpt-eiyou-excel').addEventListener('click', exportEiyouExcel);
    document.getElementById('kensa-year').addEventListener('change', renderKensaGrid);
    document.getElementById('kensa-month').addEventListener('change', renderKensaGrid);
    document.getElementById('kensa-save').addEventListener('click', saveKensaMonth);
    document.getElementById('kensa-excel').addEventListener('click', exportKensaExcel);
    document.getElementById('rpt-csv').addEventListener('click', exportReportCSV);
    document.getElementById('rpt-print').addEventListener('click', function(){window.print();});

    var histDateInput = document.getElementById('hist-date-filter');
    histDateInput.value = fmtDate(new Date());
    histDateInput.addEventListener('change', renderHistory);
    document.getElementById('hist-staff-filter').addEventListener('change', renderHistory);
    document.getElementById('hist-action-filter').addEventListener('change', renderHistory);
    document.getElementById('hist-clear').addEventListener('click', clearHistory);

    document.getElementById('holiday-form').addEventListener('submit', submitHoliday);
    document.getElementById('holiday-init').addEventListener('click', initHolidays);
    document.getElementById('holiday-year-filter').addEventListener('change', renderHolidayList);

    document.getElementById('pw-save').addEventListener('click', function() {
      var pw = document.getElementById('pw-input').value;
      if (!pw) { showToast('パスワードを入力してください'); return; }
      setEditPassword(pw);
      document.getElementById('pw-input').value = '';
      updatePwStatus();
      showToast('パスワードを設定しました');
    });
    document.getElementById('pw-clear').addEventListener('click', function() {
      if (!confirm('パスワードを解除しますか？')) return;
      setEditPassword('');
      updatePwStatus();
      showToast('パスワードを解除しました');
    });
    updatePwStatus();

    document.getElementById('data-export').addEventListener('click', dataExport);
    document.getElementById('data-import').addEventListener('click', dataImport);
    document.getElementById('data-clear').addEventListener('click', dataClear);

    renderToday();
  }).catch(function(err) {
    document.getElementById('toast').textContent = 'データ読み込みエラー: ' + err.message;
    document.getElementById('toast').classList.add('show');
    document.getElementById('toast').style.opacity = '1';
  });
});
