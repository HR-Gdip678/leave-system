/**
 * Web app entry points. The front-end is hosted on GitHub Pages (web/index.html)
 * because the LIFF SDK cannot run inside Apps Script's sandboxed iframe.
 *  - doGet: health check only
 *  - doPost with ?token=... : LINE Messaging API webhook (approver taps Approve/Reject)
 *  - doPost with JSON body  : API for the front-end (fetch from GitHub Pages).
 *    The front-end sends Content-Type text/plain to avoid a CORS preflight,
 *    which Apps Script web apps cannot answer.
 */

function doGet(e) {
  return jsonOut_({ ok: true, service: 'leave-system API' });
}

function doPost(e) {
  // LINE webhook: the Webhook URL includes "?token=<WEBHOOK_TOKEN>" (see SETUP.md)
  // since Apps Script cannot read the X-Line-Signature header directly.
  if (e.parameter && e.parameter.token !== undefined) {
    if (e.parameter.token !== getWebhookToken_()) {
      return ContentService.createTextOutput('unauthorized').setMimeType(ContentService.MimeType.TEXT);
    }
    const body = JSON.parse(e.postData.contents);
    (body.events || []).forEach(handleLineEvent_);
    return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
  }

  // JSON API from the front-end. Every action re-verifies the LINE access token
  // against api.line.me, so no extra secret is needed here.
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'คำขอไม่ถูกต้อง' });
  }
  try {
    return jsonOut_({ ok: true, data: routeApi_(req) });
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message || String(err) });
  }
}

function routeApi_(req) {
  const t = req.accessToken;
  switch (req.action) {
    case 'getHomeData': return getHomeData(t);
    case 'registerEmployee': return registerEmployee(t, req.name, req.department, req.employeeCode);
    case 'submitLeaveRequest': return submitLeaveRequest(t, req.payload);
    case 'getMyLeaves': return getMyLeaves(t);
    case 'getPendingApprovals': return getPendingApprovals(t);
    case 'decideLeaveRequest': return decideLeaveRequest(t, req.requestId, req.decision, req.comment || '');
    case 'cancelLeaveRequest': return cancelLeaveRequest(t, req.requestId);
    case 'getAdminData': return getAdminData(t, !!req.includeArchive);
    default: throw new Error('ไม่รู้จักคำสั่ง: ' + req.action);
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleLineEvent_(event) {
  if (event.type !== 'postback') return;

  const data = parsePostbackData_(event.postback.data);
  if (data.action !== 'decide') return;

  try {
    const request = getLeaveRequestById_(data.id);
    if (!request) {
      lineReply_(event.replyToken, [{ type: 'text', text: 'ไม่พบคำขอลานี้แล้ว อาจถูกดำเนินการไปแล้ว' }]);
      return;
    }

    const result = processDecision_(request, data.decision, '', event.source.userId);

    let ackText;
    if (!result.final) {
      ackText = 'อนุมัติขั้นที่ 1 เรียบร้อย — ส่งต่อให้ HR พิจารณาต่อแล้ว';
    } else {
      ackText = (result.status === STATUS_APPROVED ? 'อนุมัติ' : 'ไม่อนุมัติ') +
        'คำขอลาของ ' + request.Name + ' เรียบร้อยแล้ว';
    }
    lineReply_(event.replyToken, [{ type: 'text', text: ackText }]);
  } catch (err) {
    console.error(err);
    lineReply_(event.replyToken, [{ type: 'text', text: 'เกิดข้อผิดพลาด: ' + err.message }]);
  }
}

function parsePostbackData_(data) {
  const out = {};
  data.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    out[k] = decodeURIComponent(v);
  });
  return out;
}

/**
 * ตัดสินคำขอตามขั้นของมัน:
 *  - PENDING_MANAGER + ผจก.ฝ่ายของแผนกนั้น: reject = จบ / approve = ส่งต่อ HR
 *  - PENDING_HR + คนในชีต HR: ตัดสินขั้นสุดท้าย (approve จึงค่อยหักวันลา)
 */
