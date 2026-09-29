/**
 * ==========================================================================
 * AUT CMMS - Web Worker Image Compressor (image-compressor.js)
 * ==========================================================================
 * - ย่อขนาดรูปภาพ: จำกัดความกว้างหรือสูงไม่เกิน 1280px (คง Aspect Ratio)
 * - บีบอัดขนาดไฟล์: ควบคุมขนาดผลลัพธ์ไม่ให้เกิน 500 KB (0.5 MB)
 * - ทำงานบน Web Worker (OffscreenCanvas): ไม่บล็อก Main Thread ทำให้ UI ลื่นไหล ไม่ค้าง
 * - มี Fallback อัตโนมัติสำหรับเบราว์เซอร์ที่ไม่รองรับ Web Worker/OffscreenCanvas
 */

const CmmsImageCompressor = (function () {
  const MAX_DIMENSION = 1280;
  const MAX_FILE_SIZE_BYTES = 500 * 1024; // 512,000 bytes (0.5 MB)
  const DEFAULT_INITIAL_QUALITY = 0.82;

  // โค้ดสำหรับ Web Worker (Inline Blob Worker เพื่อป้องกันปัญหา CORS / file:// ใน LIFF)
  const WORKER_SCRIPT = `
self.onmessage = async function (e) {
  const { id, file, maxWidth, maxHeight, maxSizeBytes, initialQuality } = e.data;

  try {
    // 1. ถอดรหัสภาพด้วย createImageBitmap บน Background Thread
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch (bitmapErr) {
      throw new Error("ไม่สามารถอ่านข้อมูลภาพได้: " + (bitmapErr.message || bitmapErr));
    }

    let origWidth = bitmap.width;
    let origHeight = bitmap.height;
    let targetWidth = origWidth;
    let targetHeight = origHeight;

    // 2. คำนวณ Aspect Ratio ให้ด้านที่ยาวที่สุดไม่เกิน 1280px
    if (targetWidth > maxWidth || targetHeight > maxHeight) {
      if (targetWidth > targetHeight) {
        targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
        targetWidth = maxWidth;
      } else {
        targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
        targetHeight = maxHeight;
      }
    }

    // 3. วาดภาพลงบน OffscreenCanvas
    let canvas = new OffscreenCanvas(targetWidth, targetHeight);
    let ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);

    // 4. วนลูปบีบอัดแบบ Adaptive Compression เพื่อให้ขนาด <= maxSizeBytes (500 KB)
    let quality = initialQuality || 0.82;
    let blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality });

    // Step down คุณภาพทีละนิดหากขนาดไฟล์ยังเกิน 500 KB
    while (blob.size > maxSizeBytes && quality > 0.35) {
      quality = Math.max(0.35, Math.round((quality - 0.08) * 100) / 100);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality });
    }

    // หากขนาดที่ quality 0.35 ยังเกิน 500 KB ให้ย่อขนาด Resolution ลงอีก 15%
    if (blob.size > maxSizeBytes) {
      targetWidth = Math.round(targetWidth * 0.85);
      targetHeight = Math.round(targetHeight * 0.85);
      canvas = new OffscreenCanvas(targetWidth, targetHeight);
      ctx = canvas.getContext("2d", { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
    }

    // 5. แปลง Blob เป็น Data URL Base64
    let dataUrl = "";
    if (typeof FileReaderSync !== "undefined") {
      const reader = new FileReaderSync();
      dataUrl = reader.readAsDataURL(blob);
    } else {
      // Fallback สำหรับ environments ที่ไม่มี FileReaderSync
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      dataUrl = "data:image/jpeg;base64," + btoa(binary);
    }

    // ปิด Bitmap เพื่อคืนหน่วยความจำทันที
    if (bitmap && typeof bitmap.close === "function") {
      bitmap.close();
    }

    self.postMessage({
      id: id,
      success: true,
      dataUrl: dataUrl,
      size: blob.size,
      width: targetWidth,
      height: targetHeight,
      originalSize: file.size,
      originalWidth: origWidth,
      originalHeight: origHeight,
      quality: quality
    });
  } catch (err) {
    self.postMessage({
      id: id,
      success: false,
      error: err.message || String(err)
    });
  }
};
`;

  let workerInstance = null;
  let activeCallbacks = new Map();
  let requestIdCounter = 1;

  /**
   * สร้างหรือคืนค่า Singleton Web Worker
   */
  function getWorker() {
    if (workerInstance) return workerInstance;
    if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") {
      return null; // Fallback to main thread
    }

    try {
      const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
      const workerUrl = URL.createObjectURL(blob);
      const worker = new Worker(workerUrl);

      worker.onmessage = function (e) {
        const { id, success, dataUrl, error, ...meta } = e.data;
        const cb = activeCallbacks.get(id);
        if (cb) {
          activeCallbacks.delete(id);
          if (success) {
            cb.resolve({ dataUrl, ...meta });
          } else {
            cb.reject(new Error(error || "Worker compression failed"));
          }
        }
      };

      worker.onerror = function (err) {
        console.warn("Image Compressor Worker error, will fallback to main thread:", err);
      };

      workerInstance = worker;
      return workerInstance;
    } catch (e) {
      console.warn("Unable to create inline Web Worker, using main thread fallback:", e);
      return null;
    }
  }

  /**
   * Fallback: ย่อและบีบอัดภาพบน Main Thread เมื่ออุปกรณ์ไม่รองรับ OffscreenCanvas/Worker
   */
  function compressOnMainThread(file, options) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve({ dataUrl: "", size: 0 });
        return;
      }

      const maxWidth = options.maxWidth || MAX_DIMENSION;
      const maxHeight = options.maxHeight || MAX_DIMENSION;
      const maxSizeBytes = options.maxSizeBytes || MAX_FILE_SIZE_BYTES;
      let quality = options.initialQuality || DEFAULT_INITIAL_QUALITY;

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
          let origWidth = img.width;
          let origHeight = img.height;
          let targetWidth = origWidth;
          let targetHeight = origHeight;

          if (targetWidth > maxWidth || targetHeight > maxHeight) {
            if (targetWidth > targetHeight) {
              targetHeight = Math.round((targetHeight * maxWidth) / targetWidth);
              targetWidth = maxWidth;
            } else {
              targetWidth = Math.round((targetWidth * maxHeight) / targetHeight);
              targetHeight = maxHeight;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = targetWidth;
          canvas.height = targetHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          // แปลงเป็น Data URL และบีบอัดจนกว่าขนาดจะไม่เกิน 500 KB
          let dataUrl = canvas.toDataURL("image/jpeg", quality);
          let base64Length = dataUrl.length - (dataUrl.indexOf(",") + 1);
          let approxBytes = (base64Length * 3) / 4;

          while (approxBytes > maxSizeBytes && quality > 0.35) {
            quality = Math.max(0.35, Math.round((quality - 0.08) * 100) / 100);
            dataUrl = canvas.toDataURL("image/jpeg", quality);
            base64Length = dataUrl.length - (dataUrl.indexOf(",") + 1);
            approxBytes = (base64Length * 3) / 4;
          }

          resolve({
            dataUrl: dataUrl,
            size: Math.round(approxBytes),
            width: targetWidth,
            height: targetHeight,
            originalSize: file.size,
            quality: quality,
            fallback: true
          });
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  }

  /**
   * ฟังก์ชันหลักสำหรับย่อและบีบอัดรูปภาพ
   * @param {File|Blob} file - ไฟล์ภาพที่เลือกจาก Input หรือ Camera
   * @param {object} options - การตั้งค่าเสริม (maxWidth, maxHeight, maxSizeBytes)
   * @returns {Promise<{dataUrl: string, size: number, width: number, height: number}>}
   */
  async function compress(file, options = {}) {
    if (!file) return { dataUrl: "", size: 0, width: 0, height: 0 };

    const opts = {
      maxWidth: options.maxWidth || MAX_DIMENSION,
      maxHeight: options.maxHeight || MAX_DIMENSION,
      maxSizeBytes: options.maxSizeBytes || MAX_FILE_SIZE_BYTES,
      initialQuality: options.initialQuality || DEFAULT_INITIAL_QUALITY
    };

    const worker = getWorker();
    if (!worker) {
      return await compressOnMainThread(file, opts);
    }

    return new Promise((resolve, reject) => {
      const id = requestIdCounter++;
      activeCallbacks.set(id, { resolve, reject });

      try {
        worker.postMessage({
          id: id,
          file: file,
          ...opts
        });
      } catch (err) {
        activeCallbacks.delete(id);
        console.warn("Failed to post message to worker, falling back to main thread:", err);
        compressOnMainThread(file, opts).then(resolve).catch(reject);
      }
    });
  }

  /**
   * คืนค่าเฉพาะ Data URL Base64 เพื่อความสะดวกในการใช้งานแทน fileToBase64 เดิม
   */
  async function fileToBase64(file, options = {}) {
    const res = await compress(file, options);
    return res.dataUrl || "";
  }

  return {
    compress,
    fileToBase64,
    MAX_DIMENSION,
    MAX_FILE_SIZE_BYTES
  };
})();

// เข้าถึงได้ทั่วโลก
if (typeof window !== "undefined") {
  window.CmmsImageCompressor = CmmsImageCompressor;
}
