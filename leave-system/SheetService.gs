/**
 * All reads/writes to the backing Google Sheet.
 *
 * ความเร็ว: การเปิดสเปรดชีตและอ่านทั้งชีตคือส่วนที่ช้าที่สุดของ Apps Script จึงใช้ 3 อย่างนี้
 *  1) CacheService — เก็บข้อมูลพนักงานรายคน / ประวัติการลารายคน / รายการรออนุมัติ
 *     และล้างทิ้งทันทีเมื่อสคริปต์เขียนข้อมูลนั้น (แก้ชีตด้วยมือ → onEdit ล้างให้ใน Setup.gs)
 *  2) TextFinder — หาแถวเดียวที่ต้องการ แทนการอ่านทั้งชีต
 *  3) อ่านชีตใบลาทั้งชีตได้ไม่เกิน 1 ครั้งต่อคำขอ (memo_)
 */

const CACHE_TTL_EMPLOYEE = 600;   // วินาที
const CACHE_TTL_REQUESTS = 600;
const CACHE_KEY_PENDING = 'pending_all';

// เก็บผลที่อ่านแล้วไว้ใช้ซ้ำภายในคำขอเดียวกัน (ตัวแปร global ของ Apps Script อยู่แค่ 1 execution)
const memo_ = {};

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต: ' + name + ' กรุณารันฟังก์ชัน setupSpreadsheet() ก่อน');
  return sheet;
}

function cacheGetJson_(key) {
  const hit = CacheService.getScriptCache().get(key);
  return hit ? JSON.parse(hit) : null;
}

function cachePutJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds);
  } catch (e) {
    // เกิน 100KB ต่อ key — ข้ามการ cache ไป ระบบยังทำงานได้แค่ช้าลง
    console.warn('cache put skipped [' + key + ']: ' + e.message);
  }
}

// อ่านชีตแบบมี cache — ใช้กับข้อมูลที่นานๆ เปลี่ยนที (ประเภทลา/แผนก/HR)
function cachedSheetObjects_(sheetName, seconds) {
  const key = 'sheet_' + sheetName;
  const hit = cacheGetJson_(key);
  if (hit) return hit;
  const rows = sheetToObjects_(getSheet_(sheetName));
  cachePutJson_(key, rows, seconds);
  return rows;
}

function clearSheetCache_() {
  CacheService.getScriptCache().removeAll(
    [SHEET_LEAVE_TYPES, SHEET_DEPARTMENTS, SHEET_HR].map(n => 'sheet_' + n));
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    rows.push(rowToObject_(headers, values[r]));
  }
  return rows;
}

function rowToObject_(headers, rowValues) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = rowValues[i]; });
  return obj;
}

function headersOf_(sheet) {
  const key = 'headers_' + sheet.getName();
  if (!memo_[key]) memo_[key] = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return memo_[key];
}

