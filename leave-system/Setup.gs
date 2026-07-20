/**
 * Run setupSpreadsheet() once (Apps Script editor > select function > Run)
 * to create all sheets, headers, and starter data.
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  createSheetIfMissing_(ss, SHEET_EMPLOYEES, EMPLOYEES_HEADERS);
  createSheetIfMissing_(ss, SHEET_DEPARTMENTS, DEPARTMENTS_HEADERS);
  createSheetIfMissing_(ss, SHEET_LEAVE_REQUESTS, LEAVE_REQUESTS_HEADERS);
  createSheetIfMissing_(ss, SHEET_LEAVE_TYPES, LEAVE_TYPES_HEADERS);
  createSheetIfMissing_(ss, SHEET_HR, HR_HEADERS);

  // migrate existing sheets: append any headers added in newer versions
  ensureColumns_(ss, SHEET_LEAVE_REQUESTS, LEAVE_REQUESTS_HEADERS);
  ensureColumns_(ss, SHEET_EMPLOYEES, EMPLOYEES_HEADERS);

  const hrSheet = ss.getSheetByName(SHEET_HR);
  if (hrSheet.getLastRow() < 2) {
    hrSheet.appendRow(['(กรอก LineUserId ของ HR หลังลงทะเบียนผ่านแอป)', 'ชื่อ HR']);
  }

  const leaveTypesSheet = ss.getSheetByName(SHEET_LEAVE_TYPES);
  if (leaveTypesSheet.getLastRow() < 2) {
    DEFAULT_LEAVE_TYPES.forEach(t => {
      leaveTypesSheet.appendRow([t.key, t.name, t.color, t.defaultDays, t.balanceField]);
    });
  } else {
    // migrate: เติมประเภทลาที่เพิ่มมาใหม่ (เช่น ลากิจพิเศษ) ลงชีตเดิม
    const existingKeys = leaveTypesSheet.getRange(2, 1, leaveTypesSheet.getLastRow() - 1, 1)
      .getValues().map(r => r[0]);
    DEFAULT_LEAVE_TYPES.forEach(t => {
      if (existingKeys.indexOf(t.key) === -1) {
        leaveTypesSheet.appendRow([t.key, t.name, t.color, t.defaultDays, t.balanceField]);
      }
    });
  }

  // migrate: ลากิจพิเศษปรับโควตาเริ่มต้นจาก 3 เป็น 5 วัน
  bumpDefaultDays_(ss, 'SPECIAL', 3, 5);

  backfillEmployeeBalances_(ss);

  const deptSheet = ss.getSheetByName(SHEET_DEPARTMENTS);
  if (deptSheet.getLastRow() < 2) {
    deptSheet.appendRow(['ตัวอย่าง-ฝ่ายขาย', '(กรอก LineUserId ของหัวหน้าแผนกทีหลัง)', 'ชื่อหัวหน้าแผนก']);
  }

  // remove default "Sheet1" if it's empty and unused
  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่นงาน1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }

  ensureKeepWarmTrigger_();
  clearSheetCache_();
  SpreadsheetApp.flush();
  // getUi() is only available when run from the Sheet menu; running from the
  // Apps Script editor has no UI, so skip the alert silently there.
  try {
    SpreadsheetApp.getUi().alert(
      'ตั้งค่าเสร็จสิ้น',
      'สร้างชีตทั้งหมดเรียบร้อยแล้ว: Employees, Departments, LeaveRequests, LeaveTypes\n\n' +
      'ขั้นตอนถัดไป: กรอกชื่อแผนกในชีต Departments แล้วดูคู่มือ SETUP.md เพื่อเชื่อมต่อ LINE',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (e) {
    console.log('setupSpreadsheet เสร็จสิ้น (รันจาก editor จึงไม่แสดง popup)');
  }
}

// พนักงานเก่าที่ลงทะเบียนก่อนมีประเภทลาใหม่ จะมีช่องโควตาว่าง — เติมค่าเริ่มต้นให้
function backfillEmployeeBalances_(ss) {
  const sheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!sheet || sheet.getLastRow() < 2) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  DEFAULT_LEAVE_TYPES.forEach(t => {
    const col = headers.indexOf(t.balanceField) + 1;
    if (col === 0) return;
    const range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
    const values = range.getValues();
    let changed = false;
    values.forEach(row => {
      if (row[0] === '' || row[0] === null) { row[0] = t.defaultDays; changed = true; }
    });
    if (changed) range.setValues(values);
  });
}

// ปรับ "โควตาเริ่มต้นต่อปี" ของประเภทลาหนึ่งจากค่าเก่าเป็นค่าใหม่ ทั้งในชีต LeaveTypes
// (นิยามโควตา) และในชีต Employees ของคนที่ยังไม่ได้แตะยอดนี้เลย (ยังเท่าค่าเก่าเป๊ะ ๆ)
// คนที่ลาไปแล้วบางส่วนจะไม่ถูกแก้ทับ กันข้อมูลเพี้ยน — ปรับให้ HR ทำมือแทน
function bumpDefaultDays_(ss, typeKey, oldDays, newDays) {
  const typesSheet = ss.getSheetByName(SHEET_LEAVE_TYPES);
  if (typesSheet && typesSheet.getLastRow() >= 2) {
    const rows = typesSheet.getRange(2, 1, typesSheet.getLastRow() - 1, 5).getValues();
    rows.forEach((row, i) => {
      if (row[0] === typeKey && Number(row[3]) === oldDays) {
        typesSheet.getRange(i + 2, 4).setValue(newDays);
      }
    });
  }

  const type = DEFAULT_LEAVE_TYPES.find(t => t.key === typeKey);
  const empSheet = ss.getSheetByName(SHEET_EMPLOYEES);
  if (!type || !empSheet || empSheet.getLastRow() < 2) return;
  const headers = empSheet.getRange(1, 1, 1, empSheet.getLastColumn()).getValues()[0];
  const col = headers.indexOf(type.balanceField) + 1;
  if (col === 0) return;
  const range = empSheet.getRange(2, col, empSheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let changed = false;
  values.forEach(row => {
    if (Number(row[0]) === oldDays) { row[0] = newDays; changed = true; }
  });
  if (changed) range.setValues(values);
}

function ensureColumns_(ss, name, headers) {
  const sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() === 0) return;
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missing = headers.filter(h => existing.indexOf(h) === -1);
  if (!missing.length) return;
  const startCol = existing.length + 1;
  sheet.getRange(1, startCol, 1, missing.length).setValues([missing])
    .setFontWeight('bold').setBackground('#06C755').setFontColor('#FFFFFF');
}

function createSheetIfMissing_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#06C755').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

// รันเบาๆ ทุก 5 นาที เพื่อให้สคริปต์อุ่นอยู่เสมอ ลดอาการโหลดช้าครั้งแรก (cold start)
// และถือโอกาสเติม cache ชีตหลักไว้ล่วงหน้า
function keepWarm_() {
  getLeaveTypes_();
  getDepartments_();
}

function ensureKeepWarmTrigger_() {
  const exists = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'keepWarm_');
  if (!exists) {
    ScriptApp.newTrigger('keepWarm_').timeBased().everyMinutes(5).create();
  }
}

/** Optional: adds a menu so non-developers can (re-)run setup from the Sheet UI. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบลาออนไลน์')
    .addItem('ตั้งค่าระบบ (Setup)', 'setupSpreadsheet')
    .addToUi();
}
