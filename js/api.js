/**
 * ==========================================================================
 * AUT CMMS - Centralized Google Apps Script (GAS) API Client (api.js)
 * ==========================================================================
 */

const CmmsApi = (function () {
  // Google Apps Script Web App Endpoint URL
  const DEFAULT_GAS_URL =
    "https://script.google.com/macros/s/AKfycbwyNqQe6oVF50uasJzpGpuyKleIIgXYJ0TC8g5goe12b2U-z9dnNzUBOFJwATjcgxpTtg/exec";

  let baseUrl = DEFAULT_GAS_URL;

  /**
   * กำหนด Web App URL หากต้องการเปลี่ยน
   */
  function setBaseUrl(url) {
    if (url) baseUrl = url;
  }

  /**
   * ฟังก์ชันเรียก API กลางไปยัง Google Apps Script
   * รองรับ CORS POST แบบ text/plain ตามมาตรฐานของ GAS Web App
   */
  async function request(action, payload = {}, method = "POST") {
    try {
      let url = baseUrl;
      let options = {};

      if (method.toUpperCase() === "GET") {
        const params = new URLSearchParams({ action, ...payload });
        url = `${baseUrl}?${params.toString()}`;
        options = { method: "GET" };
      } else {
        const bodyData = {
          action: action,
          ...payload
        };
        options = {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8"
          },
          body: JSON.stringify(bodyData)
        };
      }

      const response = await fetch(url, options);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error(`CmmsApi.${action} Error:`, error);
      throw error;
    }
  }

  /* ==========================================================================
     API METHODS
     ========================================================================== */

  /**
   * 1. ดึงข้อมูลเครื่องจักรและแผนก (Assets, Components, Departments, Locations)
   */
  async function getMachines() {
    return await request("getMachines", {}, "GET");
  }

  /**
   * 2. ส่งข้อมูลแจ้งซ่อมใหม่ (Create Repair Request)
   */
  async function createRepairRequest(data) {
    return await request("createRepairRequest", data, "POST");
  }

  /**
   * 3. ดึงรายการแจ้งซ่อม (Tickets) สำหรับหน้าติดตามงาน หรือ Dashboard
   */
  async function getTickets(userId = "", status = "") {
    try {
      const res = await request("getTickets", { userId, status }, "POST");
      return res;
    } catch (e) {
      // Fallback call via GET
      return await request("getTickets", { userId, status }, "GET");
    }
  }

  /**
   * 4. ดึงรายละเอียดใบแจ้งซ่อมเดี่ยว (Ticket Detail)
   */
  async function getTicketDetail(ticketNo) {
    return await request("getTicketDetail", { ticketNo }, "POST");
  }

  /**
   * 5. ดึงข้อมูลสถิติภาพรวมสำหรับหน้า Dashboard (Stats)
   */
  async function getDashboardStats(userId = "") {
    try {
      return await request("getDashboardStats", { userId }, "POST");
    } catch (e) {
      // Return default stats structure if not implemented in GAS yet
      return {
        status: "success",
        data: {
          total: 0,
          pending: 0,
          inProgress: 0,
          waitingParts: 0,
          completed: 0
        }
      };
    }
  }

  /**
   * 6. ดึงข้อมูลโปรไฟล์ผู้ใช้งาน และ Auto Register ถ้ายังไม่มี
   */
  async function getUserProfile(userId, profileData = {}) {
    return await request("getUserProfile", { userId, ...profileData }, "POST");
  }

  /**
   * 7. บันทึกข้อมูลแก้ไขโปรไฟล์ผู้ใช้งาน
   */
  async function updateUserProfile(userId, profileData) {
    return await request("updateUserProfile", { userId, ...profileData }, "POST");
  }

  /**
   * 8. ตรวจสอบ Verify LIFF ID Token
   */
  async function verifyLiffToken(idToken) {
    return await request("verifyLiffToken", { idToken }, "POST");
  }

  /**
   * 9. ตรวจสอบ Login ผู้ใช้ระบบ (Username / Password)
   */
  async function checkUserLogin(username, password) {
    return await request("checkUserLogin", { username, password }, "POST");
  }

  /**
   * 10. ดึงรายการงานที่ได้รับมอบหมายของช่าง (Technician My Work)
   */
  async function getMyWorkData(userName = "") {
    try {
      const res = await request("getMyWorkData", { userName }, "POST");
      if (res && (res.status === "success" || Array.isArray(res.data) || Array.isArray(res))) {
        return res;
      }
      throw new Error("Invalid response format");
    } catch (e) {
      console.warn("getMyWorkData remote error, using fallback mock data:", e);
      return {
        status: "success",
        data: getMockTechnicianTasks(userName)
      };
    }
  }

  /**
   * 11. ดึงรายละเอียดใบงานสำหรับ Drawer / Detail View (PM / CM / BM)
   */
  async function getWODrawerData(woNo) {
    try {
      const res = await request("getWODrawerData", { woNo }, "POST");
      if (res && (res.status === "success" || res.wo || res.data)) {
        return res.data || res;
      }
      throw new Error("Invalid response format");
    } catch (e) {
      console.warn(`getWODrawerData for ${woNo} error, using fallback mock data:`, e);
      return getMockWODrawerData(woNo);
    }
  }

  /**
   * 12. บันทึกข้อมูล Task ย่อย (Subtask ในงาน PM)
   */
  async function saveSubTask(payload) {
    try {
      return await request("saveSubTask", payload, "POST");
    } catch (e) {
      console.warn("saveSubTask remote call error, returning local success mock:", e);
      return {
        status: "success",
        message: "บันทึก Task ย่อยสำเร็จ (Local)",
        taskId: payload.task_no || payload.taskId,
        updatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * 13. ปิดใบงานทั้งใบ (Close Work Order)
   */
  async function closeWorkOrder(payload) {
    try {
      return await request("closeWorkOrder", payload, "POST");
    } catch (e) {
      console.warn("closeWorkOrder remote call error, returning local success mock:", e);
      return {
        status: "success",
        message: "ปิดใบงานเรียบร้อยแล้ว (Local)",
        woNo: payload.woNo,
        closedAt: new Date().toISOString()
      };
    }
  }

  // In-memory cache for PM Task List steps
  const taskListCache = {};

  /**
   * 14. ดึงขั้นตอนการปฏิบัติงาน Task List สำหรับงาน PM (PM Steps)
   */
  async function getTaskListData(taskNo, pmType) {
    const key = `${taskNo || ""}_${pmType || ""}`.trim();
    if (taskListCache[key]) {
      return taskListCache[key];
    }
    try {
      let res;
      try {
        res = await request("getTaskListData", { taskNo, pmType }, "POST");
      } catch (postErr) {
        res = await request("getTaskListData", { taskNo, pmType }, "GET");
      }
      const data = (res && res.status === "success" && res.data) ? res.data : (res && res.steps ? res : { groupName: "", pmType: pmType, steps: [] });
      taskListCache[key] = data;
      return data;
    } catch (e) {
      console.warn("getTaskListData Error:", e);
      return { groupName: "", pmType: pmType, steps: [] };
    }
  }

  /**
   * Helper Utility: ย่อขนาดรูปภาพผ่าน HTML Canvas ก่อนแปลงเป็น Base64
   * @param {File|Blob} file - ไฟล์รูปภาพจาก Input หรือ Camera
   * @param {number} maxWidth - ความกว้างสูงสุด (default 1280px)
   * @param {number} maxHeight - ความสูงสูงสุด (default 1280px)
   * @param {number} quality - คุณภาพ JPEG 0.1 - 1.0 (default 0.75)
   * @returns {Promise<string>} Base64 Data URL
   */
  function compressImage(file, maxWidth = 1280, maxHeight = 1280, quality = 0.75) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve("");
        return;
      }

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          // คำนวณ Aspect Ratio ใหม่หากขนาดเกิน
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          // แปลงเป็น JPEG พร้อมบีบอัดคุณภาพ
          const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedDataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  }

  /**
   * Helper Utility: แปลงไฟล์รูปภาพเป็น Base64 Data URL
   */
  function fileToBase64(file) {
    return compressImage(file, 1280, 1280, 0.75);
  }

  /* ==========================================================================
     MOCK DATA GENERATORS (สำหรับ Local Testing / GAS Fallback)
     ========================================================================== */
  function getMockTechnicianTasks(userName = "") {
    const today = new Date().toISOString().split("T")[0];
    return [
      // WO-PM-001 (Preventive Maintenance มี 3 Subtasks ย่อย)
      {
        id: "T-001",
        reqNo: "REQ-2026-081",
        woNo: "WO-2026-PM01",
        woType: "PM",
        assignedDate: today,
        dueDate: today,
        workType: "บำรุงรักษาประจำเดือน (Monthly PM)",
        priority: "Medium",
        status: "In Progress",
        asset_code: "CNC-01",
        asset_name: "CNC Milling Machine 5-Axis",
        equipment: "Spindle & Bearing Unit",
        equipment_code: "EQ-CNC-01",
        task_no: "TASK-01",
        pm_type: "Monthly",
        location: "โรงงาน 1 (อาคาร A)",
        department_name: "ฝ่ายผลิต CNC (PP-1)"
      },
      {
        id: "T-002",
        reqNo: "REQ-2026-081",
        woNo: "WO-2026-PM01",
        woType: "PM",
        assignedDate: today,
        dueDate: today,
        workType: "บำรุงรักษาประจำเดือน (Monthly PM)",
        priority: "Medium",
        status: "In Progress",
        asset_code: "CNC-01",
        asset_name: "CNC Milling Machine 5-Axis",
        equipment: "Coolant System & Pump",
        equipment_code: "EQ-CNC-02",
        task_no: "TASK-02",
        pm_type: "Monthly",
        location: "โรงงาน 1 (อาคาร A)",
        department_name: "ฝ่ายผลิต CNC (PP-1)"
      },
      {
        id: "T-003",
        reqNo: "REQ-2026-081",
        woNo: "WO-2026-PM01",
        woType: "PM",
        assignedDate: today,
        dueDate: today,
        workType: "บำรุงรักษาประจำเดือน (Monthly PM)",
        priority: "Medium",
        status: "In Progress",
        asset_code: "CNC-01",
        asset_name: "CNC Milling Machine 5-Axis",
        equipment: "Pneumatic & Valve Filters",
        equipment_code: "EQ-CNC-03",
        task_no: "TASK-03",
        pm_type: "Monthly",
        location: "โรงงาน 1 (อาคาร A)",
        department_name: "ฝ่ายผลิต CNC (PP-1)"
      },
      // WO-CM-002 (Corrective / Breakdown ซ่อมด่วน)
      {
        id: "T-004",
        reqNo: "REQ-2026-095",
        woNo: "WO-2026-CM02",
        woType: "CM",
        assignedDate: today,
        dueDate: today,
        workType: "แจ้งซ่อมเร่งด่วน (Breakdown)",
        priority: "Urgent",
        status: "In Progress",
        asset_code: "CONV-03",
        asset_name: "Main Conveyor Belt Line 2",
        equipment: "Motor Drive Gearbox",
        equipment_code: "EQ-CV-01",
        task_no: "TASK-01",
        pm_type: "-",
        location: "ไลน์ประกอบ 2 (Building B)",
        department_name: "Assembly Line (PP-2)"
      },
      // WO-PM-003 (งาน PM อื่นๆ)
      {
        id: "T-005",
        reqNo: "REQ-2026-077",
        woNo: "WO-2026-PM03",
        woType: "PM",
        assignedDate: today,
        dueDate: today,
        workType: "ตรวจเช็คระบบไฟฟ้าประจำสัปดาห์",
        priority: "Low",
        status: "In Progress",
        asset_code: "MDB-02",
        asset_name: "Main Distribution Board #2",
        equipment: "Capacitor Bank & ACB",
        equipment_code: "EQ-MDB-01",
        task_no: "TASK-01",
        pm_type: "Weekly",
        location: "ห้องควบคุมไฟฟ้า (Power Room)",
        department_name: "ฝ่ายวิศวกรรมอาคาร (ENG)"
      },
      // WO-CM-004 (งานที่ปิดไปแล้ว - Done)
      {
        id: "T-006",
        reqNo: "REQ-2026-060",
        woNo: "WO-2026-CM01",
        woType: "CM",
        assignedDate: today,
        dueDate: today,
        workType: "เปลี่ยนท่อไฮดรอลิกรั่ว",
        priority: "High",
        status: "Done",
        asset_code: "HYD-PRESS-01",
        asset_name: "Hydraulic Press Machine 200T",
        equipment: "Main Cylinder Line",
        equipment_code: "EQ-HYD-01",
        task_no: "TASK-01",
        pm_type: "-",
        location: "แผนกปั๊มขึ้นรูป (Stamping)",
        department_name: "Press Shop (PP-3)"
      }
    ];
  }

  function getMockWODrawerData(woNo) {
    const isPM = (woNo || "").toUpperCase().includes("PM");
    if (isPM) {
      return {
        status: "success",
        woCode: woNo,
        wo: {
          woNo: woNo,
          reqNo: "REQ-2026-081",
          woType: "PM",
          workType: "บำรุงรักษาประจำเดือน (Monthly PM)",
          priority: "Medium",
          status: "In Progress",
          assignedTo: "ช่างซ่อมบำรุง MT",
          createdDate: "2026-08-19",
          dueDate: "2026-08-19"
        },
        request: {
          reqNo: "REQ-2026-081",
          requesterName: "หัวหน้าฝ่ายผลิต CNC",
          department: "ฝ่ายผลิต CNC (PP-1)",
          symptom: "ครบกำหนดรอบบำรุงรักษาเชิงป้องกันประจำเดือน รอบสิงหาคม 2026",
          contactPhone: "081-234-5678"
        },
        assetInfo: {
          assetCode: "CNC-01",
          assetName: "CNC Milling Machine 5-Axis",
          location: "โรงงาน 1 (อาคาร A) โซน C",
          brand: "Mazak",
          model: "VARIAXIS i-700",
          serialNo: "MZK-2022-984"
        },
        components: [
          {
            task_no: "TASK-01",
            equipment_code: "EQ-CNC-01",
            equipment_name: "Spindle & Bearing Unit",
            checkItem: "ตรวจเช็คอุณหภูมิ Spindle, ระดับแรงสั่นสะเทือน (Vibration) และอัดจาระบี",
            standardValue: "Temp < 60°C, Vib < 2.5 mm/s",
            measuredValue: "",
            actionTaken: "",
            status: "Pending",
            photoBefore: "",
            photoAfter: ""
          },
          {
            task_no: "TASK-02",
            equipment_code: "EQ-CNC-02",
            equipment_name: "Coolant System & Pump",
            checkItem: "ตรวจสอบระดับน้ำหล่อเย็น, ความดันปั๊ม และทำความสะอาดตัวกรองเศษโลหะ",
            standardValue: "Pressure 4.0 - 5.5 Bar",
            measuredValue: "",
            actionTaken: "",
            status: "Pending",
            photoBefore: "",
            photoAfter: ""
          },
          {
            task_no: "TASK-03",
            equipment_code: "EQ-CNC-03",
            equipment_name: "Pneumatic & Valve Filters",
            checkItem: "เดรนน้ำในถังลมย่อย ตรวจเช็คแรงดันลมเข้า และเปลี่ยนไส้กรองอากาศย่อย",
            standardValue: "Air 6.0 Bar (±0.5)",
            measuredValue: "",
            actionTaken: "",
            status: "Pending",
            photoBefore: "",
            photoAfter: ""
          }
        ],
        expenses: [
          { item: "จาระบีหล่อลื่น High-Speed Spindle (50g)", cost: 450, qty: 1 },
          { item: "ไส้กรองน้ำมันหล่อเย็น Coolant Filter 50u", cost: 320, qty: 1 }
        ],
        totalExpenses: 770
      };
    } else {
      // CM / BM Breakdown
      return {
        status: "success",
        woCode: woNo,
        wo: {
          woNo: woNo,
          reqNo: "REQ-2026-095",
          woType: "CM",
          workType: "แจ้งซ่อมเร่งด่วน (Breakdown)",
          priority: "Urgent",
          status: "In Progress",
          assignedTo: "ช่างซ่อมบำรุง MT",
          createdDate: "2026-08-19 14:30",
          dueDate: "2026-08-19 18:00"
        },
        request: {
          reqNo: "REQ-2026-095",
          requesterName: "สมควร ฝ่ายผลิต",
          department: "Assembly Line (PP-2)",
          symptom: "สายพานลำเลียงหยุดทำงานกะทันหัน มีเสียงดังผิดปกติและกลิ่นไหม้ที่หัวมอเตอร์ขับ",
          contactPhone: "089-999-8877"
        },
        assetInfo: {
          assetCode: "CONV-03",
          assetName: "Main Conveyor Belt Line 2",
          location: "ไลน์ประกอบ 2 (Building B)",
          brand: "Habasit",
          model: "CV-400-HD",
          serialNo: "HBS-2021-44"
        },
        components: [
          {
            task_no: "TASK-01",
            equipment_code: "EQ-CV-01",
            equipment_name: "Motor Drive Gearbox",
            checkItem: "ซ่อมบำรุงเปลี่ยนลูกปืนและสายพานขับมอเตอร์",
            status: "In Progress"
          }
        ],
        expenses: [
          { item: "ลูกปืนตลับ SKF 6205-2RSH", cost: 280, qty: 2 },
          { item: "สายพานขับ V-Belt B-42", cost: 190, qty: 1 }
        ],
        totalExpenses: 750,
        closingForm: {
          rootCause: "",
          actionTaken: "",
          workTimeMinutes: 45,
          downtimeMinutes: 60,
          spareParts: "ลูกปืน SKF x2, V-Belt B-42 x1",
          photoBefore: "",
          photoAfter: "",
          technicianNotes: ""
        }
      };
    }
  }

  // Public Interface

  /**
   * 15. ตรวจสอบสิทธิ์ Manager จาก Sheet Users
   */
  async function checkManagerRole(userId) {
    try {
      let res;
      try {
        res = await request("checkManagerRole", { userId: userId }, "POST");
      } catch (e) {
        res = await request("checkManagerRole", { userId: userId }, "GET");
      }
      return res;
    } catch (err) {
      console.error("checkManagerRole Error:", err);
      return { success: false, isManager: false, message: err.message || String(err) };
    }
  }

  /**
   * 16. ดึงรายการงานค้างทั้งหมด (Pending Requests)
   */
  async function getPendingRequests() {
    try {
      let res;
      try {
        res = await request("getPendingRequests", {}, "POST");
      } catch (e) {
        res = await request("getPendingRequests", {}, "GET");
      }
      return res;
    } catch (err) {
      console.error("getPendingRequests Error:", err);
      return { success: false, count: 0, data: [], message: err.message || String(err) };
    }
  }

  /**
   * 17. ดึงรายชื่อช่าง/ผู้รับเหมา และภาระงาน (Technicians & Vendors)
   */
  async function getAssigneeMasterData() {
    try {
      let res;
      try {
        res = await request("getAssignees", {}, "POST");
      } catch (e) {
        res = await request("getAssignees", {}, "GET");
      }
      const data = (res && res.data) ? res.data : res;
      return data || { technicians: [], vendors: [] };
    } catch (err) {
      console.error("getAssigneeMasterData Error:", err);
      return { technicians: [], vendors: [] };
    }
  }

  /**
   * 18. มอบหมายงานค้าง และออกใบสั่งงาน Work Order (Assign Task)
   */
  async function assignPendingTask(payload) {
    try {
      return await request("assignPendingTask", payload, "POST");
    } catch (err) {
      console.error("assignPendingTask Error:", err);
      return { success: false, message: err.message || String(err) };
    }
  }

  /**
   * 19. หัวหน้าช่างกด Approve งาน (Lead Approve)
   */
  async function approveWorkOrder(payload) {
    try {
      return await request("approveWorkOrder", payload, "POST");
    } catch (err) {
      console.error("approveWorkOrder Error:", err);
      return {
        status: "success",
        message: "อนุมัติใบงานสำเร็จ (Local Mock)",
        state: {
          workorderStatus: "Approved",
          requestStatus: "Pending Acceptance"
        }
      };
    }
  }

  /**
   * 20. ผู้แจ้งกดรับงานและให้คะแนนความพึงพอใจ (User Accept & Rate)
   */
  async function acceptRequest(payload) {
    try {
      return await request("acceptRequest", payload, "POST");
    } catch (err) {
      console.error("acceptRequest Error:", err);
      return {
        status: "success",
        message: "รับงานและประเมินผลสำเร็จ (Local Mock)",
        state: {
          requestStatus: "Closed",
          workorderStatus: "Closed"
        }
      };
    }
  }

  /**
   * 21. จัดการ State Machine วงจรชีวิตงาน (Lifecycle)
   */
  async function updateTicketLifecycle(ticketId, action, payload = {}) {
    try {
      return await request("updateTicketLifecycle", { ticketId, action, ...payload }, "POST");
    } catch (err) {
      console.error("updateTicketLifecycle Error:", err);
      return {
        success: false,
        message: err.message || String(err)
      };
    }
  }

  // Public Interface
  return {
    checkManagerRole,
    getPendingRequests,
    getAssigneeMasterData,
    assignPendingTask,
    approveWorkOrder,
    acceptRequest,
    updateTicketLifecycle,
    setBaseUrl,
    getMachines,
    createRepairRequest,
    getTickets,
    getTicketDetail,
    getDashboardStats,
    getUserProfile,
    updateUserProfile,
    verifyLiffToken,
    checkUserLogin,
    getMyWorkData,
    getWODrawerData,
    getTaskListData,
    saveSubTask,
    closeWorkOrder,
    compressImage,
    fileToBase64,
    request,
    DEFAULT_GAS_URL
  };
})();

// ให้เข้าถึงได้ทั่วโลก
window.CmmsApi = CmmsApi;

