/**
 * ==========================================================================
 * AUT CMMS - Central LIFF Authentication Service (liff-auth.js)
 * ==========================================================================
 */

const LiffAuth = (function () {
  // Config: กำหนด LIFF ID กลางของระบบ (ตรงกับที่ตั้งค่าใน Rich Menu)
  const DEFAULT_LIFF_ID = "2011076529-EKhCiseU";
  //const DEFAULT_LIFF_ID = "2011050588-FTDVMv4L";

  const STORAGE_KEY = "cmms_user_session";

  let currentUser = null;
  let isInitialized = false;

  /**
   * แสดง Loading Overlay
   */
  function showLoading(text, subText) {
    const overlay = document.getElementById("loadingOverlay");
    const textEl = document.getElementById("loadingText");
    const subTextEl = document.getElementById("loadingSubText");

    if (textEl && text) textEl.textContent = text;
    if (subTextEl && subText) subTextEl.textContent = subText;
    if (overlay) {
      overlay.style.display = "flex";
      overlay.classList.remove("loading-hide");
    }
  }

  /**
   * ซ่อน Loading Overlay
   */
  function hideLoading() {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) return;
    overlay.classList.add("loading-hide");
    setTimeout(() => {
      if (overlay.classList.contains("loading-hide")) {
        overlay.style.display = "none";
      }
    }, 280);
  }

  /**
   * ตรวจสอบว่าเปิดใช้งานผ่าน LINE App หรือไม่
   */
  function isInLiff() {
    return typeof liff !== "undefined" && liff.isInClient && liff.isInClient();
  }

  /**
   * ดึงข้อมูล User จาก LocalStorage
   */
  function getCachedUser() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("userSession");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Failed to parse cached user:", e);
    }
    return null;
  }

  /**
   * บันทึกข้อมูล User ลง LocalStorage
   */
  function saveUser(user) {
    currentUser = user;
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
      // เก็บ backward compatibility ด้วย
      localStorage.setItem("userSession", JSON.stringify(user));
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("userSession");
    }
  }

  /**
   * บันทึกการเข้าสู่ระบบผ่าน Username/Password
   */
  function loginWithCredentials(userData) {
    currentUser = {
      userId: userData.userId || userData.line_user_id || userData.id || userData.username,
      displayName: userData.displayName || userData.name || userData.username,
      name: userData.name || userData.displayName || userData.username,
      pictureUrl: userData.pictureUrl || "",
      isLoggedIn: true,
      authSource: "credentials",
      role: userData.role || userData.accessRights || "user",
      accessRights: userData.accessRights || userData.role || "user",
      deptCode: userData.deptCode || userData.dept_code || "",
      empCode: userData.empCode || userData.emp_code || "",
      username: userData.username || ""
    };
    saveUser(currentUser);
    try {
      localStorage.setItem(`cmms_user_sheet_${currentUser.userId}`, JSON.stringify(currentUser));
    } catch (e) { }
    return currentUser;
  }

  /**
   * เริ่มต้นระบบ LIFF และดึง User Profile
   * @param {Object} options - { liffId, requiredAuth: true/false, onReady: Function }
   */
  async function init(options = {}) {
    const liffId = options.liffId || DEFAULT_LIFF_ID;
    const requiredAuth = options.requiredAuth !== false; // default true

    // ตรวจสอบก่อนว่าเคยเข้าสู่ระบบไว้หรือไม่ (ไม่ว่าจะเป็น Username/Password หรือ Session LINE เดิม)
    const cachedEarly = getCachedUser();
    if (cachedEarly && cachedEarly.isLoggedIn && cachedEarly.userId) {
      currentUser = cachedEarly;
      if (typeof liff !== "undefined") {
        liff.init({ liffId }).catch(e => console.warn("Background LIFF init:", e));
      }
      hideLoading();
      if (typeof options.onReady === "function") {
        options.onReady(currentUser);
      }
      return currentUser;
    }

    showLoading("กำลังเชื่อมต่อระบบ LINE...", "กรุณารอสักครู่");

    try {
      // 1. ตรวจสอบว่า LIFF SDK โหลดเสร็จหรือยัง
      if (typeof liff === "undefined") {
        console.warn("LIFF SDK not found in window");
        throw new Error("ไม่สามารถโหลด LINE LIFF SDK ได้ กรุณาเชื่อมต่ออินเทอร์เน็ต");
      }

      // 2. เรียก liff.init พร้อม Timeout 3.5 วินาทีเพื่อไม่ให้ค้างหน้าโหลด
      await Promise.race([
        liff.init({ liffId }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("LIFF connection timeout")), 3500))
      ]);
      isInitialized = true;

      // 3. ตรวจสอบสถานะการเข้าสู่ระบบ
      if (liff.isLoggedIn()) {
        showLoading("กำลังดึงข้อมูลผู้ใช้งาน...", "กรุณารอสักครู่");
        const profile = await liff.getProfile();
        const idToken = liff.getIDToken ? liff.getIDToken() : null;

        currentUser = {
          userId: profile.userId || "",
          displayName: profile.displayName || "ผู้ใช้งาน LINE",
          name: profile.displayName || "ผู้ใช้งาน LINE",
          pictureUrl: profile.pictureUrl || "",
          statusMessage: profile.statusMessage || "",
          idToken: idToken,
          isLoggedIn: true,
          authSource: "liff",
          deptCode: "",
          empCode: "",
          accessRights: "user"
        };

        // ตรวจสอบและ Auto-Register ผู้ใช้ใน Google Sheets (GAS Backend)
        try {
          if (typeof CmmsApi !== "undefined" && CmmsApi.getUserProfile) {
            const apiRes = await CmmsApi.getUserProfile(currentUser.userId, {
              name: currentUser.displayName,
              displayName: currentUser.displayName,
              pictureUrl: currentUser.pictureUrl
            });

            if (apiRes && apiRes.status === "success" && apiRes.data) {
              const uData = apiRes.data;
              currentUser.deptCode = uData.dept_code || uData.deptCode || "";
              currentUser.empCode = uData.emp_code || uData.empCode || "";
              currentUser.username = uData.username || "";
              currentUser.status = uData.status || "Active";
              currentUser.accessRights = uData.access_rights || uData.accessRights || uData.role || "user";
              currentUser.access_rights = currentUser.accessRights;
              currentUser.role = uData.role || uData.access_rights || uData.accessRights || "user";
              if (uData.display_name) {
                currentUser.displayName = uData.display_name;
              }
              // Cache sheet profile so all pages can access instantly
              try {
                localStorage.setItem(`cmms_user_sheet_${currentUser.userId}`, JSON.stringify(uData));
              } catch (e) { }

              // ถ้าเป็น User ใหม่ หรือ ยังไม่ได้ระบุแผนก -> แสดง Modal แจ้งเตือนให้อัปเดต
              const isProfilePage = window.location.pathname.toLowerCase().includes("profile.html");
              if ((apiRes.isNewUser || apiRes.needsProfileUpdate || !currentUser.deptCode) && !isProfilePage) {
                setTimeout(() => {
                  showProfileUpdatePrompt(apiRes.isNewUser);
                }, 400);
              }
            }
          }
        } catch (backendErr) {
          console.warn("GAS User Profile sync warning:", backendErr);
        }

        saveUser(currentUser);
        hideLoading();

        if (typeof options.onReady === "function") {
          options.onReady(currentUser);
        }
        return currentUser;
      }

      // 4. กรณีเปิดใน LINE App แต่ยังไม่ได้ Login
      if (liff.isInClient()) {
        showLoading("กำลังเข้าสู่ระบบ LINE...", "ระบบจะนำท่านเข้าสู่ระบบ");
        liff.login();
        return null;
      }

      // 5. กรณีเปิดใน External Browser ปกติ
      // ตรวจสอบว่ามี cached session เดิมที่ยังล็อกอินอยู่หรือไม่
      const cached = getCachedUser();
      if (cached && cached.isLoggedIn && cached.userId) {
        currentUser = cached;
        hideLoading();
        if (typeof options.onReady === "function") {
          options.onReady(currentUser);
        }
        return currentUser;
      }

      /**
       * คำนวณ URL ปลายทางให้ถูกต้องตามสภาพแวดล้อม (LINE LIFF, GitHub Pages, Localhost)
       * ป้องกันปัญหา 404 เมื่อเปลี่ยนหน้า
       */
      function getNavigationUrl(targetPage) {
        if (!targetPage) return "index.html";
        if (targetPage.startsWith("http://") || targetPage.startsWith("https://") || targetPage.startsWith("//")) {
          return targetPage;
        }
        // 1. กรณีอยู่บน liff.line.me เช่น https://liff.line.me/2011076529-EKhCiseU/...
        if (window.location.hostname === "liff.line.me") {
          const parts = window.location.pathname.split("/").filter(Boolean);
          const liffId = parts[0] || DEFAULT_LIFF_ID;
          return `https://liff.line.me/${liffId}/${targetPage.replace(/^\/+/, "")}`;
        }
        // 2. กรณีอยู่บน GitHub Pages หรือ Subdirectory ทั่วไป
        const pathname = window.location.pathname;
        const dir = pathname.substring(0, pathname.lastIndexOf("/") + 1) || "./";
        return dir + targetPage.replace(/^\/+/, "");
      }

      // หากจำเป็นต้อง Auth แต่เปิดใน Browser ทั่วไป -> redirect ไปหน้า Login
      if (requiredAuth) {
        hideLoading();
        const currentFile = window.location.pathname.split("/").pop() || "index.html";
        const redirectParam = encodeURIComponent(currentFile + window.location.search);
        window.location.href = getNavigationUrl(`login.html?redirect=${redirectParam}`);
        return null;
      } else {
        // อนุญาต Guest
        currentUser = {
          userId: "",
          displayName: "ผู้เยี่ยมชม (Guest)",
          pictureUrl: "",
          isLoggedIn: false,
          authSource: "guest"
        };
        hideLoading();
        if (typeof options.onReady === "function") {
          options.onReady(currentUser);
        }
        return currentUser;
      }

    } catch (err) {
      console.error("LiffAuth.init Error:", err);
      // Fallback จาก LocalStorage หาก offline หรือมีปัญหา
      const cached = getCachedUser();
      if (cached && cached.isLoggedIn && cached.userId) {
        currentUser = cached;
        hideLoading();
        if (typeof options.onReady === "function") {
          options.onReady(currentUser);
        }
        return currentUser;
      }

      hideLoading();
      if (requiredAuth) {
        const currentFile = window.location.pathname.split("/").pop() || "index.html";
        const redirectParam = encodeURIComponent(currentFile + window.location.search);
        window.location.href = getNavigationUrl(`login.html?redirect=${redirectParam}`);
        return null;
      }

      // สร้าง Guest User fallback
      currentUser = {
        userId: "",
        displayName: "ผู้เยี่ยมชม (Guest)",
        pictureUrl: "",
        isLoggedIn: false,
        authSource: "fallback"
      };

      if (typeof options.onReady === "function") {
        options.onReady(currentUser);
      }
      return currentUser;
    }
  }

  /**
   * ดึงข้อมูลผู้ใช้งานปัจจุบัน
   */
  function getUser() {
    const u = currentUser || getCachedUser();
    if (u && u.isLoggedIn && u.userId) {
      return u;
    }
    return null;
  }

  /**
   * สแกน QR Code ผ่าน LIFF (สำหรับหน้าสร้าง Ticket)
   */
  async function scanQRCode() {
    if (typeof liff !== "undefined" && liff.isInClient && liff.isInClient() && liff.scanCodeV2) {
      try {
        const res = await liff.scanCodeV2();
        return res ? (res.value || "").trim() : "";
      } catch (err) {
        console.warn("QR Scan error:", err);
        throw err;
      }
    } else {
      throw new Error("การสแกน QR Code รองรับเฉพาะบนแอปพลิเคชัน LINE บนมือถือเท่านั้น");
    }
  }

  /**
   * ออกจากระบบ
   */
  function logout() {
    saveUser(null);
    if (typeof liff !== "undefined" && liff.isLoggedIn && liff.isLoggedIn()) {
      try {
        liff.logout();
      } catch (e) { }
    }
    window.location.href = getNavigationUrl("login.html");
  }

  /**
   * แสดง Modal แจ้งเตือนให้อัปเดตข้อมูลแผนกและ Display Name
   */
  function showProfileUpdatePrompt(isNewUser = false) {
    if (document.getElementById("profilePromptModal")) return;

    const title = isNewUser ? "ยินดีต้อนรับสมาชิกใหม่! 🎉" : "กรุณาอัปเดตข้อมูลโปรไฟล์ 📋";
    const desc = isNewUser
      ? "ระบบได้ลงทะเบียนบัญชี LINE ของท่านเรียบร้อยแล้ว กรุณาระบุ <strong>แผนก (Department)</strong> และตรวจสอบ <strong>ชื่อที่ใช้แสดง</strong> เพื่อความถูกต้องในการแจ้งซ่อมและมอบหมายงาน"
      : "ท่านยังไม่ได้ระบุ <strong>แผนก (Department)</strong> กรุณาอัปเดตข้อมูลเพื่อให้ระบบสามารถส่งต่องานและแจ้งเตือนได้อย่างถูกต้อง";

    const modalHtml = `
      <div id="profilePromptModal" style="
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(15, 23, 42, 0.65); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center; padding: 20px;
        animation: fadeInPrompt 0.25s ease-out;
      ">
        <div style="
          background: white; border-radius: 20px; max-width: 360px; width: 100%;
          padding: 24px 20px; text-align: center; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.2);
          animation: scaleUpPrompt 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        ">
          <div style="
            width: 56px; height: 56px; border-radius: 50%; background: #eff6ff;
            color: #2563eb; display: inline-flex; align-items: center; justify-content: center;
            font-size: 26px; margin: 0 auto 14px;
          ">
            <i class="fa-solid fa-id-card"></i>
          </div>
          <h3 style="font-size: 16px; font-weight: 700; color: #1e293b; margin: 0 0 8px;">${title}</h3>
          <p style="font-size: 12.5px; color: #64748b; line-height: 1.55; margin: 0 0 20px;">
            ${desc}
          </p>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <a href="profile.html" style="
              display: inline-flex; align-items: center; justify-content: center; gap: 8px;
              padding: 12px; background: #2563eb; color: white; border-radius: 12px;
              font-size: 13px; font-weight: 700; text-decoration: none; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
            ">
              <i class="fa-solid fa-user-pen"></i> ไปตั้งค่าโปรไฟล์และแผนก
            </a>
            <button type="button" onclick="document.getElementById('profilePromptModal').remove()" style="
              padding: 10px; background: transparent; color: #94a3b8; border: none;
              font-size: 12px; font-weight: 600; cursor: pointer;
            ">
              ไว้ภายหลัง
            </button>
          </div>
        </div>
      </div>
      <style>
        @keyframes fadeInPrompt { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUpPrompt { from { transform: scale(0.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      </style>
    `;

    document.body.insertAdjacentHTML("beforeend", modalHtml);
  }

  // Public API
  return {
    init,
    getUser,
    saveUser,
    loginWithCredentials,
    logout,
    scanQRCode,
    showLoading,
    hideLoading,
    showProfileUpdatePrompt,
    isInLiff,
    getNavigationUrl,
    DEFAULT_LIFF_ID
  };
})();

// ให้เข้าถึงได้ทั่วโลก
window.LiffAuth = LiffAuth;
