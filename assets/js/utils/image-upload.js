export async function convertToWebP(file, quality = 0.85) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/webp") {
      return resolve(file);
    }

    if (!file.type.startsWith("image/")) {
      return resolve(file);
    }

    // 파일 크기 확인 (10MB 제한)
    const maxFileSize = 10 * 1024 * 1024;
    if (file.size > maxFileSize) {
      reject(new Error(`파일 크기가 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(2)}MB). 10MB 이하의 이미지만 처리할 수 있습니다.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 이미지 크기 확인 (너무 큰 이미지는 리사이즈)
        const maxDimension = 10000; // 최대 10000px
        let width = img.width;
        let height = img.height;
        
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * scale);
          height = Math.floor(height * scale);
        }
        
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        
        // 고품질 이미지 리샘플링
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const webpName = file.name.replace(
                /\.(png|jpg|jpeg|gif|bmp|tiff|svg)$/i,
                ".webp"
              );
              const webpFile = new File([blob], webpName, {
                type: "image/webp",
                lastModified: Date.now()
              });
              resolve(webpFile);
            } else {
              console.warn("WebP 변환 실패, 원본 파일 사용:", file.name);
              resolve(file);
            }
          },
          "image/webp",
          quality
        );
      };
      img.onerror = () => {
        reject(new Error("이미지 로드 실패. 파일이 손상되었을 수 있습니다."));
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      reject(new Error("파일 읽기 실패. 파일이 손상되었을 수 있습니다."));
    };
    reader.readAsDataURL(file);
  });
}

export async function convertMultipleToWebP(files, quality = 0.85) {
  const fileArray = Array.from(files);
  return await Promise.all(fileArray.map((file) => convertToWebP(file, quality)));
}

export async function handleImageUpload(input, callback, options = {}) {
  const { quality = 0.85, keepOriginal = false } = options;

  if (input.files && input.files.length > 0) {
    try {
      const files = Array.from(input.files);
      callback(await convertMultipleToWebP(files, quality), keepOriginal ? files : []);
    } catch (error) {
      console.error("이미지 변환 실패:", error);
      callback(Array.from(input.files), []);
    }
  } else {
    callback([], []);
  }
}

export async function createImagePreview(file, quality = 0.85) {
  const webpFile = await convertToWebP(file, quality);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(webpFile);
  });
}

export function getWebPFileName(filename) {
  return filename.replace(/\.(png|jpg|jpeg|gif|bmp|tiff|svg)$/i, ".webp");
}

// 원본 파일명을 유지하면서 webp 확장자로 변경하고 안전한 파일명 생성 (갤러리 방식)
export function getSafeWebPFileName(originalFileName) {
  // 원본 파일명에서 확장자만 webp로 변경
  const webpFileName = getWebPFileName(originalFileName);
  // 특수문자, 공백, 한글(비ASCII 문자)을 언더스코어로 변경
  // 파일 시스템과 웹 URL에서 문제가 될 수 있는 문자 필터링: < > : " | ? * \ / 공백 + 한글 등 비ASCII 문자
  let safeFileName = webpFileName.replace(/[<>:"|?*\\/\s]/g, '_');
  // 한글 및 기타 비ASCII 문자를 언더스코어로 변환 (파일명 깨짐 방지)
  safeFileName = safeFileName.replace(/[^\x00-\x7F]/g, '_');
  // 연속된 언더스코어를 하나로 통합
  safeFileName = safeFileName.replace(/_+/g, '_');
  // 앞뒤 언더스코어 제거
  safeFileName = safeFileName.replace(/^_+|_+$/g, '');
  // 빈 문자열 방지
  return safeFileName || 'image.webp';
}

export async function compressAndConvertToWebP(
  file,
  maxWidth = 1200,
  maxHeight = 1200,
  quality = 0.75
) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      return resolve(file);
    }

    // 파일 크기 확인
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxFileSize) {
      reject(new Error(`파일 크기가 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(2)}MB). 10MB 이하의 이미지만 처리할 수 있습니다.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // 이미지 크기 제한 (너무 큰 이미지는 리사이즈)
        const maxDimension = 10000; // 최대 10000px
        if (width > maxDimension || height > maxDimension) {
          const scale = Math.min(maxDimension / width, maxDimension / height);
          width = Math.floor(width * scale);
          height = Math.floor(height * scale);
        }

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          } else {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        
        // 고품질 이미지 리샘플링
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const webpName = file.name.replace(
                /\.(png|jpg|jpeg|gif|bmp|tiff|svg)$/i,
                ".webp"
              );
              const webpFile = new File([blob], webpName, {
                type: "image/webp",
                lastModified: Date.now()
              });
              resolve(webpFile);
            } else {
              console.warn("WebP 변환 실패, 원본 파일 사용:", file.name);
              resolve(file);
            }
          },
          "image/webp",
          quality
        );
      };
      img.onerror = () => {
        reject(new Error("이미지 로드 실패. 파일이 손상되었을 수 있습니다."));
      };
      img.src = e.target.result;
    };
    reader.onerror = () => {
      reject(new Error("파일 읽기 실패. 파일이 손상되었을 수 있습니다."));
    };
    reader.readAsDataURL(file);
  });
}