function processDecision_(request, decision, comment, deciderId) {
  if (decision !== STATUS_APPROVED && decision !== STATUS_REJECTED) throw new Error('คำสั่งไม่ถูกต้อง');
  const requestForFlex = flexPayload_(request);

  if (isPendingManager_(request.Status)) {
    if (getDepartmentsManagedBy_(deciderId).indexOf(request.Department) === -1) {
      throw new Error('คุณไม่มีสิทธิ์อนุมัติคำขอของแผนกนี้');
    }

    if (decision === STATUS_REJECTED) {
      updateRequestFields_(request.RequestId, {
        Status: STATUS_REJECTED, ApproverLineUserId: deciderId,
        ApproverComment: comment || '', DecidedAt: new Date()
      });
      linePush_(request.LineUserId, [buildDecisionNoticeFlex_(requestForFlex, STATUS_REJECTED, 'MANAGER')]);
      return { final: true, status: STATUS_REJECTED };
    }

    updateRequestFields_(request.RequestId, {
      Status: STATUS_PENDING_HR, ApproverLineUserId: deciderId,
      ApproverComment: comment || '', DecidedAt: new Date()
    });

    const hrs = getHrApprovers_();
    hrs.forEach(h => linePush_(h.LineUserId, [buildApprovalRequestFlex_(requestForFlex, 'HR')]));
    linePush_(request.LineUserId, [{
      type: 'text',
      text: '✅ คำขอลาของคุณผ่านการอนุมัติจากผู้จัดการฝ่ายแล้ว (ขั้นที่ 1/2)\nกำลังรอฝ่ายบุคคล (HR) พิจารณาขั้นสุดท้าย 🦙'
    }]);
    return { final: false, status: STATUS_PENDING_HR };
  }

  if (request.Status === STATUS_PENDING_HR) {
    if (!isHr_(deciderId)) {
      throw new Error('คำขอนี้อยู่ในขั้นตอนพิจารณาของ HR');
    }

    const fields = { Status: decision, HrLineUserId: deciderId, HrDecidedAt: new Date() };
    if (comment) fields.ApproverComment = comment;
    updateRequestFields_(request.RequestId, fields);

    if (decision === STATUS_APPROVED) {
      const leaveType = getLeaveTypes_().find(t => t.key === request.LeaveType);
      if (leaveType) adjustEmployeeBalance_(request.LineUserId, leaveType.balanceField, -request.Days);
    }

    linePush_(request.LineUserId, [buildDecisionNoticeFlex_(requestForFlex, decision, 'HR')]);
    return { final: true, status: decision };
  }

  throw new Error('คำขอนี้ถูกดำเนินการไปแล้ว (' + request.Status + ')');
}

function flexPayload_(request) {
  return {
    requestId: request.RequestId, name: request.Name, department: request.Department,
    leaveType: request.LeaveType, startDate: formatDate_(request.StartDate),
    endDate: formatDate_(request.EndDate), days: request.Days, reason: request.Reason,
    timePeriod: request.TimePeriod,
    periodText: periodDisplayFields_(request.TimePeriod, request.TimeStart, request.TimeEnd)
  };
}

function formatDate_(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  return Utilities.formatDate(date, 'Asia/Bangkok', 'dd/MM/yyyy');
}

// ================= PUBLIC API (called via google.script.run from the LIFF app) =================

function getDepartmentList() {
  return getDepartments_().map(d => d.Department).filter(String);
}

function registerEmployee(accessToken, name, department, employeeCode) {
  const profile = lineProfileFromAccessToken_(accessToken);
  const displayName = (name || '').trim() || profile.displayName;
  if (!employeeCode || !String(employeeCode).trim()) throw new Error('กรุณากรอกรหัสพนักงาน');
  upsertEmployee_(Object.assign({}, profile, { displayName }), department, String(employeeCode).trim());
  return getHomeData(accessToken);
}

function getHomeData(accessToken) {
  const profile = lineProfileFromAccessToken_(accessToken);
  const employee = getEmployee_(profile.userId);
  const leaveTypes = getLeaveTypes_();

  if (!employee) {
    return {
      registered: false,
      profile: { displayName: profile.displayName, pictureUrl: profile.pictureUrl },
      departments: getDepartmentList(),
      leaveTypes
    };
  }

  const balances = leaveTypes.map(t => ({
    key: t.key, name: t.name, color: t.color, remaining: Number(employee[t.balanceField]) || 0
  }));

  const isApprover = isApprover_(profile.userId);
  const isHr = isHr_(profile.userId);

  // ส่งประวัติการลาและรายการรออนุมัติมาในคำสั่งเดียว หน้าจอจะได้ไม่ต้องเรียกเพิ่มอีก 2 รอบ
  return {
    registered: true,
    profile: {
      displayName: employee.Name, pictureUrl: employee.PictureUrl,
      department: employee.Department, employeeCode: employee.EmployeeCode || ''
    },
    isApprover,
    isHr,
    balances,
    leaveTypes,
    myLeaves: getMyLeavesSerialized_(profile.userId),
    pendingApprovals: collectPendingApprovals_(profile.userId, isApprover, isHr)
  };
}

