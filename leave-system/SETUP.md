# คู่มือติดตั้งระบบลาออนไลน์ (LIFF + Google Sheet + LINE)

สถาปัตยกรรม: พนักงานเปิดฟอร์มลาผ่าน **LINE LIFF** → หน้าเว็บโฮสต์บน **GitHub Pages**
(ไฟล์ `web/index.html`) → คุยกับ **Google Apps Script** (backend API + Webhook) →
ข้อมูลเก็บใน **Google Sheet** → เมื่อยื่นคำขอ ระบบส่ง **Flex Message**
พร้อมปุ่ม "อนุมัติ / ไม่อนุมัติ" ไปหาหัวหน้าแผนกทาง LINE โดยตรง

> ⚠️ ทำไมหน้าเว็บต้องอยู่บน GitHub Pages: LIFF SDK ไม่สามารถทำงานในหน้าเว็บที่
> Apps Script เสิร์ฟได้ เพราะ Apps Script ครอบทุกหน้าใน iframe แบบ sandbox
> ทำให้ `liff.init` ค้างตลอดกาล — จึงแยกหน้าเว็บออกมาโฮสต์ฟรีบน GitHub Pages แทน

ทั้งหมดฟรี ไม่มีค่าใช้จ่าย hosting

---

## ขั้นตอนที่ 1: สร้าง Google Sheet + วางโค้ด