// หาแถวด้วย TextFinder ในคอลัมน์เดียว — ไม่ต้องดึงทั้งคอลัมน์มาวนหาเอง
function findRowIndexByValue_(sheet, columnHeader, value) {
  if (value === '' || value === null || value === undefined) return -1;
  const col = headersOf_(sheet).indexOf(columnHeader) + 1;
  const lastRow = sheet.getLastRow();
  if (col === 0 || lastRow < 2) return -1;
  const cell = sheet.getRange(2, col, lastRow - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();
  return cell ? cell.getRow() : -1;
}

function readRowObject_(sheet, rowIndex) {
  const headers = headersOf_(sheet);
  const values = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  return rowToObject_(headers, values);
}

// งานเขียนที่อาจชนกัน (เพิ่มแถว/แก้แถว/ย้ายไป Archive) ต้องเข้าคิวกันทีละงาน
function withScriptLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- Employees ----------

function employeeCacheKey_(lineUserId) {
  return 'emp_' + lineUserId;
}

function clearEmployeeCache_(lineUserId) {
  if (lineUserId) CacheService.getScriptCache().remove(employeeCacheKey_(lineUserId));
}

function getEmployee_(lineUserId) {
  if (!lineUserId) return null;
  const key = employeeCacheKey_(lineUserId);
  const hit = cacheGetJson_(key);
  if (hit) return hit;

  const sheet = getSheet_(SHEET_EMPLOYEES);
  const rowIndex = findRowIndexByValue_(sheet, 'LineUserId', lineUserId);
  if (rowIndex < 0) return null; // ยังไม่ลงทะเบียน — ไม่ cache เพื่อให้ลงทะเบียนแล้วเห็นผลทันที

  const employee = readRowObject_(sheet, rowIndex);
  cachePutJson_(key, employee, CACHE_TTL_EMPLOYEE);
  return employee;
}

function upsertEmployee_(profile, department, employeeCode) {
  const existing = getEmployee_(profile.userId);
  if (existing) return existing;

  const defaults = DEFAULT_LEAVE_TYPES.reduce((acc, t) => {
    acc[t.balanceField] = t.defaultDays;
    return acc;
  }, {});

  const row = EMPLOYEES_HEADERS.map(h => {
    if (h === 'LineUserId') return profile.userId;
    if (h === 'Name') return profile.displayName;
    if (h === 'Department') return department;
    if (h === 'PictureUrl') return profile.pictureUrl || '';
    if (h === 'RegisteredAt') return new Date();
    if (h === 'EmployeeCode') return employeeCode || '';
    if (h in defaults) return defaults[h];
    return '';
  });
  withScriptLock_(() => getSheet_(SHEET_EMPLOYEES).appendRow(row));
  clearEmployeeCache_(profile.userId);
  return getEmployee_(profile.userId);
}

function adjustEmployeeBalance_(lineUserId, balanceField, delta) {
  withScriptLock_(() => {
    const sheet = getSheet_(SHEET_EMPLOYEES);
    const rowIndex = findRowIndexByValue_(sheet, 'LineUserId', lineUserId);
    if (rowIndex < 0) return;
    const col = headersOf_(sheet).indexOf(balanceField) + 1;
    if (col === 0) return;
    const cell = sheet.getRange(rowIndex, col);
    const current = Number(cell.getValue()) || 0;
    cell.setValue(current + delta);
  });
  clearEmployeeCache_(lineUserId);
}

// ---------- Departments ----------

function getDepartments_() {
  return cachedSheetObjects_(SHEET_DEPARTMENTS, 120);
}

function getApproverForDepartment_(department) {
  const dept = getDepartments_().find(d => d.Department === department);
  if (!dept || !dept.ApproverLineUserId) return null;
  return { lineUserId: dept.ApproverLineUserId, name: dept.ApproverName };
}

function isApprover_(lineUserId) {
  return getDepartments_().some(d => d.ApproverLineUserId === lineUserId);
}

function getDepartmentsManagedBy_(lineUserId) {
  return getDepartments_()
    .filter(d => d.ApproverLineUserId === lineUserId)
    .map(d => d.Department);
}

// ---------- HR (ผู้อนุมัติขั้นที่ 2) ----------

function getHrApprovers_() {
  return cachedSheetObjects_(SHEET_HR, 120)
    .filter(r => r.LineUserId && String(r.LineUserId).indexOf('(') !== 0); // ข้ามแถวตัวอย่าง
}

function isHr_(lineUserId) {
  return getHrApprovers_().some(r => r.LineUserId === lineUserId);
}

// ---------- Leave Types ----------

function getLeaveTypes_() {
  const rows = cachedSheetObjects_(SHEET_LEAVE_TYPES, 300);
  return rows.map(r => ({
    key: r.TypeKey,
    name: r.TypeName,
    color: r.Color,
    defaultDays: r.DefaultDays,
    balanceField: r.BalanceField
  }));
}

// ---------- Leave Requests ----------

// วันทำการ = จันทร์-เสาร์ (หยุดเฉพาะวันอาทิตย์)
function calcBusinessDays_(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let days = 0;
  const d = new Date(start);
  while (d <= end) {
    if (d.getDay() !== 0) days++;
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function calcLeaveDays_(period, startDate, endDate, timeStart, timeEnd) {
  if (period === PERIOD_HOURLY) {
    const hours = hoursBetween_(timeStart, timeEnd);
    return Math.min(1, Math.round((hours / WORK_HOURS_PER_DAY) * 100) / 100);
  }
  if (period === PERIOD_MORNING || period === PERIOD_AFTERNOON) return 0.5;
  return calcBusinessDays_(startDate, endDate);
}

function historyCacheKey_(lineUserId) {
  return 'hist_' + lineUserId;
}

// ล้าง cache ที่เกี่ยวกับใบลาของพนักงานคนนี้ (ประวัติของเขา + รายการรออนุมัติรวม)
function clearRequestCaches_(lineUserIds) {
  const keys = [CACHE_KEY_PENDING];
  (lineUserIds || []).forEach(id => { if (id) keys.push(historyCacheKey_(id)); });
  CacheService.getScriptCache().removeAll(keys);
}

// อ่านชีตใบลาทั้งชีตไม่เกินครั้งเดียวต่อคำขอ แม้จะต้องใช้ทั้งประวัติและรายการรออนุมัติ
function allRequestRows_() {
  if (!memo_.requestRows) memo_.requestRows = sheetToObjects_(getSheet_(SHEET_LEAVE_REQUESTS));
  return memo_.requestRows;
}

function createLeaveRequest_(employee, leaveType, startDate, endDate, reason, timePeriod, timeStart, timeEnd) {
  const requestId = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  const period = timePeriod || PERIOD_FULL;
  const days = calcLeaveDays_(period, startDate, endDate, timeStart, timeEnd);
  const submittedAt = new Date();

  const row = LEAVE_REQUESTS_HEADERS.map(h => {
    switch (h) {
      case 'RequestId': return requestId;
      case 'LineUserId': return employee.LineUserId;
      case 'Name': return employee.Name;
      case 'Department': return employee.Department;
      case 'LeaveType': return leaveType;
      case 'StartDate': return startDate;
      case 'EndDate': return endDate;
      case 'Days': return days;
      case 'Reason': return reason;
      case 'Status': return STATUS_PENDING_MANAGER;
      case 'SubmittedAt': return submittedAt;
      case 'TimePeriod': return period;
      case 'TimeStart': return timeStart || '';
      case 'TimeEnd': return timeEnd || '';
      default: return '';
    }
  });
  withScriptLock_(() => getSheet_(SHEET_LEAVE_REQUESTS).appendRow(row));
  clearRequestCaches_([employee.LineUserId]);

  return {
    requestId, lineUserId: employee.LineUserId, name: employee.Name,
    department: employee.Department, leaveType, startDate, endDate, days, reason,
    timePeriod: period, timeStart: timeStart || '', timeEnd: timeEnd || '',
    status: STATUS_PENDING_MANAGER, submittedAt
  };
}

// ประวัติการลาของพนักงาน 1 คน (แปลงเป็นรูปแบบที่ส่งให้หน้าจอแล้ว) ใหม่สุดก่อน
function getMyLeavesSerialized_(lineUserId) {
  const key = historyCacheKey_(lineUserId);
  const hit = cacheGetJson_(key);
  if (hit) return hit;

  const items = allRequestRows_()
    .filter(r => r.LineUserId === lineUserId)
    .sort((a, b) => new Date(b.SubmittedAt) - new Date(a.SubmittedAt))
    .map(serializeRequest_);
  cachePutJson_(key, items, CACHE_TTL_REQUESTS);
  return items;
}

// ใบลาทุกใบที่ยังรออนุมัติ (ทั้งขั้น ผจก. และ HR) เก่าสุดก่อน
function getAllPendingSerialized_() {
  const hit = cacheGetJson_(CACHE_KEY_PENDING);
  if (hit) return hit;

  const items = allRequestRows_()
    .filter(r => isPendingAny_(r.Status))
    .sort((a, b) => new Date(a.SubmittedAt) - new Date(b.SubmittedAt))
    .map(serializeRequest_);
  cachePutJson_(CACHE_KEY_PENDING, items, CACHE_TTL_REQUESTS);
  return items;
}

// ขั้นที่ 1: คำขอในแผนกที่ ผจก. คนนี้ดูแล ที่ยังรอ ผจก. อยู่
function getPendingManagerApprovals_(lineUserId) {
  const departments = getDepartmentsManagedBy_(lineUserId);
  return getAllPendingSerialized_()
    .filter(r => isPendingManager_(r.status) && departments.indexOf(r.department) !== -1);
}

// ขั้นที่ 2: คำขอทุกแผนกที่ผ่าน ผจก. แล้ว รอ HR
function getPendingHrApprovals_() {
  return getAllPendingSerialized_().filter(r => r.status === STATUS_PENDING_HR);
}

// อ่านสดจากชีตเสมอ (ไม่ใช้ cache) เพราะใช้ตัดสินอนุมัติ/ยกเลิก
function getLeaveRequestById_(requestId) {
  const sheet = getSheet_(SHEET_LEAVE_REQUESTS);
  const rowIndex = findRowIndexByValue_(sheet, 'RequestId', requestId);
  return rowIndex < 0 ? null : readRowObject_(sheet, rowIndex);
}

// แก้หลายช่องของแถวเดียวด้วยการเขียนครั้งเดียว (เฉพาะช่วงคอลัมน์ที่เปลี่ยน)
function updateRequestFields_(requestId, fields) {
  const updated = withScriptLock_(() => {
    const sheet = getSheet_(SHEET_LEAVE_REQUESTS);
    const rowIndex = findRowIndexByValue_(sheet, 'RequestId', requestId);
    if (rowIndex < 0) throw new Error('ไม่พบคำขอลา: ' + requestId);

    const headers = headersOf_(sheet);
    const cols = Object.keys(fields).map(h => headers.indexOf(h)).filter(i => i >= 0);
    const rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
    if (cols.length) {
      const first = Math.min.apply(null, cols);
      const last = Math.max.apply(null, cols);
      Object.keys(fields).forEach(h => {
        const i = headers.indexOf(h);
        if (i >= 0) rowValues[i] = fields[h];
      });
      sheet.getRange(rowIndex, first + 1, 1, last - first + 1)
        .setValues([rowValues.slice(first, last + 1)]);
    }
    return rowToObject_(headers, rowValues);
  });
  clearRequestCaches_([updated.LineUserId]);
  return updated;
}

// ---------- Archive ----------

/**
 * ย้ายใบลาที่จบแล้ว (อนุมัติ/ไม่อนุมัติ/ยกเลิก) และสิ้นสุดก่อนปีปัจจุบัน ไปชีต LeaveRequestsArchive
 * เพื่อให้ชีตหลักเล็กอยู่เสมอ ใบลาที่ยังรออนุมัติจะไม่ถูกย้ายไม่ว่าเก่าแค่ไหน
 * รันอัตโนมัติทุกวันที่ 1 ของเดือน ตอนตี 2 (ดู ensureArchiveTrigger_) หรือกดจากเมนูในชีตก็ได้
 */
function archiveOldRequests() {
  const moved = withScriptLock_(() => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getSheet_(SHEET_LEAVE_REQUESTS);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = values[0];
    const iStatus = headers.indexOf('Status');
    const iEnd = headers.indexOf('EndDate');
    const iSubmitted = headers.indexOf('SubmittedAt');
    const iUser = headers.indexOf('LineUserId');
    const cutoff = new Date(new Date().getFullYear(), 0, 1);

    const keep = [];
    const move = [];
    values.slice(1).forEach(row => {
      const dateValue = row[iEnd] || row[iSubmitted];
      const date = dateValue ? new Date(dateValue) : null;
      const old = date && !isNaN(date) && date < cutoff;
      if (old && !isPendingAny_(row[iStatus])) move.push(row);
      else keep.push(row);
    });
    if (!move.length) return [];

    // ชีต Archive ใช้หัวคอลัมน์ชุดเดียวกับชีตหลัก จับคู่ตามชื่อคอลัมน์ กันลำดับคอลัมน์ไม่ตรงกัน
    const archive = createSheetIfMissing_(ss, SHEET_LEAVE_ARCHIVE, headers);
    ensureColumns_(ss, SHEET_LEAVE_ARCHIVE, headers);
    const archiveHeaders = archive.getRange(1, 1, 1, archive.getLastColumn()).getValues()[0];
    const mapped = move.map(row => archiveHeaders.map(h => {
      const i = headers.indexOf(h);
      return i >= 0 ? row[i] : '';
    }));
    archive.getRange(archive.getLastRow() + 1, 1, mapped.length, archiveHeaders.length).setValues(mapped);

    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    if (keep.length) sheet.getRange(2, 1, keep.length, lastCol).setValues(keep);
    SpreadsheetApp.flush();

    return move.map(row => row[iUser]);
  });

  if (moved.length) {
    const users = moved.filter((id, i) => moved.indexOf(id) === i);
    clearRequestCaches_(users);
  }
  console.log('archiveOldRequests: ย้าย ' + moved.length + ' แถวไปชีต ' + SHEET_LEAVE_ARCHIVE);
  return moved.length;
}
