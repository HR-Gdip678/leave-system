/**
 * Central configuration: sheet names, leave types, and script properties.
 */

const SHEET_EMPLOYEES = 'Employees';
const SHEET_DEPARTMENTS = 'Departments';
const SHEET_LEAVE_REQUESTS = 'LeaveRequests';
const SHEET_LEAVE_TYPES = 'LeaveTypes';
const SHEET_HR = 'HR';

const EMPLOYEES_HEADERS = [
  'LineUserId', 'Name', 'Department', 'PictureUrl',
  'AnnualLeaveBalance', 'SickLeaveBalance', 'PersonalLeaveBalance',
  'MaternityLeaveBalance', 'OrdinationLeaveBalance', 'RegisteredAt'
];

const DEPARTMENTS_HEADERS = ['Department', 'ApproverLineUserId', 'ApproverName'];

// ผู้อนุมัติขั้นที่ 2 (ฝ่ายบุคคล) — กรอก LineUserId หลังจากที่ HR ลงทะเบียนผ่านแอปแล้ว
const HR_HEADERS = ['LineUserId', 'Name'];

// Newer columns are appended last so existing sheets can be migrated in place
// (setupSpreadsheet adds any missing header columns at the end).
// ApproverLineUserId/DecidedAt = ขั้นที่ 1 (ผจก.ฝ่าย), HrLineUserId/HrDecidedAt = ขั้นที่ 2 (HR)
const LEAVE_REQUESTS_HEADERS = [
  'RequestId', 'LineUserId', 'Name', 'Department', 'LeaveType',
  'StartDate', 'EndDate', 'Days', 'Reason', 'Status',
  'ApproverLineUserId', 'ApproverComment', 'SubmittedAt', 'DecidedAt',
  'TimePeriod', 'HrLineUserId', 'HrDecidedAt'
];

const PERIOD_FULL = 'FULL';
const PERIOD_MORNING = 'MORNING';
const PERIOD_AFTERNOON = 'AFTERNOON';

function periodLabel_(period) {
  return { FULL: 'เต็มวัน', MORNING: 'ครึ่งวันเช้า', AFTERNOON: 'ครึ่งวันบ่าย' }[period] || 'เต็มวัน';
}

const LEAVE_TYPES_HEADERS = ['TypeKey', 'TypeName', 'Color', 'DefaultDays', 'BalanceField'];

// key must match a *Balance column suffix in EMPLOYEES_HEADERS (e.g. ANNUAL -> AnnualLeaveBalance)
const DEFAULT_LEAVE_TYPES = [
  { key: 'ANNUAL', name: 'ลาพักร้อน', color: '#06C755', defaultDays: 6, balanceField: 'AnnualLeaveBalance' },
  { key: 'SICK', name: 'ลาป่วย', color: '#FF6B6B', defaultDays: 30, balanceField: 'SickLeaveBalance' },
  { key: 'PERSONAL', name: 'ลากิจ', color: '#FFB020', defaultDays: 3, balanceField: 'PersonalLeaveBalance' },
  { key: 'MATERNITY', name: 'ลาคลอด', color: '#8E7CC3', defaultDays: 98, balanceField: 'MaternityLeaveBalance' },
  { key: 'ORDINATION', name: 'ลาบวช', color: '#4A90D9', defaultDays: 15, balanceField: 'OrdinationLeaveBalance' }
];

// อนุมัติ 2 ขั้น: ยื่น → PENDING_MANAGER (รอ ผจก.ฝ่าย) → PENDING_HR (รอ HR) → APPROVED
// ปฏิเสธที่ขั้นไหนก็ตาม → REJECTED (แถวเก่าที่เป็น 'PENDING' ถือว่าเป็น PENDING_MANAGER)
const STATUS_PENDING_MANAGER = 'PENDING_MANAGER';
const STATUS_PENDING_HR = 'PENDING_HR';
const STATUS_APPROVED = 'APPROVED';
const STATUS_REJECTED = 'REJECTED';
const STATUS_PENDING_LEGACY = 'PENDING';

function isPendingManager_(status) {
  return status === STATUS_PENDING_MANAGER || status === STATUS_PENDING_LEGACY;
}

function getScriptProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('ยังไม่ได้ตั้งค่า Script Property: ' + key);
  return v;
}

function getChannelAccessToken_() {
  return getScriptProp_('LINE_CHANNEL_ACCESS_TOKEN');
}

function getWebhookToken_() {
  return getScriptProp_('WEBHOOK_TOKEN');
}

function getLiffId_() {
  return PropertiesService.getScriptProperties().getProperty('LIFF_ID') || '';
}