function submitLeaveRequest(accessToken, payload) {
  const profile = lineProfileFromAccessToken_(accessToken);
  const employee = getEmployee_(profile.userId);
  if (!employee) throw new Error('กรุณาลงทะเบียนก่อนยื่นคำขอลา');

  const { leaveType, startDate, endDate, reason, timeStart, timeEnd } = payload;
  const timePeriod = payload.timePeriod || PERIOD_FULL;
  if (!leaveType || !startDate || !endDate) throw new Error('กรุณากรอกข้อมูลให้ครบถ้วน');
  if (!reason || !String(reason).trim()) throw new Error('กรุณาระบุเหตุผลการลา');
  if (new Date(endDate) < new Date(startDate)) throw new Error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา');
  if (timePeriod !== PERIOD_FULL && startDate !== endDate) {
    throw new Error('ลาแบบระบุช่วงเวลาเลือกได้ครั้งละ 1 วันเท่านั้น');
  }

  if (timePeriod === PERIOD_HOURLY) {
    if (!timeStart || !timeEnd) throw new Error('กรุณาเลือกเวลาเริ่มและเวลาสิ้นสุด');
    const hours = hoursBetween_(timeStart, timeEnd);
    if (hours <= 0) throw new Error('เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม');
    if (hours > WORK_HOURS_PER_DAY) throw new Error('ช่วงเวลาเกิน ' + WORK_HOURS_PER_DAY + ' ชั่วโมง — กรุณาเลือกลาเต็มวันแทน');
  }

  if (timePeriod === PERIOD_FULL && calcBusinessDays_(startDate, endDate) <= 0) {
    throw new Error('ช่วงวันที่เลือกไม่มีวันทำการ (วันอาทิตย์)');
  }

  const request = createLeaveRequest_(employee, leaveType, startDate, endDate, String(reason).trim(), timePeriod, timeStart, timeEnd);

  const approver = getApproverForDepartment_(employee.Department);
  if (approver && approver.lineUserId) {
    const requestForFlex = Object.assign({}, request, {
      startDate: formatDate_(request.startDate), endDate: formatDate_(request.endDate),
      periodText: periodDisplayFields_(request.timePeriod, request.timeStart, request.timeEnd)
    });
    linePush_(approver.lineUserId, [buildApprovalRequestFlex_(requestForFlex, 'MANAGER')]);
  }

  // ส่งใบลาที่เพิ่งสร้างกลับไปด้วย หน้าจอเอาไปต่อท้ายประวัติได้เลยโดยไม่ต้องโหลดใหม่
  const item = serializeRequest_({
    RequestId: request.requestId, Name: request.name, Department: request.department,
    LeaveType: request.leaveType, StartDate: request.startDate, EndDate: request.endDate,
    Days: request.days, Reason: request.reason, Status: request.status, ApproverComment: '',
    SubmittedAt: request.submittedAt, TimePeriod: request.timePeriod,
    TimeStart: request.timeStart, TimeEnd: request.timeEnd
  });
  return { ok: true, requestId: request.requestId, request: item };
}

// หน้าจอรุ่นใหม่ได้ข้อมูลนี้จาก getHomeData แล้ว — คงไว้ให้หน้าจอรุ่นเก่ายังใช้ได้
function getMyLeaves(accessToken) {
  const profile = lineProfileFromAccessToken_(accessToken);
  return getMyLeavesSerialized_(profile.userId);
}

function getPendingApprovals(accessToken) {
  const profile = lineProfileFromAccessToken_(accessToken);
  return collectPendingApprovals_(profile.userId, isApprover_(profile.userId), isHr_(profile.userId));
}

// รวมรายการรออนุมัติของคนคนนี้ทั้ง 2 บทบาท (เป็นได้ทั้ง ผจก. และ HR พร้อมกัน)
function collectPendingApprovals_(lineUserId, isApprover, isHr) {
  const out = [];
  if (isApprover) {
    getPendingManagerApprovals_(lineUserId).forEach(r =>
      out.push(Object.assign({}, r, { stage: 'MANAGER' })));
  }
  if (isHr) {
    getPendingHrApprovals_().forEach(r =>
      out.push(Object.assign({}, r, { stage: 'HR' })));
  }
  return out;
}

function decideLeaveRequest(accessToken, requestId, decision, comment) {
  const profile = lineProfileFromAccessToken_(accessToken);
  const request = getLeaveRequestById_(requestId);
  if (!request) throw new Error('ไม่พบคำขอลานี้');

  processDecision_(request, decision, comment, profile.userId);
  return { ok: true };
}