1. ไปที่ [sheets.google.com](https://sheets.google.com) สร้างสเปรดชีตใหม่ ตั้งชื่อเช่น
   "ระบบลาออนไลน์ - Database"
2. เมนู **Extensions > Apps Script**
3. ลบโค้ดในไฟล์ `Code.gs` เริ่มต้นทิ้ง แล้วสร้างไฟล์ทั้งหมดต่อไปนี้ (ใช้ไอคอน + ข้าง "Files")
   พร้อมชนิดไฟล์ให้ตรง แล้ววางเนื้อหาจากโปรเจกต์นี้ให้ครบทุกไฟล์:
   - `Config.gs`
   - `SheetService.gs`
   - `LineService.gs`
   - `Setup.gs`
   - `Code.gs`
   - `Index.html` (HTML file)
   - `Stylesheet.html` (HTML file)
   - `JavaScript.html` (HTML file)
4. เปิดไฟล์ `appsscript.json` (เมนู ⚙️ Project Settings > ติ๊ก "Show appsscript.json manifest file")
   แล้วแทนที่เนื้อหาด้วยไฟล์ `appsscript.json` จากโปรเจกต์นี้
5. ที่แถบด้านบน เลือกฟังก์ชัน `setupSpreadsheet` แล้วกด **Run** (ครั้งแรกจะขอ authorize สิทธิ์เข้าถึง
   สเปรดชีต — กด Advanced > Go to project (unsafe) ได้ตามปกติเพราะเป็นสคริปต์ของเราเอง)
6. กลับไปที่ Google Sheet จะเห็น 4 ชีตใหม่: `Employees`, `Departments`, `LeaveRequests`, `LeaveTypes`

---

## ขั้นตอนที่ 2: กรอกชื่อแผนก

เปิดชีต **Departments** แก้แถวตัวอย่างเป็นแผนกจริงของบริษัท เช่น

| Department | ApproverLineUserId | ApproverName |
|---|---|---|
| ฝ่ายขาย | (เว้นว่างไว้ก่อน กรอกทีหลัง) | คุณสมชาย |
| ฝ่ายบัญชี | (เว้นว่างไว้ก่อน กรอกทีหลัง) | คุณสมหญิง |

จะกลับมากรอกช่อง `ApproverLineUserId` ในขั้นตอนที่ 6

---

## ขั้นตอนที่ 3: สร้าง LINE Official Account + Messaging API Channel

1. ไปที่ [LINE Developers Console](https://developers.line.biz/console/) ล็อกอินด้วยบัญชี LINE
2. สร้าง **Provider** ใหม่ (ชื่อบริษัท)
3. ในหน้า Provider กด **Create a new channel > Messaging API**
   กรอกชื่อ, หมวดหมู่, อัปโหลดรูปตามต้องการ
4. เข้าไปที่แชนแนลที่สร้าง แท็บ **Messaging API**:
   - เลื่อนลงไปที่ **Channel access token** กด **Issue** แล้วคัดลอกเก็บไว้ (ใช้ในขั้นตอนที่ 5)
   - ปิด (Disable) **Auto-reply messages** และ **Greeting messages** ในแท็บ Messaging API เพื่อไม่ให้
     LINE OA ตอบข้อความอัตโนมัติทับระบบของเรา
5. แท็บ **Basic settings**: คัดลอก **Channel secret** เก็บไว้ (สำรองไว้เผื่อใช้ในอนาคต)

---

## ขั้นตอนที่ 4: Deploy Apps Script เป็น Web App

1. ใน Apps Script editor กด **Deploy > New deployment**
2. เลือกชนิด **Web app**
3. ตั้งค่า: Execute as = **Me**, Who has access = **Anyone**
4. กด Deploy แล้วคัดลอก **Web app URL** (จะขึ้นต้นด้วย `https://script.google.com/macros/s/.../exec`)
   เก็บ URL นี้ไว้ ใช้ทั้งในขั้นตอน LIFF และ Webhook

> ทุกครั้งที่แก้โค้ดแล้วต้องการให้มีผลกับ URL เดิม ให้ใช้ **Deploy > Manage deployments > แก้ไข (ดินสอ)
> > Version: New version > Deploy** (อย่ากด New deployment ซ้ำ เพราะจะได้ URL ใหม่)

---

## ขั้นตอนที่ 5: ตั้งค่า Script Properties

1. ใน Apps Script editor: **Project Settings** (⚙️ ด้านซ้าย) > เลื่อนลงไปที่ **Script Properties**
2. เพิ่ม property ต่อไปนี้:

   | Property | Value |
   |---|---|
   | `LINE_CHANNEL_ACCESS_TOKEN` | token จากขั้นตอนที่ 3 |
   | `WEBHOOK_TOKEN` | ตั้งรหัสลับเอง เช่น สุ่มสตริงยาวๆ (ใช้ป้องกัน webhook endpoint) |
   | `LIFF_ID` | ใส่ทีหลังหลังทำขั้นตอนที่ 6 เสร็จ |

---

## ขั้นตอนที่ 6: โฮสต์หน้าเว็บบน GitHub Pages + สร้าง LIFF App

### 6.1 อัปโหลดหน้าเว็บขึ้น GitHub Pages

1. ล็อกอิน [github.com](https://github.com) กด **+** มุมขวาบน > **New repository**
   - Repository name: `leave-app` (หรือชื่ออื่น)
   - เลือก **Public** > กด **Create repository**
2. ในหน้า repo กด **uploading an existing file** (หรือ Add file > Upload files)
   ลากไฟล์ `web/index.html` จากโปรเจกต์นี้เข้าไป แล้วกด **Commit changes**
   (ต้องชื่อ `index.html` เป๊ะๆ อยู่ที่ราก repo)
3. ไปที่ **Settings** (ของ repo) > เมนูซ้าย **Pages** > หัวข้อ Build and deployment:
   - Source: **Deploy from a branch**
   - Branch: **main** / โฟลเดอร์ **/(root)** > กด **Save**
4. รอ 1-2 นาที รีเฟรชหน้า Pages จะเห็น URL เว็บของเรา รูปแบบ:
   `https://<username>.github.io/leave-app/` — คัดลอกเก็บไว้

> **สำคัญ:** ก่อนอัปโหลด เปิดไฟล์ `web/index.html` เช็คบรรทัดบนสุดของ `<script>`
> ว่าค่า `API_URL` ตรงกับ Web app URL จากขั้นตอนที่ 4 และ `LIFF_ID` ตรงกับข้อ 6.2

### 6.2 สร้าง LIFF App (ในแชนแนล LINE Login)

> **หมายเหตุ (อัปเดตนโยบาย LINE):** ปัจจุบัน LINE ไม่ให้สร้าง LIFF app ในแชนแนล **Messaging API**
> โดยตรงแล้ว ต้องสร้างผ่านแชนแนลชนิด **LINE Login** แทน แล้วค่อยผูกกลับมาที่ LINE OA
> (Messaging API channel) เดิมด้วย Bot link feature

1. ใน LINE Developers Console เข้า **Provider เดิม** (อันเดียวกับที่มี Messaging API channel
   จากขั้นตอนที่ 3) กด **Create a new channel > LINE Login** สร้างแชนแนลใหม่ขึ้นมาอีก 1 อัน
   (ใช้แค่เป็นที่สร้าง LIFF app เท่านั้น ไม่ต้องใช้ Channel ID/Secret ของแชนแนลนี้ที่ไหนอีก)
2. เข้าแชนแนล LINE Login ที่เพิ่งสร้าง > แท็บ **LIFF** > กด **Add**
   - LIFF app name: ระบบลาออนไลน์
   - Size: **Full**
   - Endpoint URL: วาง **URL ของ GitHub Pages** จากข้อ 6.1 (ไม่ใช่ Web app URL ของ Apps Script!)
   - Scope: ติ๊ก `profile`
   - Bot link feature: On (Aggressive) — ตอนเลือก On จะให้เลือก Bot ที่จะผูก ให้เลือก
     Messaging API channel จากขั้นตอนที่ 3 (เพื่อให้ LIFF นี้ทำงานผ่าน LINE OA ตัวเดิม)
3. กด Add จะได้ **LIFF ID** (รูปแบบ `1234567890-abcdefgh`) คัดลอกไว้
4. เอา LIFF ID ไปใส่ในไฟล์ `web/index.html` ตรงตัวแปร `LIFF_ID` (ถ้ายังไม่ตรง)
   แล้วอัปโหลดไฟล์ทับใน GitHub อีกครั้ง
5. ทดสอบเปิดแอปผ่านลิงก์ `https://liff.line.me/<LIFF_ID>` (เปิดในแอป LINE บนมือถือ)

> ถ้าสร้าง LIFF app ไว้แล้ว: เข้าไปแก้ **Endpoint URL** ของ LIFF ตัวเดิมให้เป็น URL
> ของ GitHub Pages ก็พอ ไม่ต้องสร้างใหม่ (LIFF ID เดิมใช้ต่อได้เลย)

---

## ขั้นตอนที่ 7: ตั้งค่า Webhook (สำหรับปุ่มอนุมัติ/ไม่อนุมัติใน LINE)

1. กลับไปที่แท็บ **Messaging API** ของแชนแนล
2. ช่อง **Webhook URL** ใส่:
   `<Web app URL จากขั้นตอนที่ 4>?token=<WEBHOOK_TOKEN จากขั้นตอนที่ 5>`
   ตัวอย่าง: `https://script.google.com/macros/s/xxxx/exec?token=abc123secret`
3. กด **Verify** ควรขึ้น Success (ถ้า error ตรวจสอบว่า deploy web app แล้วและ access = Anyone)
4. เปิด (Enable) **Use webhook**

---

## ขั้นตอนที่ 8: ผูกผู้อนุมัติ 2 ขั้น (ผจก.ฝ่าย + HR)

ระบบอนุมัติมี 2 ขั้น: พนักงานยื่น → **ขั้นที่ 1: ผู้จัดการฝ่าย** ของแผนกนั้น →
**ขั้นที่ 2: ฝ่ายบุคคล (HR)** → อนุมัติสมบูรณ์ (หักวันลาตอน HR อนุมัติเท่านั้น
ปฏิเสธขั้นไหนก็ตาม = จบ ไม่หักวันลา)

ผู้อนุมัติทุกคนต้องลงทะเบียนผ่านแอปก่อน เพื่อให้ระบบรู้จัก `LineUserId`:

1. เพิ่มเพื่อน LINE OA ของบริษัท (QR code อยู่ในแท็บ Messaging API > QR code)
2. ให้ ผจก.ฝ่าย และ HR ทุกคน เปิดลิงก์ `https://liff.line.me/<LIFF_ID>`
   แล้วลงทะเบียนตามปกติ — ระบบจะสร้างแถวในชีต **Employees** พร้อม `LineUserId` ให้อัตโนมัติ
3. เปิดชีต **Employees** คัดลอกค่า `LineUserId` ของแต่ละคน แล้วนำไปวาง:
   - **ผจก.ฝ่าย** → ชีต **Departments** ช่อง `ApproverLineUserId` ของแผนกที่ดูแล (1 แผนก 1 คน)
   - **HR** → ชีต **HR** ช่อง `LineUserId` (มีได้หลายคน ทุกคนจะได้รับแจ้งเตือนขั้นที่ 2)
4. เสร็จแล้ว — เมื่อยื่นคำขอลา ผจก.ฝ่ายได้รับ Flex ขั้นที่ 1 ทันที พออนุมัติ HR ทุกคนได้รับ
   Flex ขั้นที่ 2 ต่อ (กดปุ่มใน LINE หรือแท็บ "รออนุมัติ" ในแอปก็ได้ทั้งคู่)

---

## ขั้นตอนที่ 9: เพิ่ม Rich Menu (แนะนำ ไม่บังคับ)

เพื่อให้พนักงานเปิดระบบง่ายจากหน้าแชท LINE OA:

1. แท็บ **Messaging API > Rich menus** หรือใช้ [LINE Official Account Manager](https://manager.line.biz)
2. สร้างเมนู 1 ปุ่มขึ้นไป ผูก Action เป็น **Link** ไปที่ `https://liff.line.me/<LIFF_ID>`

---

## โครงสร้างข้อมูลสรุป

- **Employees**: LineUserId, Name, Department, PictureUrl, ยอดวันลาคงเหลือแต่ละประเภท, RegisteredAt
- **Departments**: Department, ApproverLineUserId, ApproverName — 1 แผนกอนุมัติโดย 1 หัวหน้า
- **LeaveRequests**: ประวัติคำขอลาทั้งหมด สถานะ: PENDING_MANAGER (รอ ผจก.) →
  PENDING_HR (รอ HR) → APPROVED / REJECTED และ `TimePeriod` (FULL = เต็มวัน,
  MORNING = ครึ่งวันเช้า, AFTERNOON = ครึ่งวันบ่าย — ลาครึ่งวันหัก 0.5 วัน)
- **HR**: รายชื่อผู้อนุมัติขั้นที่ 2 (LineUserId, Name) — กรอกตามขั้นตอนที่ 8
- **LeaveTypes**: ประเภทการลา, สี, จำนวนวันเริ่มต้นต่อปี (แก้ไขจำนวนวัน/เพิ่มประเภทลาได้ในชีตนี้โดยตรง
  — key ต้องมี BalanceField ตรงกับคอลัมน์ใน Employees เช่น `AnnualLeaveBalance`)

## การอัปเดตโค้ดในภายหลัง

ระบบแบ่งเป็น 2 ส่วน อัปเดตแยกกัน:

**ฝั่งหน้าเว็บ (`web/index.html`)** — โฮสต์บน GitHub Pages:

1. แก้ไฟล์ `web/index.html` แล้วเข้า repo บน GitHub > เปิดไฟล์ `index.html` >
   ไอคอนดินสอ (Edit) > วางเนื้อหาใหม่ทับ > **Commit changes**
   (หรือ Add file > Upload files ทับไฟล์เดิม)
2. รอ 1-2 นาทีให้ Pages rebuild แล้วเปิดแอปใหม่ (บางทีต้องปิด-เปิด LINE ใหม่เพื่อล้าง cache)

**ฝั่ง backend (ไฟล์ `.gs` ทั้งหมด)** — อยู่ใน Apps Script:

1. คัดลอกไฟล์ `.gs` ที่แก้ไปวางทับใน Apps Script editor ให้ครบ แล้วกด Save ทุกไฟล์
   (ถ้าชื่อไฟล์ในแถบซ้ายมีจุดส้ม แปลว่ายังไม่ได้ save)
2. รัน `setupSpreadsheet` ซ้ำ 1 ครั้ง — ปลอดภัยต่อข้อมูลเดิม ใช้เพิ่มชีต/คอลัมน์ใหม่ที่เพิ่มมา
   ในเวอร์ชันใหม่ (เช่นคอลัมน์ `TimePeriod`) โดยไม่แตะข้อมูลที่มีอยู่
3. Deploy ทับ URL เดิม: **Deploy > Manage deployments > ดินสอ > Version: New version > Deploy**
   (อย่ากด New deployment เพราะจะได้ URL ใหม่ ต้องไปแก้ `API_URL` ใน index.html และ Webhook ตาม)

หมายเหตุ: ไฟล์ `Index.html`, `Stylesheet.html`, `JavaScript.html` ใน Apps Script
ไม่ถูกใช้งานแล้ว (หน้าเว็บย้ายไป GitHub Pages) จะลบทิ้งหรือปล่อยไว้ก็ได้

## การแก้ไขยอดวันลา / ปรับข้อมูลย้อนหลัง

HR แก้ไขตัวเลขในชีต Employees หรือ LeaveRequests ได้โดยตรงเสมอ (เป็นสเปรดชีตธรรมดา)
ระบบจะหักวันลาอัตโนมัติเฉพาะตอนอนุมัติคำขอผ่านแอป/LINE เท่านั้น

## ทดสอบระบบ

1. เปิด `https://liff.line.me/<LIFF_ID>` ด้วยบัญชี LINE ของพนักงานทดสอบ → ลงทะเบียน → ยื่นคำขอลา
2. หัวหน้าแผนก (ที่ผูกไว้ในขั้นตอนที่ 8) ควรได้รับข้อความใน LINE ทันที กดปุ่มอนุมัติ/ไม่อนุมัติได้เลย
3. พนักงานจะได้รับข้อความแจ้งผลกลับ และยอดวันลาคงเหลือจะอัปเดตในแท็บแรกของแอป
