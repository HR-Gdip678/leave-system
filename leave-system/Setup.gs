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
  }

  const deptSheet = ss.getSheetByName(SHEET_DEPARTMENTS);
  if (deptSheet.getLastRow() < 2) {
    deptSheet.appendRow(['ตัวอย่าง-ฝ่ายขาย', '(กรอก LineUserId ของหัวหน้าแผนกทีหลัง)', 'ชื่อหัวหน้าแผนก']);
  }

  // remove default "Sheet1" if it's empty and unused
  const sheet1 = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่นงาน1');
  if (sheet1 && sheet1.getLastRow() === 0 && ss.getSheets().length > 1) {
    ss.deleteSheet(sheet1);
  }

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

/** Optional: adds a menu so non-developers can (re-)run setup from the Sheet UI. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ระบบลาออนไลน์')
    .addItem('ตั้งค่าระบบ (Setup)', 'setupSpreadsheet')
    .addToUi();
}
