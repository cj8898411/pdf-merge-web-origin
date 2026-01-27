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

const settingsBtn = document.getElementById("settingsBtn");
const settingsModal = document.getElementById("settingsModal");
const closeSettings = document.getElementById("closeSettings");
const orderList = document.getElementById("orderList");
const newPrefix = document.getElementById("newPrefix");
const addPrefix = document.getElementById("addPrefix");
const resetOrder = document.getElementById("resetOrder");
const saveOrder = document.getElementById("saveOrder");
const sidebarResizer = document.getElementById("sidebarResizer");

const DEFAULT_ORDER = ["PC", "NB"]; // 청구서, 납부영수증
const ORDER_STORAGE_KEY = "prefixOrder";
const SIDEBAR_STORAGE_KEY = "sidebarWidth";
let prefixOrder = [...DEFAULT_ORDER];

let files = [];
let selectedGroupKey = null;
let groupOrderMap = {};
let selectedFileId = null;
let fileCounter = 0;

const CUSTOMS_WITH_HYPHEN = /(\d{5})-(\d{2})-(\d{6})M(?!\d)/i;
const CUSTOMS_PLAIN = /(\d{13})M(?!\d)/i;
const BL_PREFIX = /(?:^|[ _-])BL[ _-]?([A-Z0-9]{6,20})(?=$|[ _-])/i;

const formatBytes = (bytes) => {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = (bytes / Math.pow(1024, i)).toFixed(1);
  return `${value} ${units[i]}`;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
    return hasAlpha && hasDigit;
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

const compareByPrefix = (a, b) => {
  const orderA = prefixOrder.indexOf(a.prefix);
  const orderB = prefixOrder.indexOf(b.prefix);
  const rankA = orderA === -1 ? prefixOrder.length : orderA;
  const rankB = orderB === -1 ? prefixOrder.length : orderB;
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

const loadPrefixOrder = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) {
      prefixOrder = saved;
    }
  } catch (err) {
    prefixOrder = [...DEFAULT_ORDER];
  }
};

const persistPrefixOrder = () => {
  localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(prefixOrder));
};

const addFiles = (incoming) => {
  const pdfs = Array.from(incoming).filter((file) =>
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );

  if (!pdfs.length) {
    statusEl.textContent = "PDF 파일만 추가할 수 있습니다.";
    return;
  }

  const newRecords = pdfs.map((file) => {
    const customs = extractCustoms(file.name);
    const bl = extractBL(file.name);
    const prefix = extractPrefix(file.name);
    return {
      id: `f_${fileCounter++}`,
      file,
      name: file.name,
      size: file.size,
      customs,
      bl,
      groupKey: customs || "미분류",
      prefix,
      addedIndex: files.length + fileCounter,
    };
  });

  files = files.concat(newRecords);
  assignGroupKeys();
  regroupFiles();

  statusEl.textContent = `${newRecords.length}개 파일을 추가했습니다.`;
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
    fileDetail.textContent = "파일을 선택하면 정보가 표시됩니다.";
    return;
  }

  fileDetail.innerHTML = `
    <div><strong>파일명:</strong> ${file.name}</div>
    <div><strong>용량:</strong> ${formatBytes(file.size)}</div>
    <div><strong>접두어:</strong> ${file.prefix}</div>
    <div><strong>수입신고번호:</strong> ${file.customs || "미확인"}</div>
    <div><strong>BL번호:</strong> ${file.bl || "미확인"}</div>
  `;
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
    const normalizedSearch = keyword.replace(/-/g, "");
    if (keyword && !normalizedKey.includes(normalizedSearch)) return;

    const item = document.createElement("div");
    item.className = `folder-item ${key === selectedGroupKey ? "active" : ""}`;
    item.innerHTML = `
      <div>${key}</div>
      <div class="folder-meta">${groups[key].length} files</div>
    `;
    item.addEventListener("click", () => {
      selectedGroupKey = key;
      selectedFileId = null;
      updateUI();
    });
    folderList.appendChild(item);
  });
};

const updateFileList = () => {
  fileList.innerHTML = "";

  if (!selectedGroupKey) {
    listMeta.textContent = "선택된 폴더의 파일 순서";
    return;
  }

  const groupFiles = getGroupFiles(selectedGroupKey);
  listMeta.textContent = `${groupFiles.length} files`;

  groupFiles.forEach((file, index) => {
    const li = document.createElement("li");
    li.className = `file-item ${file.id === selectedFileId ? "active" : ""}`;

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = `${index + 1}. ${file.name}`;

    const meta = document.createElement("div");
    meta.className = "file-meta";
    meta.textContent = `${file.prefix} · ${formatBytes(file.size)}`;

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
    fileList.appendChild(li);
  });
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
  selectedFolder.textContent = selectedGroupKey;
  folderMeta.textContent = `파일 ${groupFiles.length} · 합계 ${formatBytes(totalSize)}`;
  mergeBtn.disabled = groupFiles.length < 2;
  mergeAllBtn.disabled = files.length === 0;
};

const updateUI = () => {
  updateFolderList();
  updateHeader();
  updateFileList();
  setSelectedFile(selectedFileId);
};

const moveFile = (index, direction) => {
  const key = selectedGroupKey;
  if (!key) return;
  const ids = getGroupIds(key);
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= ids.length) return;
  const updated = [...ids];
  const [item] = updated.splice(index, 1);
  updated.splice(newIndex, 0, item);
  groupOrderMap[key] = updated;
  updateUI();
};

const removeFile = (fileId) => {
  files = files.filter((file) => file.id !== fileId);

  if (selectedFileId === fileId) {
    selectedFileId = null;
  }

  assignGroupKeys();
  regroupFiles();
  updateUI();
};