export async function compressImageWithLimits(file, progressCallback = null) {
  const targetSize = 512 * 1024;
  const maxFileSize = 10 * 1024 * 1024; // 10MB

  // 파일 크기 확인
  if (file.size > maxFileSize) {
    const errorMsg = `파일 크기가 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(2)}MB). 10MB 이하의 이미지만 처리할 수 있습니다.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  if (file.size > 10 * 1024 * 1024) {
    console.warn(
      `큰 파일 감지: ${(file.size / 1024 / 1024).toFixed(2)}MB. 압축에 시간이 걸릴 수 있습니다.`
    );
    if (progressCallback) {
      progressCallback("큰 파일 압축 중... 시간이 걸릴 수 있습니다.");
    }
  } else if (progressCallback) {
    progressCallback("이미지 압축 중...");
  }

  const compressionLevels = [
    { maxWidth: 1200, maxHeight: 1200, quality: 0.75, label: "1차 압축" },
    { maxWidth: 1000, maxHeight: 1000, quality: 0.6, label: "2차 압축" },
    { maxWidth: 800, maxHeight: 800, quality: 0.5, label: "3차 압축" },
    { maxWidth: 600, maxHeight: 600, quality: 0.4, label: "4차 압축" },
    { maxWidth: 500, maxHeight: 500, quality: 0.3, label: "5차 압축" }
  ];

  let result = null;

  for (let i = 0; i < compressionLevels.length; i++) {
    const level = compressionLevels[i];
    if (progressCallback && i > 0) {
      progressCallback(`${level.label} 중...`);
    }

    result = await compressAndConvertToWebP(
      file,
      level.maxWidth,
      level.maxHeight,
      level.quality
    );

    if (result.size <= targetSize) {
      break;
    }

    if (i === compressionLevels.length - 1 && result.size > targetSize) {
      console.warn(
        `압축 후에도 500KB를 초과합니다. (현재: ${(result.size / 1024).toFixed(2)}KB)`
      );
    }
  }

  return result;
}

export async function compressMultipleImages(files, progressCallback = null) {
  const fileArray = Array.from(files);
  const results = [];

  for (let i = 0; i < fileArray.length; i++) {
    const file = fileArray[i];
    if (progressCallback) {
      progressCallback(`이미지 압축 중... (${i + 1}/${fileArray.length})`);
    }
    try {
      const compressed = await compressImageWithLimits(file, progressCallback);
      results.push(compressed);
    } catch (error) {
      console.error(`이미지 압축 실패 (${file.name}):`, error);
      throw error;
    }
  }

  return results;
}

export async function compressAndPrepareForDownload(
  file,
  localPath,
  progressCallback = null
) {
  const compressed = await compressImageWithLimits(file, progressCallback);
  return {
    file: compressed,
    localPath: localPath,
    downloadUrl: URL.createObjectURL(compressed)
  };
}

export async function saveFileToUserSelectedPath(file, suggestedName, options = {}) {
  if (!window.showSaveFilePicker) {
    return false;
  }

  try {
    const fileName = String(suggestedName || file?.name || "image.webp");
    const extensionMatch = fileName.match(/\.[A-Za-z0-9]+$/);
    const extension = options.extension || (extensionMatch ? extensionMatch[0].toLowerCase() : ".webp");
    const mimeType = options.mimeType || file?.type || "image/webp";
    const description = options.description || (mimeType === "image/webp" ? "WebP 이미지" : "이미지 파일");
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      types: [
        {
          description,
          accept: {
            [mimeType]: [extension]
          }
        }
      ]
    });

    const writable = await fileHandle.createWritable();
    await writable.write(file);
    await writable.close();

    return true;
  } catch (error) {
    if (error.name === "AbortError") {
      return false;
    }
    throw error;
  }
}

export function isFileSystemAccessSupported() {
  return typeof window.showSaveFilePicker === "function";
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getPathDirectory(path) {
  const lastSlash = String(path || "").lastIndexOf("/");
  return lastSlash >= 0 ? path.substring(0, lastSlash + 1) : "";
}

function getPathFileName(path, fallbackName) {
  const parts = String(path || "").split("/");
  return parts[parts.length - 1] || fallbackName || "image.webp";
}

function sanitizePreparedFileName(fileName, options = {}) {
  if (typeof options.sanitizeFileName === "function") {
    return options.sanitizeFileName(fileName);
  }

  const rawName = String(fileName || "").trim() || "image.webp";
  const extensionMatch = rawName.match(/\.[A-Za-z0-9]+$/);
  const extension = options.forceWebP === false
    ? (extensionMatch ? extensionMatch[0].toLowerCase() : "")
    : ".webp";
  const baseName = rawName.replace(/\.[^.]+$/, "") || "image";
  const safeBase = baseName
    .replace(/[^\x00-\x7F]/g, "_")
    .replace(/[<>:"|?*\\/\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return `${safeBase || "image"}${extension || ""}`;
}

export function showImageSaveModal(file, localPath, onComplete, options = {}) {
  const supportsFileSystem = isFileSystemAccessSupported();
  const modal = document.createElement("div");
  const title = options.title || "레거시 이미지 파일 보조 도구";
  const pathLabel = options.pathLabel || "배포용 /assets 경로";
  const mainHint = options.mainHint || "이미지는 서버에 자동 업로드되지 않습니다. 현재 CMS 흐름은 경로만 만들고, 선택한 원본 파일을 프로젝트의 assets 폴더에 직접 넣은 뒤 npm run deploy를 실행합니다.";
  const detailHint = options.detailHint || "이 창은 이전 브라우저 저장 흐름을 위한 보조 도구입니다. CMS에는 /assets/... 경로만 저장되며 dist 폴더는 배포 산출물이므로 직접 수정하지 않습니다.";
  const downloadLabel = options.downloadLabel || "레거시 파일 내려받기";
  const autoApplied = options.autoApplied === true;
  const keepOpenAfterAction = options.keepOpenAfterAction === true;
  const validatePath = typeof options.validatePath === "function" ? options.validatePath : null;
  const downloadUrl = URL.createObjectURL(file);
  let closed = false;

  modal.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;";

  modal.innerHTML = `
    <div role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}" style="background:var(--card);padding:24px;border-radius:12px;max-width:540px;width:90%;border:1px solid var(--border);box-shadow:0 18px 48px rgba(0,0,0,0.25);">
      <h3 style="margin:0 0 16px 0;color:var(--text);">${escapeAttribute(title)}</h3>
      <div style="margin-bottom:14px;text-align:center;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;">
        <img src="${escapeAttribute(downloadUrl)}" alt="선택한 이미지 미리보기" style="display:block;max-width:100%;max-height:220px;margin:0 auto 10px auto;border-radius:8px;object-fit:contain;">
        <div class="image-target-name" style="font-size:12px;color:var(--muted);word-break:break-all;">대상 파일명: ${escapeAttribute(getPathFileName(localPath, file?.name))}</div>
      </div>
      <div style="margin-bottom:12px;">
        <label style="display:block;margin-bottom:8px;color:var(--text);font-size:14px;font-weight:600;">${escapeAttribute(pathLabel)}</label>
        <input type="text" class="image-path-input" value="${escapeAttribute(localPath)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px;font-family:monospace;" placeholder="/assets/...">
        <div class="image-path-status" style="margin-top:8px;font-size:12px;font-weight:600;"></div>
        <p style="margin:8px 0 0 0;color:var(--muted);font-size:12px;">${escapeAttribute(mainHint)}</p>
      </div>
      <p style="margin:0 0 16px 0;color:var(--muted);font-size:12px;">${escapeAttribute(detailHint)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="image-save-btn btn" style="flex:1;min-width:150px;" ${supportsFileSystem ? "" : "disabled"}>${supportsFileSystem ? "레거시 저장 후 적용" : "저장 위치 선택 미지원"}</button>
        <button class="image-download-btn btn primary" style="flex:1;min-width:150px;">${escapeAttribute(downloadLabel)}</button>
        <button class="image-continue-btn btn" style="flex:1;min-width:150px;">${autoApplied ? "확인 후 닫기" : "경로 적용"}</button>
      </div>
    </div>
  `;

  const pathInput = modal.querySelector(".image-path-input");
  const pathStatus = modal.querySelector(".image-path-status");
  const targetName = modal.querySelector(".image-target-name");
  const saveBtn = modal.querySelector(".image-save-btn");
  const downloadBtn = modal.querySelector(".image-download-btn");
  const continueBtn = modal.querySelector(".image-continue-btn");

  const cleanup = () => {
    if (closed) return;
    closed = true;
    URL.revokeObjectURL(downloadUrl);
    if (modal.parentNode) {
      document.body.removeChild(modal);
    }
  };

  const getFinalPath = () => {
    const currentPath = pathInput.value.trim() || localPath;
    const directory = getPathDirectory(currentPath) || getPathDirectory(localPath) || "/";
    const fileName = sanitizePreparedFileName(getPathFileName(currentPath, file.name), options);
    const finalPath = `${directory}${fileName}`;
    return typeof options.normalizePath === "function"
      ? options.normalizePath(finalPath, fileName)
      : finalPath;
  };

  const updatePathStatus = () => {
    const finalPath = getFinalPath();
    const isValid = validatePath ? validatePath(finalPath) : true;
    if (targetName) {
      targetName.textContent = `대상 파일명: ${getPathFileName(finalPath, file?.name)}`;
    }
    if (pathStatus) {
      pathStatus.textContent = isValid
        ? (autoApplied ? "CMS 이미지 경로와 미리보기에 이미 적용되었습니다." : "사용할 수 있는 이미지 경로입니다.")
        : "경로는 /assets/... 형식이어야 합니다.";
      pathStatus.style.color = isValid ? "var(--success-color)" : "var(--error-color)";
    }
    return isValid;
  };

  const complete = (action, { close = true } = {}) => {
    const finalPath = getFinalPath();
    pathInput.value = finalPath;
    if (!updatePathStatus()) {
      if (window.toast) {
        window.toast("이미지 경로는 /assets/... 형식만 사용할 수 있습니다.", true);
      }
      return;
    }
    if (onComplete) {
      onComplete(finalPath, {
        action,
        file,
        localPath: finalPath,
        fileName: getPathFileName(finalPath, file.name),
        saved: action === "saved",
        downloaded: action === "downloaded"
      });
    }
    if (pathStatus && !close) {
      const actionLabel = action === "saved" ? "레거시 파일 저장" : action === "downloaded" ? "레거시 파일 내려받기" : "경로 적용";
      pathStatus.textContent = `${actionLabel} 완료. CMS에는 /assets/... 경로만 저장됩니다. 실제 사이트 반영은 assets 폴더 배치, prebuild, 배포 후 가능합니다.`;
      pathStatus.style.color = "var(--success-color)";
    }
    if (close) cleanup();
  };
  
  pathInput.addEventListener("input", updatePathStatus);
  pathInput.addEventListener('blur', () => {
    pathInput.value = getFinalPath();
    updatePathStatus();
  });

  saveBtn.addEventListener("click", async () => {
    const finalPath = getFinalPath();
    pathInput.value = finalPath;
    if (!updatePathStatus()) {
      if (window.toast) {
        window.toast("올바른 /assets/... 경로를 입력한 뒤 저장하세요.", true);
      }
      return;
    }
    
    try {
      if (supportsFileSystem) {
        if (window.toast) {
          window.toast("저장 위치를 선택해주세요...");
        }
        const saved = await saveFileToUserSelectedPath(file, getPathFileName(finalPath, file.name), options);
        if (saved) {
          if (window.toast) {
            window.toast("이미지 파일 준비가 끝났습니다. 파일을 assets 폴더에 배치하고 prebuild/배포 후 실제 사이트에 반영됩니다.");
          }
          complete("saved", { close: !keepOpenAfterAction });
        } else {
          if (window.toast) {
            window.toast("저장이 취소되었습니다.", true);
          }
        }
      }
    } catch (error) {
      console.error("파일 저장 실패:", error);
      if (window.toast) {
        window.toast("레거시 파일 저장에 실패했습니다. 현재 CMS에서는 assets 폴더에 원본 파일을 직접 배치하세요.", true);
      }
    }
  });

  downloadBtn.addEventListener("click", () => {
    const finalPath = getFinalPath();
    pathInput.value = finalPath;
    if (!updatePathStatus()) {
      if (window.toast) {
        window.toast("올바른 /assets/... 경로를 입력하세요.", true);
      }
      return;
    }
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = getPathFileName(finalPath, file.name);
    downloadLink.style.display = "none";
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    if (window.toast) {
      window.toast("레거시 파일 동작이 끝났습니다. 현재 CMS에서는 원본 파일을 assets 폴더에 배치하고 npm run deploy를 실행하세요.");
    }
    setTimeout(() => complete("downloaded", { close: !keepOpenAfterAction }), 0);
  });

  continueBtn.addEventListener("click", () => {
    complete(autoApplied ? "confirmed" : "continued");
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      cleanup();
      if (typeof options.onCancel === "function") {
        options.onCancel();
      }
    }
  });

  document.body.appendChild(modal);
  updatePathStatus();
  return modal;
}
