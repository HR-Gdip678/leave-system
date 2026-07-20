/**
 * All reads/writes to the backing Google Sheet.
 */

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบชีต: ' + name + ' กรุณารันฟังก์ชัน setupSpreadsheet() ก่อน');
  return sheet;
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[r][i]; });
    obj._row = r + 1; // 1-indexed sheet row
    rows.push(obj);
  }
  return rows;
}

function findRowIndexByValue_(sheet, columnHeader, value) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(columnHeader) + 1;
  if (col === 0 || sheet.getLastRow() < 2) return -1;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) return i + 2;
  }
  return -1;
}

// ---------- Employees ----------

function getEmployee_(lineUserId) {
  const rows = sheetToObjects_(getSheet_(SHEET_EMPLOYEES));
  return rows.find(r => r.LineUserId === lineUserId) || null;
}

function upsertEmployee_(profile, department) {
  const sheet = getSheet_(SHEET_EMPLOYEES);
  const rowIndex = findRowIndexByValue_(sheet, 'LineUserId', profile.userId);
  if (rowIndex > 0) return getEmployee_(profile.userId);

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
    if (h in defaults) return defaults[h];
    return '';
  });
  sheet.appendRow(row);
  return getEmployee_(profile.userId);
}

function adjustEmployeeBalance_(lineUserId, balanceField, delta) {
  const sheet = getSheet_(SHEET_EMPLOYEES);
  const rowIndex = findRowIndexByValue_(sheet, 'LineUserId', lineUserId);
  if (rowIndex < 0) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(balanceField) + 1;
  if (col === 0) return;
  const cell = sheet.getRange(rowIndex, col);
  const current = Number(cell.getValue()) || 0;
  cell.setValue(current + delta);
}

// ---------- Departments ----------

function getDepartments_() {
  return sheetToObjects_(getSheet_(SHEET_DEPARTMENTS));
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
  return sheetToObjects_(getSheet_(SHEET_HR))
    .filter(r => r.LineUserId && String(r.LineUserId).indexOf('(') !== 0); // ข้ามแถวตัวอย่าง
}

function isHr_(lineUserId) {
  return getHrApprovers_().some(r => r.LineUserId === lineUserId);
}

// ---------- Leave Types ----------

function getLeaveTypes_() {
  const rows = sheetToObjects_(getSheet_(SHEET_LEAVE_TYPES));
  return rows.map(r => ({
    key: r.TypeKey,
    name: r.TypeName,
    color: r.Color,
    defaultDays: r.DefaultDays,
    balanceField: r.BalanceField
  }));
}

// ---------- Leave Requests ----------

function calcBusinessDays_(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  let days = 0;
  const d = new Date(start);
  while (d <= end) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) days++;
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

function createLeaveRequest_(employee, leaveType, startDate, endDate, reason, timePeriod, timeStart, timeEnd) {
  const sheet = getSheet_(SHEET_LEAVE_REQUESTS);
  const requestId = 'REQ-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
  const period = timePeriod || PERIOD_FULL;
  const days = calcLeaveDays_(period, startDate, endDate, timeStart, timeEnd);

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
      case 'SubmittedAt': return new Date();
      case 'TimePeriod': return period;
      case 'TimeStart': return timeStart || '';
      case 'TimeEnd': return timeEnd || '';
      default: return '';
    }
  });
  sheet.appendRow(row);

  return {
    requestId, lineUserId: employee.LineUserId, name: employee.Name,
    department: employee.Department, leaveType, startDate, endDate, days, reason,
    timePeriod: period, timeStart: timeStart || '', timeEnd: timeEnd || '',
    status: STATUS_PENDING_MANAGER
  };
}

function getLeaveRequestsForEmployee_(lineUserId) {
  const rows = sheetToObjects_(getSheet_(SHEET_LEAVE_REQUESTS));
  return rows
    .filter(r => r.LineUserId === lineUserId)
    .sort((a, b) => new Date(b.SubmittedAt) - new Date(a.SubmittedAt));
}

function getLeaveRequestById_(requestId) {
  const rows = sheetToObjects_(getSheet_(SHEET_LEAVE_REQUESTS));
  return rows.find(r => r.RequestId === requestId) || null;
}

// ขั้นที่ 1: คำขอในแผนกที่ ผจก. คนนี้ดูแล ที่ยังรอ ผจก. อยู่
function getPendingManagerApprovals_(lineUserId) {
  const departments = getDepartmentsManagedBy_(lineUserId);
  const rows = sheetToObjects_(getSheet_(SHEET_LEAVE_REQUESTS));
  return rows
    .filter(r => isPendingManager_(r.Status) && departments.indexOf(r.Department) !== -1)
    .sort((a, b) => new Date(a.SubmittedAt) - new Date(b.SubmittedAt));
}

// ขั้นที่ 2: คำขอทุกแผนกที่ผ่าน ผจก. แล้ว รอ HR
function getPendingHrApprovals_() {
  const rows = sheetToObjects_(getSheet_(SHEET_LEAVE_REQUESTS));
  return rows
    .filter(r => r.Status === STATUS_PENDING_HR)
    .sort((a, b) => new Date(a.SubmittedAt) - new Date(b.SubmittedAt));
}

function updateRequestFields_(requestId, fields) {
  const sheet = getSheet_(SHEET_LEAVE_REQUESTS);
  const rowIndex = findRowIndexByValue_(sheet, 'RequestId', requestId);
  if (rowIndex < 0) throw new Error('ไม่พบคำขอลา: ' + requestId);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(fields).forEach(header => {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(rowIndex, col).setValue(fields[header]);
  });

  return getLeaveRequestById_(requestId);
}