// พนักงานยกเลิกใบลาของตัวเองได้ ตราบใดที่ยังไม่ถูกอนุมัติ/ปฏิเสธ
function cancelLeaveRequest(accessToken, requestId) {
  const profile = lineProfileFromAccessToken_(accessToken);
  const request = getLeaveRequestById_(requestId);
  if (!request) throw new Error('ไม่พบคำขอลานี้');
  if (request.LineUserId !== profile.userId) throw new Error('ยกเลิกได้เฉพาะใบลาของตัวเองเท่านั้น');
  if (!isPendingAny_(request.Status)) {
    throw new Error('ยกเลิกได้เฉพาะใบลาที่ยังรออนุมัติ (สถานะปัจจุบัน: ' + request.Status + ')');
  }

  updateRequestFields_(request.RequestId, { Status: STATUS_CANCELLED, DecidedAt: new Date() });

  // แจ้งผู้อนุมัติของขั้นที่ค้างอยู่ ให้รู้ว่าใบลานี้ถูกถอนแล้ว
  const noticeText = '🚫 ' + request.Name + ' ยกเลิกคำขอ' + leaveTypeLabel_(request.LeaveType) +
    ' (' + formatDate_(request.StartDate) + ' - ' + formatDate_(request.EndDate) + ') แล้ว ไม่ต้องดำเนินการต่อ';
  if (isPendingManager_(request.Status)) {
    const approver = getApproverForDepartment_(request.Department);
    if (approver && approver.lineUserId) linePush_(approver.lineUserId, [{ type: 'text', text: noticeText }]);
  } else {
    getHrApprovers_().forEach(h => linePush_(h.LineUserId, [{ type: 'text', text: noticeText }]));
  }

  return { ok: true };
}

// ================= ADMIN (หน้าผู้ดูแล admin.html — เฉพาะคนในชีต HR) =================

/**
 * ข้อมูลทั้งหมดสำหรับหน้าผู้ดูแล: ใบลาทุกใบ + พนักงานทุกคนพร้อมยอดคงเหลือ
 * ตรวจสิทธิ์ที่เซิร์ฟเวอร์เสมอ — คนที่ไม่อยู่ในชีต HR จะไม่ได้ข้อมูลแม้เปิดหน้าได้
 * includeArchive = รวมใบลาของปีก่อนๆ จากชีต LeaveRequestsArchive ด้วย
 */
function getAdminData(accessToken, includeArchive) {
  const profile = lineProfileFromAccessToken_(accessToken);
  if (!isHr_(profile.userId)) throw new Error('หน้านี้สำหรับฝ่ายบุคคล (HR) เท่านั้น');

  const leaveTypes = getLeaveTypes_();
  const employeeRows = sheetToObjects_(getSheet_(SHEET_EMPLOYEES)).filter(e => e.LineUserId);
  const codeByUser = {};
  employeeRows.forEach(e => { codeByUser[e.LineUserId] = e.EmployeeCode || ''; });

  let rows = allRequestRows_();
  if (includeArchive) {
    const archive = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LEAVE_ARCHIVE);
    if (archive) rows = rows.concat(sheetToObjects_(archive));
  }

  const requests = rows.filter(r => r.RequestId).map(r => Object.assign(serializeRequest_(r), {
    employeeCode: codeByUser[r.LineUserId] || '',
    startIso: isoDate_(r.StartDate),
    endIso: isoDate_(r.EndDate || r.StartDate),
    submittedIso: isoDate_(r.SubmittedAt, 'yyyy-MM-dd HH:mm')
  }));

  const employees = employeeRows.map(e => {
    const balances = {};
    leaveTypes.forEach(t => { balances[t.key] = Number(e[t.balanceField]) || 0; });
    return { name: e.Name, department: e.Department, employeeCode: e.EmployeeCode || '', balances };
  });

  // แผนกจากชีต Departments + แผนกที่พนักงานลงทะเบียนไว้จริง (ข้ามแถวตัวอย่าง)
  const departments = getDepartments_().map(d => d.Department)
    .concat(employees.map(e => e.department))
    .filter((d, i, all) => d && String(d).indexOf('ตัวอย่าง') !== 0 && all.indexOf(d) === i)
    .sort();

  const me = employeeRows.find(e => e.LineUserId === profile.userId);
  return {
    profile: { displayName: me ? me.Name : profile.displayName },
    leaveTypes: leaveTypes.map(t => ({ key: t.key, name: t.name, defaultDays: Number(t.defaultDays) || 0 })),
    departments,
    employees,
    requests,
    includeArchive: !!includeArchive,
    generatedAt: Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm')
  };
}

function isoDate_(d, pattern) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, 'Asia/Bangkok', pattern || 'yyyy-MM-dd');
}

function serializeRequest_(r) {
  return {
    requestId: r.RequestId, name: r.Name, department: r.Department, leaveType: r.LeaveType,
    startDate: formatDate_(r.StartDate), endDate: formatDate_(r.EndDate), days: r.Days,
    reason: r.Reason, status: r.Status, approverComment: r.ApproverComment,
    submittedAt: formatDate_(r.SubmittedAt), timePeriod: r.TimePeriod || 'FULL',
    timeStart: r.TimeStart || '', timeEnd: r.TimeEnd || ''
  };
}