const clearAll = () => {
  files = [];
  groupOrderMap = {};
  selectedGroupKey = null;
  selectedFileId = null;
  statusEl.textContent = "초기화했습니다.";
  updateUI();
};

const openSettings = () => {
  settingsModal.classList.add("show");
  settingsModal.setAttribute("aria-hidden", "false");
  renderOrderList();
};

const closeSettingsModal = () => {
  settingsModal.classList.remove("show");
  settingsModal.setAttribute("aria-hidden", "true");
};

const renderOrderList = () => {
  orderList.innerHTML = "";
  prefixOrder.forEach((prefix, index) => {
    const item = document.createElement("div");
    item.className = "order-item";

    const label = document.createElement("span");
    label.textContent = prefix;

    const actions = document.createElement("div");
    actions.className = "order-actions";

    const upBtn = document.createElement("button");
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => movePrefix(index, -1));

    const downBtn = document.createElement("button");
    downBtn.textContent = "↓";
    downBtn.disabled = index === prefixOrder.length - 1;
    downBtn.addEventListener("click", () => movePrefix(index, 1));

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => removePrefix(prefix));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    item.appendChild(label);
    item.appendChild(actions);
    orderList.appendChild(item);
  });
};

const movePrefix = (index, direction) => {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= prefixOrder.length) return;
  const updated = [...prefixOrder];
  const [item] = updated.splice(index, 1);
  updated.splice(newIndex, 0, item);
  prefixOrder = updated;
  renderOrderList();
};

const removePrefix = (prefix) => {
  prefixOrder = prefixOrder.filter((p) => p !== prefix);
  renderOrderList();
};

const addPrefixItem = () => {
  const value = newPrefix.value.trim().toUpperCase();
  if (!value || prefixOrder.includes(value)) return;
  prefixOrder.push(value);
  newPrefix.value = "";
  renderOrderList();
};

const resetPrefixOrder = () => {
  prefixOrder = [...DEFAULT_ORDER];
  renderOrderList();
};

const savePrefixOrder = () => {
  closeSettingsModal();
  persistPrefixOrder();
  assignGroupKeys();
  regroupFiles();
  updateUI();
};

const regroupFiles = () => {
  groupOrderMap = {};
  const sorted = [...files].sort(compareByPrefix);
  insertIntoGroupOrder(sorted);
};

const mergeSelected = async () => {
  if (!selectedGroupKey) return;
  const groupFiles = getGroupFiles(selectedGroupKey);
  if (groupFiles.length < 2) return;

  mergeBtn.disabled = true;
  statusEl.textContent = "병합 중...";

  const formData = new FormData();
  groupFiles.forEach((item) => formData.append("files", item.file));

  try {
    const response = await fetch("/merge", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "병합 실패");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${selectedGroupKey}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.textContent = "병합이 완료되었습니다.";
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    mergeBtn.disabled = getGroupFiles(selectedGroupKey).length < 2;
  }
};

const mergeAll = async () => {
  if (!files.length) return;

  mergeAllBtn.disabled = true;
  statusEl.textContent = "전체 병합 중...";

  const groups = {};
  files.forEach((file) => {
    if (!groups[file.groupKey]) groups[file.groupKey] = [];
    groups[file.groupKey].push(file.id);
  });

  const keys = Object.keys(groups).sort((a, b) => {
    if (a === "미분류") return 1;
    if (b === "미분류") return -1;
    return a.localeCompare(b);
  });

  const manifest = {
    fileIds: files.map((file) => file.id),
    groups: keys.map((key) => ({
      name: key,
      fileIds: getGroupIds(key),
    })),
  };

  const formData = new FormData();
  files.forEach((item) => formData.append("files", item.file));
  formData.append("manifest", JSON.stringify(manifest));

  try {
    const response = await fetch("/merge-batch", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "병합 실패");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged_batch.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    statusEl.textContent = "전체 병합이 완료되었습니다.";
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    mergeAllBtn.disabled = files.length === 0;
  }
};

const applySidebarWidth = (width) => {
  document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
};

const loadSidebarWidth = () => {
  const saved = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY));
  if (!Number.isNaN(saved) && saved > 0) {
    applySidebarWidth(saved);
  }
};

const initResizer = () => {
  if (!sidebarResizer) return;
  let resizing = false;

  const onMouseMove = (event) => {
    if (!resizing) return;
    const width = clamp(event.clientX - 24, 140, 360);
    applySidebarWidth(width);
  };

  const onMouseUp = () => {
    if (!resizing) return;
    resizing = false;
    sidebarResizer.classList.remove("active");
    const widthValue = getComputedStyle(document.documentElement)
      .getPropertyValue("--sidebar-width")
      .replace("px", "")
      .trim();
    const width = Number(widthValue);
    if (!Number.isNaN(width)) {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(width));
    }
    document.body.style.userSelect = "";
  };

  sidebarResizer.addEventListener("mousedown", () => {
    resizing = true;
    sidebarResizer.classList.add("active");
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
};

pickBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => addFiles(e.target.files));
clearBtn.addEventListener("click", clearAll);
folderSearch.addEventListener("input", updateFolderList);

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  addFiles(e.dataTransfer.files);
});

mergeBtn.addEventListener("click", mergeSelected);
mergeAllBtn.addEventListener("click", mergeAll);

settingsBtn.addEventListener("click", openSettings);
closeSettings.addEventListener("click", closeSettingsModal);
settingsModal.addEventListener("click", (e) => {
  if (e.target.dataset.close) closeSettingsModal();
});
addPrefix.addEventListener("click", addPrefixItem);
newPrefix.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPrefixItem();
});
resetOrder.addEventListener("click", resetPrefixOrder);
saveOrder.addEventListener("click", savePrefixOrder);

loadPrefixOrder();
loadSidebarWidth();
initResizer();
updateUI();
