const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const pickBtn = document.getElementById("pickBtn");
const folderList = document.getElementById("folderList");
const folderSearch = document.getElementById("folderSearch");
const fileList = document.getElementById("fileList");
const listMeta = document.getElementById("listMeta");
const selectedFolder = document.getElementById("selectedFolder");
const folderMeta = document.getElementById("folderMeta");
const mergeBtn = document.getElementById("mergeBtn");
const mergeAllBtn = document.getElementById("mergeAllBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const fileDetail = document.getElementById("fileDetail");
const zoomOutBtn = document.getElementById("zoomOut");
const zoomInBtn = document.getElementById("zoomIn");
const zoomResetBtn = document.getElementById("zoomReset");
const zoomLevelEl = document.getElementById("zoomLevel");
const fileListPanel = document.getElementById("fileListPanel");
const fileListAddBtn = document.getElementById("fileListAddBtn");

const settingsToggle = document.getElementById("settingsToggle");
const orderModal = document.getElementById("orderModal");
const mergedModal = document.getElementById("mergedModal");
const closeOrderSettings = document.getElementById("closeOrderSettings");
const closeMergedSettings = document.getElementById("closeMergedSettings");
const orderList = document.getElementById("orderList");
const newPrefix = document.getElementById("newPrefix");
const newDocName = document.getElementById("newDocName");
const mergedSearch = document.getElementById("mergedSearch");
const mergedList = document.getElementById("mergedList");
const mergedDate = document.getElementById("mergedDate");
const mergedPaste = document.getElementById("mergedPaste");
const mergedClipboardPreview = document.getElementById("mergedClipboardPreview");
const mergedCount = document.getElementById("mergedCount");
const mergedDownload = document.getElementById("mergedDownload");
const settingsMenu = document.getElementById("settingsMenu");
const settingsTrigger = document.getElementById("settingsTrigger");
const topbar = document.querySelector(".topbar");
const fileCompleteToggle = document.getElementById("fileCompleteToggle");
const contentResizer = document.getElementById("contentResizer");
const addPrefix = document.getElementById("addPrefix");
const resetOrder = document.getElementById("resetOrder");
const saveOrder = document.getElementById("saveOrder");
const sidebarResizer = document.getElementById("sidebarResizer");
const customsOnlyFirstToggle = document.getElementById("customsOnlyFirstToggle");

const DEFAULT_ORDER = [
  { prefix: "JS", documentName: "정산서" },
  { prefix: "NB", documentName: "납부영수증" },
  { prefix: "VT", documentName: "수입세금계산서" },
  { prefix: "IMP", documentName: "수입신고필증" },
];
const DEFAULT_DOC_NAME_MAP = new Map(
  DEFAULT_ORDER.map((item) => [item.prefix, item.documentName])
);
const SIDEBAR_STORAGE_KEY = "sidebarWidth";
let prefixOrder = [...DEFAULT_ORDER];
let completedGroups = {};
let customsOnlyFirst = true;

let files = [];
let selectedGroupKey = null;
let groupOrderMap = {};
let selectedFileId = null;
let fileCounter = 0;
let previewUrl = null;
let previewZoom = 1;
let draggedFileId = null;
let pendingUploads = 0;

const CUSTOMS_WITH_HYPHEN = /(\d{5})-(\d{2})-(\d{6})M(?!\d)/i;
const CUSTOMS_PLAIN = /(\d{13})M(?!\d)/i;
const CUSTOMS_ONLY_WITH_HYPHEN = /^(\d{5})-(\d{2})-(\d{6})M$/i;
const CUSTOMS_ONLY_PLAIN = /^(\d{13})M$/i;
const BL_PREFIX = /(?:^|[ _-])BL[ _-]?([A-Z0-9]{6,20})(?=$|[ _-])/i;

const formatBytes = (bytes) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${value} ${units[i]}`;
};

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const setStatus = (message) => {
  if (!statusEl) return;
  statusEl.textContent = message || "";
};

const normalizeCustoms = (digits) =>
  `${digits.slice(0, 5)}-${digits.slice(5, 7)}-${digits.slice(7, 13)}M`;

const extractCustoms = (name) => {
  const matchHyphen = name.match(CUSTOMS_WITH_HYPHEN);
  if (matchHyphen) {
    return `${matchHyphen[1]}-${matchHyphen[2]}-${matchHyphen[3]}M`;
  }
  const matchPlain = name.match(CUSTOMS_PLAIN);
  if (matchPlain) {
    return normalizeCustoms(matchPlain[1]);
  }
  return null;
};

const extractBL = (name) => {
  const trimmed = name.replace(/\.[^/.]+$/, "");
  const blMatch = trimmed.match(BL_PREFIX);
  if (blMatch) return blMatch[1].toUpperCase();

  const cleaned = trimmed
    .replace(CUSTOMS_WITH_HYPHEN, "")
    .replace(CUSTOMS_PLAIN, "");
  const tokens = cleaned.split(/[ _-]+/).filter(Boolean);
  const candidates = tokens.filter((token) => {
    if (token.length < 6 || token.length > 20) return false;
    const hasAlpha = /[A-Z]/i.test(token);
    const hasDigit = /\d/.test(token);
    if (hasAlpha && hasDigit) return true;
    if (/^\d+$/.test(token)) return true;
    return false;
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0].toUpperCase();
};

const extractPrefix = (name) => {
  const trimmed = name.replace(/\.[^/.]+$/, "");
  const match = trimmed.match(/^([A-Z]{2,3})[ _-]?/);
  if (!match) return "기타";
  return match[1];
};

const normalizePrefixEntry = (item) => {
  if (typeof item === "string") {
    const prefix = item.toUpperCase();
    return {
      prefix,
      documentName: DEFAULT_DOC_NAME_MAP.get(prefix) || "",
    };
  }
  if (!item || typeof item !== "object") return null;
  const prefix = String(item.prefix || "").trim().toUpperCase();
  if (!prefix) return null;
  const fallbackName = DEFAULT_DOC_NAME_MAP.get(prefix) || "";
  return {
    prefix,
    documentName: String(item.documentName || fallbackName).trim(),
  };
};

const getPrefixIndex = (prefix) =>
  prefixOrder.findIndex((item) => item.prefix === prefix);

const isCustomsOnlyName = (name) => {
  const trimmed = String(name || "").replace(/\.[^/.]+$/, "").trim();
  if (!trimmed) return false;
  return CUSTOMS_ONLY_WITH_HYPHEN.test(trimmed) || CUSTOMS_ONLY_PLAIN.test(trimmed);
};

const getFileOrderRank = (file) => {
  if (customsOnlyFirst && isCustomsOnlyName(file.name)) {
    return -1;
  }
  const orderIndex = getPrefixIndex(file.prefix);
  return orderIndex === -1 ? prefixOrder.length : orderIndex;
};

const getDocumentName = (prefix) => {
  const entry = prefixOrder.find((item) => item.prefix === prefix);
  return entry?.documentName || prefix;
};

const BASE_STATUS_ORDER = [
  { prefix: "JS", label: "정산서" },
  { prefix: "NB", label: "납부영수증" },
  { prefix: "VT", label: "수입세금계산서" },
  { prefix: "IMP", label: "수입신고필증" },
];

const buildStatusDots = (groupFiles) => {
  const present = new Set(groupFiles.map((file) => file.prefix));
  return BASE_STATUS_ORDER.map((entry) => {
    const label = escapeHtml(entry.label);
    const active = present.has(entry.prefix);
    const cls = active ? "status-dot is-active" : "status-dot";
    return `<span class="${cls}" title="${label}"></span>`;
  }).join("");
};

const compareByPrefix = (a, b) => {
  const rankA = getFileOrderRank(a);
  const rankB = getFileOrderRank(b);
  if (rankA !== rankB) return rankA - rankB;
  return a.addedIndex - b.addedIndex;
};

const buildBlMap = () => {
  const map = {};
  files.forEach((file) => {
    if (file.customs && file.bl) {
      if (!map[file.bl]) {
        map[file.bl] = file.customs;
      } else if (map[file.bl] !== file.customs) {
        map[file.bl] = null;
      }
    }
  });
  return map;
};

const assignGroupKeys = () => {
  const blMap = buildBlMap();
  files.forEach((file) => {
    if (file.manualGroup && file.groupKey) {
      return;
    }
    if (file.customs) {
      file.groupKey = file.customs;
      return;
    }
    if (file.bl && blMap[file.bl]) {
      file.groupKey = blMap[file.bl];
      return;
    }
    file.groupKey = "미분류";
  });
};

const getGroupBL = (groupFiles) => {
  const blSet = new Set(
    groupFiles.map((file) => file.bl).filter((value) => Boolean(value))
  );
  if (blSet.size === 1) {
    return Array.from(blSet)[0];
  }
  return null;
};

const getGroupImporter = (groupFiles) => {
  const importerSet = new Set(
    groupFiles.map((file) => file.importer).filter((value) => Boolean(value))
  );
  if (!importerSet.size) return null;
  if (importerSet.size === 1) return Array.from(importerSet)[0];
  return "복수";
};

const persistPrefixOrder = () => {
  if (typeof window.saveSharedSettings === "function") {
    window.saveSharedSettings();
  }
};

const persistCustomsOnlyFirst = () => {
  if (typeof window.saveSharedSettings === "function") {
    window.saveSharedSettings();
  }
};

const persistCompletedGroups = () => {
  if (typeof window.saveSharedSettings === "function") {
    window.saveSharedSettings();
  }
};

const applySharedSettings = (data) => {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data.prefixOrder)) {
    const normalized = data.prefixOrder
      .map(normalizePrefixEntry)
      .filter(Boolean);
    if (normalized.length) {
      prefixOrder = normalized;
    }
  }
  if (typeof data.customsOnlyFirst === "boolean") {
    customsOnlyFirst = data.customsOnlyFirst;
  }
  if (data.completedGroups && typeof data.completedGroups === "object") {
    completedGroups = data.completedGroups;
  }
};

const updateCompleteToggle = () => {
  if (!fileCompleteToggle) return;
  if (!selectedGroupKey) {
    fileCompleteToggle.checked = false;
    fileCompleteToggle.disabled = true;
    return;
  }
  fileCompleteToggle.disabled = false;
  fileCompleteToggle.checked = Boolean(completedGroups[selectedGroupKey]);
};

const setPendingUploads = (delta) => {
  pendingUploads = Math.max(0, pendingUploads + delta);
};

const addFiles = (incoming, options = {}) => {
  const pdfs = Array.from(incoming).filter((file) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );

  if (!pdfs.length) {
    setStatus("PDF 파일만 추가할 수 있습니다.");
    return;
  }

  const targetGroupKey = options.targetGroupKey || null;
  const processed = pdfs.map((file, index) => {
    if (!targetGroupKey) {
      return { file, name: file.name };
    }
    const base = `add_${targetGroupKey}`;
    const suffix = pdfs.length > 1 ? `_${index + 1}` : "";
    const newName = `${base}${suffix}.pdf`;
    const renamedFile = new File([file], newName, {
      type: file.type || "application/pdf",
    });
    return { file: renamedFile, name: newName };
  });

  const newRecords = processed.map((entry, index) => {
    const customs = extractCustoms(entry.name);
    const bl = extractBL(entry.name);
    const prefix = extractPrefix(entry.name);
    const uploadName = Array.isArray(options.savedNames)
      ? options.savedNames[index]
      : null;
    const groupKey = targetGroupKey || customs || "미분류";
    return {
      id: `f_${fileCounter++}`,
      file: entry.file,
      name: entry.name,
      size: entry.file.size,
      customs,
      bl,
      groupKey,
      prefix,
      uploadName,
      addedIndex: files.length + fileCounter,
      manualGroup: Boolean(targetGroupKey),
    };
  });

  files = files.concat(newRecords);
  assignGroupKeys();
  regroupFiles();
  if (!options.skipUpload && typeof uploadIncomingFiles === "function") {
    uploadIncomingFiles(processed.map((entry) => entry.file));
  }

  setStatus(`${newRecords.length}개 파일을 추가했습니다.`);
  if (!selectedGroupKey && newRecords.length) {
    selectedGroupKey = newRecords[0].groupKey;
  }
  updateUI();
};

const insertIntoGroupOrder = (newRecords) => {
  newRecords.forEach((record) => {
    const key = record.groupKey;
    if (!groupOrderMap[key]) {
      groupOrderMap[key] = [];
    }
    const groupIds = groupOrderMap[key];
    const groupFiles = groupIds.map((id) => files.find((f) => f.id === id));
    const insertIndex = groupFiles.findIndex(
      (item) => compareByPrefix(record, item) < 0
    );
    if (insertIndex === -1) {
      groupIds.push(record.id);
    } else {
      groupIds.splice(insertIndex, 0, record.id);
    }
  });
};

const getGroups = () => {
  const groups = {};
  files.forEach((record) => {
    if (!groups[record.groupKey]) groups[record.groupKey] = [];
    groups[record.groupKey].push(record);
  });
  return groups;
};

const getGroupIds = (groupKey) => {
  const group = groupOrderMap[groupKey] || [];
  return group.filter((id) => files.some((f) => f.id === id));
};

const getGroupFiles = (groupKey) =>
  getGroupIds(groupKey).map((id) => files.find((f) => f.id === id));

const setSelectedFile = (fileId) => {
  selectedFileId = fileId;
  const file = files.find((f) => f.id === fileId);
  if (!file) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    fileDetail.classList.remove("is-preview");
    fileDetail.textContent = "파일을 선택하면 정보가 표시됩니다.";
    updateZoomUI();
    return;
  }

  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  previewUrl = URL.createObjectURL(file.file);
  previewZoom = 1;
  updateZoomUI();
  fileDetail.classList.add("is-preview");

  fileDetail.innerHTML = `
    <div class="preview-header">
      <div>${file.name}</div>
      <div class="preview-meta">용량 ${formatBytes(file.size)} · 접두어 ${file.prefix} · 수입신고번호 ${file.customs || "미확인"} · BL ${file.bl || "미확인"}</div>
    </div>
    <div class="preview-body">
      <iframe class="preview-frame" src="${previewUrl}#toolbar=0&navpanes=0&view=FitH" title="PDF 미리보기"></iframe>
    </div>
  `;
  applyPreviewZoom();
};

const updateZoomUI = () => {
  if (!zoomLevelEl) return;
  zoomLevelEl.textContent = `${Math.round(previewZoom * 100)}%`;
  const hasFile = Boolean(previewUrl);
  zoomOutBtn.disabled = !hasFile;
  zoomInBtn.disabled = !hasFile;
  zoomResetBtn.disabled = !hasFile;
};

const applyPreviewZoom = () => {
  const frame = document.querySelector(".preview-frame");
  if (!frame) return;
  frame.style.zoom = String(previewZoom);
  updateZoomUI();
};

const updateFolderList = () => {
  const groups = getGroups();
  const keyword = folderSearch.value.trim();
  folderList.innerHTML = "";

  const keys = Object.keys(groups).sort((a, b) => {
    if (a === "미분류") return 1;
    if (b === "미분류") return -1;
    return a.localeCompare(b);
  });

  keys.forEach((key) => {
    const normalizedKey = key.replace(/-/g, "");
    const normalizedSearch = keyword.replace(/-/g, "").toLowerCase();
    const groupBl = getGroupBL(groups[key]);
    const groupImporter = getGroupImporter(groups[key]);
    const blSearch = groupBl ? groupBl.toLowerCase() : "";
    if (
      keyword &&
      !normalizedKey.toLowerCase().includes(normalizedSearch) &&
      !(blSearch && blSearch.includes(normalizedSearch))
    ) {
      return;
    }

    const item = document.createElement("div");
    item.className = `folder-item ${key === selectedGroupKey ? "active" : ""}`;
    const isCompleted = Boolean(completedGroups[key]);
    const emphasizedKey = key.replace(
      /([0-9]{6}M)$/i,
      "<span class=\"folder-emphasis\">$1</span>"
    );
    const metaParts = [];
    if (groupImporter) metaParts.push(groupImporter);

    const statusDots = buildStatusDots(groups[key]);
    item.innerHTML = `
      <div class="folder-item-row">
        <div class="folder-key">${emphasizedKey}</div>
        <label class="checkbox-container folder-checkbox" aria-label="취합완료">
          <input class="custom-checkbox folder-complete" type="checkbox" ${
            isCompleted ? "checked" : ""
          } />
          <span class="checkmark"></span>
        </label>
      </div>
      <div class="folder-meta">${metaParts.join(" · ")}</div>
      <div class="folder-status" aria-label="필수 서류 상태">
        ${statusDots}
      </div>
    `;
    const checkboxLabel = item.querySelector(".folder-checkbox");
    const checkbox = item.querySelector(".folder-complete");
    if (checkboxLabel) {
      checkboxLabel.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    }
    if (checkbox) {
      checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      checkbox.addEventListener("change", () => {
        completedGroups[key] = checkbox.checked;
        persistCompletedGroups();
        if (key !== selectedGroupKey) {
          selectedGroupKey = key;
          selectedFileId = null;
        }
        updateUI();
      });
    }
    item.addEventListener("click", () => {
      if (key === selectedGroupKey) {
        completedGroups[key] = !completedGroups[key];
        persistCompletedGroups();
        updateCompleteToggle();
        updateFolderList();
        return;
      }
      selectedGroupKey = key;
      selectedFileId = null;
      updateUI();
    });
    folderList.appendChild(item);
  });

  if (!selectedGroupKey && keys.length) {
    selectedGroupKey = keys[0];
  }
};

const updateFileList = () => {
  fileList.innerHTML = "";

  if (!selectedGroupKey) {
    listMeta.textContent = "선택된 폴더의 파일 순서";
    if (fileCompleteToggle) {
      fileCompleteToggle.checked = false;
      fileCompleteToggle.disabled = true;
    }
    return;
  }
  if (fileCompleteToggle) {
    fileCompleteToggle.disabled = false;
  }

  const groupFiles = getGroupFiles(selectedGroupKey);
  listMeta.textContent = `${groupFiles.length} files`;

  groupFiles.forEach((file, index) => {
    const li = document.createElement("li");
    li.className = `file-item ${file.id === selectedFileId ? "active" : ""}`;
    li.draggable = true;
    li.dataset.fileId = file.id;

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = `${index + 1}. ${file.name}`;

    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = `${getDocumentName(file.prefix)} · ${formatBytes(
      file.size
    )}`;

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "file-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => moveFile(index, -1));

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = index === groupFiles.length - 1;
    downBtn.addEventListener("click", () => moveFile(index, 1));

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => removeFile(file.id));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    li.appendChild(info);
    li.appendChild(actions);
    li.addEventListener("click", () => {
      setSelectedFile(file.id);
      updateFileList();
    });
    li.addEventListener("dragstart", (event) => {
      draggedFileId = file.id;
      li.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    li.addEventListener("dragend", () => {
      draggedFileId = null;
      li.classList.remove("dragging");
      fileList.querySelectorAll(".drag-over").forEach((node) => {
        node.classList.remove("drag-over");
      });
    });
    li.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      li.classList.add("drag-over");
    });
    li.addEventListener("dragleave", () => {
      li.classList.remove("drag-over");
    });
    li.addEventListener("drop", (event) => {
      event.preventDefault();
      li.classList.remove("drag-over");
      if (!draggedFileId || draggedFileId === file.id) return;
      reorderWithinGroup(draggedFileId, file.id);
    });
    fileList.appendChild(li);
  });
};

const reorderWithinGroup = (sourceId, targetId) => {
  if (!selectedGroupKey) return;
  const ids = getGroupIds(selectedGroupKey);
  const sourceIndex = ids.indexOf(sourceId);
  const targetIndex = ids.indexOf(targetId);
  if (sourceIndex === -1 || targetIndex === -1) return;
  const updated = [...ids];
  const [moved] = updated.splice(sourceIndex, 1);
  updated.splice(targetIndex, 0, moved);
  groupOrderMap[selectedGroupKey] = updated;
  updateUI();
};

const updateHeader = () => {
  if (!selectedGroupKey) {
    selectedFolder.textContent = "선택된 폴더 없음";
    folderMeta.textContent = "파일 0 · 합계 0 B";
    mergeBtn.disabled = true;
    mergeAllBtn.disabled = files.length === 0;
    return;
  }

  const groupFiles = getGroupFiles(selectedGroupKey);
  const totalSize = groupFiles.reduce((sum, file) => sum + file.size, 0);
  const groupBl = getGroupBL(groupFiles);
  const groupImporter = getGroupImporter(groupFiles);
  const emphasizedHeaderKey = selectedGroupKey.replace(
    /([0-9]{6}M)$/i,
    "<span class=\"folder-emphasis header-emphasis\">$1</span>"
  );
  const headerParts = [];
  if (groupImporter) headerParts.push(groupImporter);
  headerParts.push(emphasizedHeaderKey);
  if (groupBl) headerParts.push(groupBl);
  selectedFolder.innerHTML = headerParts.join(" · ");
  folderMeta.textContent = `파일 ${groupFiles.length} · 합계 ${formatBytes(totalSize)}`;
  mergeBtn.disabled = groupFiles.length < 2;
  mergeAllBtn.disabled = files.length === 0 || pendingUploads > 0;
  mergeBtn.disabled = groupFiles.length < 2 || pendingUploads > 0;
};
