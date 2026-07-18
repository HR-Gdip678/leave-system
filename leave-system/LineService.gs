/**
 * Wrappers around the LINE Login (LIFF) profile check and LINE Messaging API.
 */

function lineProfileFromAccessToken_(accessToken) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('LINE access token ไม่ถูกต้อง หรือหมดอายุ กรุณาเปิดแอปใหม่อีกครั้ง');
  }
  return JSON.parse(res.getContentText()); // { userId, displayName, pictureUrl }
}

function lineApiCall_(path, payload) {
  const res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + getChannelAccessToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    console.error('LINE API error [' + path + ']: ' + res.getContentText());
  }
  return res;
}

function linePush_(to, messages) {
  return lineApiCall_('/v2/bot/message/push', { to, messages });
}

function lineReply_(replyToken, messages) {
  return lineApiCall_('/v2/bot/message/reply', { replyToken, messages });
}

function leaveTypeLabel_(leaveType) {
  const t = getLeaveTypes_().find(t => t.key === leaveType);
  return t ? t.name : leaveType;
}

function leaveTypeEmoji_(leaveType) {
  return {
    ANNUAL: '🏖️', SICK: '🏥', PERSONAL: '🏠', MATERNITY: '👶', ORDINATION: '🙏'
  }[leaveType] || '📋';
}

const FLEX_NAVY = '#152A4E';
const FLEX_GOLD = '#C9A24B';

function buildApprovalRequestFlex_(request, stage) {
  const label = leaveTypeLabel_(request.leaveType);
  const emoji = leaveTypeEmoji_(request.leaveType);
  const submittedAt = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
  const stageText = stage === 'HR'
    ? 'ขั้นที่ 2/2 — ฝ่ายบุคคล (HR)'
    : 'ขั้นที่ 1/2 — ผู้จัดการฝ่าย';
  return {
    type: 'flex',
    altText: '🦙 คำขอ' + label + 'จาก ' + request.name + ' (' + stageText + ')',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: FLEX_NAVY, paddingAll: 'xl', spacing: 'sm',
        contents: [
          { type: 'box', layout: 'vertical', backgroundColor: FLEX_GOLD, height: '4px', cornerRadius: 'md', contents: [{ type: 'filler' }] },
          { type: 'text', text: 'คำขอ' + label, color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'md' },
          { type: 'text', text: emoji + '  ' + request.name, color: '#D7E0F0', size: 'md' },
          { type: 'text', text: request.department, color: '#8FA3C4', size: 'xs' },
          { type: 'text', text: '🔖 ' + stageText, color: FLEX_GOLD, size: 'xs', margin: 'sm', weight: 'bold' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'xl',
        contents: [
          {
            type: 'box', layout: 'horizontal', spacing: 'sm',
            contents: [
              chip_(emoji + ' ' + label, '#EAF0FB', FLEX_NAVY),
              chip_(String(request.days) + ' วัน', '#E8F6EC', '#1E7B45'),
              chip_(periodLabel_(request.timePeriod), '#F4F1E8', '#8A6D1D')
            ]
          },
          { type: 'separator', margin: 'lg' },
          kv_('📅 วันที่เริ่ม', request.startDate),
          kv_('📅 วันที่สิ้นสุด', request.endDate),
          kv_('🕐 ช่วงเวลา', periodLabel_(request.timePeriod)),
          kv_('💬 เหตุผล', request.reason || '-'),
          { type: 'text', text: 'ยื่นเมื่อ ' + submittedAt, color: '#AAB4C4', size: 'xxs', margin: 'lg', align: 'end' }
        ]
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'lg',
        contents: [
          {
            type: 'button', style: 'primary', color: '#1E7B45', height: 'md',
            action: { type: 'postback', label: '✅ อนุมัติ', data: 'action=decide&id=' + request.requestId + '&decision=APPROVED', displayText: 'อนุมัติคำขอลาของ ' + request.name }
          },
          {
            type: 'button', style: 'secondary', height: 'md',
            action: { type: 'postback', label: '❌ ไม่อนุมัติ', data: 'action=decide&id=' + request.requestId + '&decision=REJECTED', displayText: 'ไม่อนุมัติคำขอลาของ ' + request.name }
          }
        ]
      }
    }
  };
}

function chip_(text, bgColor, textColor) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: bgColor, cornerRadius: 'lg',
    paddingTop: 'sm', paddingBottom: 'sm', paddingStart: 'md', paddingEnd: 'md',
    contents: [{ type: 'text', text: text, color: textColor, size: 'xs', align: 'center', weight: 'bold' }]
  };
}

function kv_(k, v) {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: k, color: '#888888', size: 'sm', flex: 2 },
      { type: 'text', text: String(v), size: 'sm', flex: 4, wrap: true }
    ]
  };
}

function buildDecisionNoticeFlex_(request, decision, stage) {
  const approved = decision === STATUS_APPROVED;
  const label = leaveTypeLabel_(request.leaveType);
  const emoji = leaveTypeEmoji_(request.leaveType);
  const byText = stage === 'HR' ? 'โดยฝ่ายบุคคล (HR)' : 'โดยผู้จัดการฝ่าย';
  return {
    type: 'flex',
    altText: (approved ? '✅ คำขอลาของคุณได้รับการอนุมัติ' : '❌ คำขอลาของคุณไม่ได้รับการอนุมัติ'),
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: FLEX_NAVY, paddingAll: 'xl', spacing: 'sm',
        contents: [
          { type: 'box', layout: 'vertical', backgroundColor: approved ? '#2EBD59' : '#E25555', height: '4px', cornerRadius: 'md', contents: [{ type: 'filler' }] },
          { type: 'text', text: approved ? '✅ อนุมัติคำขอลาแล้ว' : '❌ ไม่อนุมัติคำขอลา', color: '#FFFFFF', weight: 'bold', size: 'lg', margin: 'md' },
          { type: 'text', text: emoji + ' ' + label + ' · ' + byText, color: '#D7E0F0', size: 'sm' }
        ]
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: 'xl',
        contents: [
          kv_('📅 วันที่', request.startDate + ' ถึง ' + request.endDate),
          kv_('🕐 ช่วงเวลา', periodLabel_(request.timePeriod)),
          kv_('⏱️ จำนวน', String(request.days) + ' วัน'),
          { type: 'text', text: approved ? 'ยอดวันลาคงเหลือถูกหักอัตโนมัติแล้ว 🦙' : 'ยอดวันลาคงเหลือไม่ถูกหัก 🦙', color: '#AAB4C4', size: 'xxs', margin: 'lg' }
        ]
      }
    }
  };
}
