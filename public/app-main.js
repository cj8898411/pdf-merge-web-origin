const updateUI = () => {
  updateFolderList();
  updateHeader();
  updateFileList();
  updateCompleteToggle();
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
  const target = files.find((file) => file.id === fileId);
  files = files.filter((file) => file.id !== fileId);

  if (selectedFileId === fileId) {
    selectedFileId = null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  assignGroupKeys();
  regroupFiles();
  updateUI();
  if (target) {
    const serverName = target.uploadName || target.name;
    if (target.groupKey && feeAttachmentMap[target.groupKey]) {
      delete feeAttachmentMap[target.groupKey][serverName];
      if (typeof window.saveSharedSettings === "function") {
        window.saveSharedSettings();
      }
    }
    deleteUploadsOnServer([serverName]);
  }
};

const clearAll = () => {
  files = [];
  groupOrderMap = {};
  selectedGroupKey = null;
  selectedFileId = null;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  previewZoom = 1;
  setStatus("초기화했습니다.");
  clearUploadsOnServer();
  completedGroups = {};
  feeOrderMap = {};
  feeHiddenMap = {};
  listOrderMap = {};
  feeManualMap = {};
  feeOverrideMap = {};
  feeAttachmentMap = {};
  pcInfoCache.clear();
  pendingPcInfo.clear();
  persistCompletedGroups();
  updateUI();
};

let mergedFiles = [];
let mergedTokens = [];
let mergedFiltered = [];
const pcInfoCache = new Map();
const pendingPcInfo = new Set();
const refreshedPcInfo = new Set();
const PC_INFO_VERSION = 2;

const isPcFilename = (name) => /^PC_/i.test(name || "");

const applyPcInfoToRecords = (filename, info) => {
  files.forEach((record) => {
    const key = record.uploadName || record.name;
    if (key !== filename) return;
    record.importer = info?.importer || null;
    record.fees = Array.isArray(info?.fees) ? info.fees : [];
  });
};

const fetchPcInfo = async (filename, options = {}) => {
  const force = Boolean(options.force);
  if (!filename || pendingPcInfo.has(filename)) return null;
  const cacheKey = `${filename}::${PC_INFO_VERSION}`;
  if (!force && pcInfoCache.has(cacheKey)) return pcInfoCache.get(cacheKey);
  pendingPcInfo.add(filename);
  try {
    const response = await fetch(
      `/pc-info/${encodeURIComponent(filename)}?v=${PC_INFO_VERSION}`
    );
    if (!response.ok) return null;
    const data = await response.json();
    pcInfoCache.set(cacheKey, data);
    return data;
  } catch (err) {
    return null;
  } finally {
    pendingPcInfo.delete(filename);
  }
};

const requestPcInfoForFilename = async (filename, options = {}) => {
  const force = Boolean(options.force);
  if (!isPcFilename(filename)) return;
  if (force) {
    if (refreshedPcInfo.has(filename)) return;
    refreshedPcInfo.add(filename);
  }
  const info = await fetchPcInfo(filename, { force });
  if (!info) return;
  applyPcInfoToRecords(filename, info);
  updateUI();
};

window.requestPcInfoForFilename = requestPcInfoForFilename;
window.isPcFilename = isPcFilename;

const getSortedGroupKeys = () => {
  const groups = getGroups();
  return Object.keys(groups).sort((a, b) => {
    if (a === "미분류") return 1;
    if (b === "미분류") return -1;
    return a.localeCompare(b);
  });
};

const setHeaderDisabled = (disabled) => {
  if (disabled) {
    document.body.classList.add("modal-open");
  } else {
    document.body.classList.remove("modal-open");
  }
};

const openOrderModal = () => {
  orderModal.classList.add("show");
  orderModal.setAttribute("aria-hidden", "false");
  renderOrderList();
  setHeaderDisabled(true);
};

const openMergedModal = () => {
  mergedModal.classList.add("show");
  mergedModal.setAttribute("aria-hidden", "false");
  loadMergedFiles();
  setHeaderDisabled(true);
};

const closeOrderModal = () => {
  orderModal.classList.remove("show");
  orderModal.setAttribute("aria-hidden", "true");
  if (!mergedModal.classList.contains("show")) {
    setHeaderDisabled(false);
  }
};

const closeMergedModal = () => {
  mergedModal.classList.remove("show");
  mergedModal.setAttribute("aria-hidden", "true");
  if (!orderModal.classList.contains("show")) {
    setHeaderDisabled(false);
  }
  if (mergedSearch) mergedSearch.value = "";
  if (mergedDate) mergedDate.value = "";
  if (mergedClipboardPreview) mergedClipboardPreview.value = "";
  mergedTokens = [];
  renderMergedList();
};

const renderOrderList = () => {
  orderList.innerHTML = "";
  prefixOrder.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = "order-item";

    const label = document.createElement("span");
    label.className = "order-label";
    label.textContent = entry.prefix;

    const nameInput = document.createElement("input");
    nameInput.className = "order-name";
    nameInput.type = "text";
    nameInput.placeholder = "문서명";
    nameInput.value = entry.documentName || "";
    nameInput.addEventListener("input", (event) => {
      entry.documentName = event.target.value.trim();
    });

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
    removeBtn.addEventListener("click", () => removePrefix(entry.prefix));

    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    item.appendChild(label);
    item.appendChild(nameInput);
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
  persistPrefixOrder();
  renderOrderList();
};

const removePrefix = (prefix) => {
  prefixOrder = prefixOrder.filter((p) => p.prefix !== prefix);
  persistPrefixOrder();
  renderOrderList();
};

const addPrefixItem = () => {
  const value = newPrefix.value.trim().toUpperCase();
  const documentName = newDocName.value.trim();
  if (!value || !documentName || prefixOrder.some((item) => item.prefix === value))
    return;
  prefixOrder.push({ prefix: value, documentName });
  newPrefix.value = "";
  newDocName.value = "";
  persistPrefixOrder();
  renderOrderList();
};

const resetPrefixOrder = () => {
  prefixOrder = [...DEFAULT_ORDER];
  customsOnlyFirst = true;
  persistCustomsOnlyFirst();
  persistPrefixOrder();
  if (customsOnlyFirstToggle) {
    customsOnlyFirstToggle.checked = true;
  }
  renderOrderList();
};

const savePrefixOrder = () => {
  closeSettingsModal();
  persistPrefixOrder();
  assignGroupKeys();
  regroupFiles();
  updateUI();
  setStatus("병합 순서를 저장했습니다.");
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
  if (pendingUploads > 0) {
    setStatus("업로드 저장 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }
  if (!window.confirm("병합을 진행할까요?")) return;
  const prevKeys = getSortedGroupKeys();
  const prevIndex = prevKeys.indexOf(selectedGroupKey);

  mergeBtn.disabled = true;
  setStatus("병합 중...");

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
    const shouldDownload = window.confirm("병합 파일을 다운로드할까요?");
    if (shouldDownload) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename\\*?=(?:UTF-8''|\"?)([^\";]+)\"?/i);
      if (match && match[1]) {
        a.download = decodeURIComponent(match[1]);
      }
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    const groupIds = new Set(groupFiles.map((item) => item.id));
    const toDelete = groupFiles.map((item) => item.uploadName || item.name);
    files = files.filter((item) => !groupIds.has(item.id));
    assignGroupKeys();
    regroupFiles();
    if (selectedGroupKey && !getGroupFiles(selectedGroupKey).length) {
      delete completedGroups[selectedGroupKey];
      persistCompletedGroups();
      const nextKeys = getSortedGroupKeys();
      if (nextKeys.length) {
        const nextIndex =
          prevIndex >= 0 ? Math.min(prevIndex, nextKeys.length - 1) : 0;
        selectedGroupKey = nextKeys[nextIndex];
      } else {
        selectedGroupKey = null;
      }
      selectedFileId = null;
    }
    updateUI();
    deleteUploadsOnServer(toDelete);

    setStatus("병합이 완료되었습니다.");
  } catch (err) {
    setStatus(err.message);
  } finally {
    mergeBtn.disabled = getGroupFiles(selectedGroupKey).length < 2;
  }
};

const deleteUploadsOnServer = async (names) => {
  if (!Array.isArray(names) || !names.length) return;
  try {
    await fetch("/uploads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
  } catch (err) {
    // Ignore delete failures to avoid blocking UI.
  }
};

const mergeAll = async () => {
  if (!files.length) return;
  const completedKeys = Object.keys(completedGroups).filter(
    (key) => completedGroups[key]
  );
  if (!completedKeys.length) {
    setStatus("취합완료 체크된 폴더가 없습니다.");
    return;
  }
  const availableKeys = completedKeys.filter((key) =>
    getGroupFiles(key).length
  );
  if (!availableKeys.length) {
    setStatus("병합할 파일이 없습니다.");
    return;
  }
  if (!window.confirm("일괄 병합을 진행할까요?")) return;
  const prevKeys = getSortedGroupKeys();
  const removedIndexes = availableKeys
    .map((key) => prevKeys.indexOf(key))
    .filter((value) => value >= 0);

  mergeAllBtn.disabled = true;
  setStatus("전체 병합 중...");

  const groups = {};
  files.forEach((file) => {
    if (!availableKeys.includes(file.groupKey)) return;
    if (!groups[file.groupKey]) groups[file.groupKey] = [];
    groups[file.groupKey].push(file.id);
  });

  const keys = Object.keys(groups).sort((a, b) => {
    if (a === "미분류") return 1;
    if (b === "미분류") return -1;
    return a.localeCompare(b);
  });

  const fileIds = files
    .filter((file) => keys.includes(file.groupKey))
    .map((file) => file.id);
  const manifest = {
    fileIds,
    groups: keys.map((key) => ({
      name: key,
      fileIds: getGroupIds(key),
    })),
  };

  const formData = new FormData();
  files
    .filter((item) => fileIds.includes(item.id))
    .forEach((item) => formData.append("files", item.file));
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
    const shouldDownload = window.confirm("일괄 병합 파일을 다운로드할까요?");
    if (shouldDownload) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "merged_batch.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    const completedKeySet = new Set(keys);
    const toDelete = files
      .filter((item) => completedKeySet.has(item.groupKey))
      .map((item) => item.uploadName || item.name);
    files = files.filter((item) => !completedKeySet.has(item.groupKey));
    keys.forEach((key) => {
      delete completedGroups[key];
    });
    persistCompletedGroups();
    assignGroupKeys();
    regroupFiles();
    if (files.length) {
      const nextKeys = getSortedGroupKeys();
      if (nextKeys.length) {
        const maxRemoved =
          removedIndexes.length > 0 ? Math.max(...removedIndexes) : -1;
        const nextIndex = Math.min(maxRemoved, nextKeys.length - 1);
        selectedGroupKey = nextKeys[Math.max(nextIndex, 0)];
      } else {
        selectedGroupKey = files[0].groupKey;
      }
    } else {
      selectedGroupKey = null;
    }
    selectedFileId = null;
    updateUI();
    deleteUploadsOnServer(toDelete);

    setStatus("전체 병합이 완료되었습니다.");
  } catch (err) {
    setStatus(err.message);
  } finally {
    mergeAllBtn.disabled = files.length === 0;
  }
};

const renderMergedList = () => {
  if (!mergedList) return;
  const keyword = mergedSearch ? mergedSearch.value.trim().toLowerCase() : "";
  const selectedDate = mergedDate ? mergedDate.value : "";
  const dateKey = selectedDate ? selectedDate.replace(/-/g, "").slice(2) : "";
  const tokens = mergedTokens.map((token) => token.toLowerCase());
  const filtered = mergedFiles.filter((name) => {
    const lower = name.toLowerCase();
    if (keyword && !lower.includes(keyword)) return false;
    if (dateKey && !lower.includes(`${dateKey}_`)) return false;
    if (tokens.length && !tokens.some((token) => lower.includes(token))) {
      return false;
    }
    return true;
  });
  mergedFiltered = filtered;
  mergedList.innerHTML = "";
  if (mergedCount) {
    mergedCount.textContent = `검색 결과 ${filtered.length}건`;
  }
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "merged-item";
    empty.textContent = "검색 결과가 없습니다.";
    mergedList.appendChild(empty);
    return;
  }
  filtered.forEach((name) => {
    const row = document.createElement("div");
    row.className = "merged-item";
    const link = document.createElement("a");
    link.href = `/merged/${encodeURIComponent(name)}`;
    link.textContent = name;
    link.setAttribute("download", name);
    link.rel = "noopener";
    row.appendChild(link);
    mergedList.appendChild(row);
  });
};

const extractSearchTokens = (text) => {
  const tokens = new Set();
  const customsMatches = text.match(/\d{5}[-_ ]?\d{2}[-_ ]?\d{6}M/gi) || [];
  customsMatches.forEach((match) => {
    tokens.add(match.replace(/[-_ ]/g, ""));
    tokens.add(match.replace(/[-_ ]/g, "_"));
  });
  const blMatches =
    text.match(/[A-Z0-9]{6,20}/gi) ||
    [];
  blMatches.forEach((match) => {
    if (/\d/.test(match)) tokens.add(match);
  });
  return Array.from(tokens);
};

const pasteMergedTokens = async () => {
  if (!navigator.clipboard || !navigator.clipboard.readText) return;
  try {
    const text = await navigator.clipboard.readText();
    if (mergedClipboardPreview) {
      mergedClipboardPreview.value = text.replace(/\s+/g, " ").trim();
    }
    mergedTokens = extractSearchTokens(text);
    renderMergedList();
    if (mergedTokens.length) {
      setStatus(`클립보드에서 ${mergedTokens.length}개 항목을 인식했습니다.`);
    }
  } catch (err) {
    // Ignore clipboard failures.
  }
};

const downloadMergedSelection = async () => {
  if (!mergedFiltered.length) return;
  if (!window.confirm("조회건을 일괄 다운로드할까요?")) return;
  try {
    const response = await fetch("/merged/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: mergedFiltered }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged_search.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    // Ignore download failures.
  }
};

const loadMergedFiles = async () => {
  if (!mergedList) return;
  try {
    const response = await fetch("/merged");
    if (!response.ok) return;
    const data = await response.json();
    mergedFiles = Array.isArray(data.merged) ? data.merged : [];
    renderMergedList();
  } catch (err) {
    // Ignore load failures to keep settings responsive.
  }
};

const clearUploadsOnServer = async () => {
  try {
    const response = await fetch("/uploads/clear", { method: "POST" });
    if (!response.ok) return;
    const data = await response.json();
    if (typeof data.removed === "number") {
      setStatus(`저장된 파일 ${data.removed}개를 삭제했습니다.`);
    }
  } catch (err) {
    // Ignore delete failures to avoid blocking UI.
  }
};

const uploadIncomingFiles = async (pdfs) => {
  if (!pdfs.length) return;
  const formData = new FormData();
  pdfs.forEach((file) => formData.append("files", file));
  setPendingUploads(1);
  try {
    const response = await fetch("/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.saved) && data.saved.length) {
      setStatus(`서버에 ${data.saved.length}개 저장했습니다.`);
      data.saved.forEach((savedName, index) => {
        const file = pdfs[index];
        const record = files.find((item) => item.file === file);
        if (record) {
          const oldName = record.uploadName || record.name;
          record.uploadName = savedName;
          record.file = null;
          if (isPcFilename(savedName)) {
            requestPcInfoForFilename(savedName);
          }
          if (record.groupKey && feeAttachmentMap[record.groupKey]) {
            const attachments = feeAttachmentMap[record.groupKey];
            if (attachments[oldName]) {
              attachments[savedName] = attachments[oldName];
              delete attachments[oldName];
            }
          }
        }
      });
      if (typeof window.saveSharedSettings === "function") {
        window.saveSharedSettings();
      }
    }
  } catch (err) {
    // Ignore upload failures to avoid blocking UI.
  } finally {
    setPendingUploads(-1);
    updateHeader();
  }
};

const loadStoredUploads = async () => {
  if (files.length) return;
  try {
    const response = await fetch("/uploads");
    if (!response.ok) return;
    const data = await response.json();
    const names = Array.isArray(data.uploads) ? data.uploads : [];
    if (!names.length) return;

    const placeholders = names.map(
      (name) => new File([new Blob()], name, { type: "application/pdf" })
    );
    addFiles(placeholders, {
      skipUpload: true,
      savedNames: names,
      releaseFiles: true,
    });
    names.forEach((name) => {
      if (isPcFilename(name)) {
        requestPcInfoForFilename(name);
      }
    });
    const keys = getSortedGroupKeys();
    if (keys.length) {
      selectedGroupKey = keys[0];
      selectedFileId = null;
      updateUI();
    }
    setStatus(`저장된 파일 ${restored.length}개를 불러왔습니다.`);
  } catch (err) {
    // Ignore restore failures to keep initial load smooth.
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

const CONTENT_STORAGE_KEY = "contentSplit";
const CONTENT_RATIO_KEY = "contentSplitRatio";

const applyContentSplit = (leftWidth, totalWidth) => {
  document.documentElement.style.setProperty("--content-left", `${leftWidth}px`);
  if (!totalWidth) return;
  const rightWidth = Math.max(totalWidth - leftWidth - 10 - 24, 0);
  document.documentElement.style.setProperty("--content-right", `${rightWidth}px`);
};

const resolveContentLeft = (ratio, fallbackPx) => {
  const grid = document.querySelector(".content-grid");
  if (!grid) return fallbackPx || null;
  const rect = grid.getBoundingClientRect();
  if (!rect.width) return fallbackPx || null;
  const minLeft = 160;
  const minRight = 160;
  const max = rect.width - minRight - 10 - 24;
  if (ratio && ratio > 0 && ratio < 1) {
    const base = rect.width * ratio;
    return Math.min(Math.max(base, minLeft), max);
  }
  if (fallbackPx && fallbackPx > 0) {
    return Math.min(Math.max(fallbackPx, minLeft), max);
  }
  if (rect.width < minLeft + minRight + 10 + 24) {
    return Math.max(120, rect.width * 0.5);
  }
  return null;
};

const loadContentSplit = () => {
  const ratio = Number(localStorage.getItem(CONTENT_RATIO_KEY));
  const savedPx = Number(localStorage.getItem(CONTENT_STORAGE_KEY));
  const useRatio = ratio > 0 && ratio < 1;
  const leftWidth = resolveContentLeft(useRatio ? ratio : null, savedPx);
  if (leftWidth) {
    const grid = document.querySelector(".content-grid");
    if (grid && grid.getBoundingClientRect().width) {
      applyContentSplit(leftWidth, grid.getBoundingClientRect().width);
      if (!useRatio && savedPx > 0) {
        localStorage.setItem(
          CONTENT_RATIO_KEY,
          String(leftWidth / grid.getBoundingClientRect().width)
        );
      }
    } else {
      applyContentSplit(leftWidth);
    }
  }
};

const initContentResizer = () => {
  if (!contentResizer) return;
  let resizing = false;

  const onMouseMove = (event) => {
    if (!resizing) return;
    const grid = document.querySelector(".content-grid");
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const minLeft = 160;
    const minRight = 160;
    const max = rect.width - minRight - 10 - 24;
    const leftWidth = Math.min(
      Math.max(event.clientX - rect.left, minLeft),
      max
    );
    applyContentSplit(leftWidth, rect.width);
  };

  const onMouseUp = () => {
    if (!resizing) return;
    resizing = false;
    contentResizer.classList.remove("active");
    const leftValue = getComputedStyle(document.documentElement)
      .getPropertyValue("--content-left")
      .replace("px", "")
      .trim();
    const leftWidth = Number(leftValue);
    if (!Number.isNaN(leftWidth)) {
      localStorage.setItem(CONTENT_STORAGE_KEY, String(leftWidth));
      const grid = document.querySelector(".content-grid");
      if (grid && grid.getBoundingClientRect().width) {
        localStorage.setItem(
          CONTENT_RATIO_KEY,
          String(leftWidth / grid.getBoundingClientRect().width)
        );
      }
    }
    document.body.style.userSelect = "";
  };

  contentResizer.addEventListener("mousedown", () => {
    resizing = true;
    contentResizer.classList.add("active");
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
};

const initContentResizeObserver = () => {
  const grid = document.querySelector(".content-grid");
  if (!grid) return;
  const onResize = () => {
    const ratio = Number(localStorage.getItem(CONTENT_RATIO_KEY));
    if (!(ratio > 0 && ratio < 1)) return;
    const leftWidth = resolveContentLeft(ratio, null);
    if (leftWidth) applyContentSplit(leftWidth, grid.getBoundingClientRect().width);
  };
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(onResize);
    observer.observe(grid);
  } else {
    window.addEventListener("resize", onResize);
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

let pendingTargetGroupKey = null;
const createManualFeeItem = () => {
  if (!selectedGroupKey) return;
  const name = window.prompt("항목명을 입력하세요.");
  if (!name) return;
  const entry = {
    key: `manual:${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: name.trim(),
    amount: "",
    vendor: "",
  };
  if (!feeManualMap[selectedGroupKey]) feeManualMap[selectedGroupKey] = [];
  feeManualMap[selectedGroupKey].push(entry);
  if (typeof window.saveSharedSettings === "function") {
    window.saveSharedSettings();
  }
  updateUI();
};

window.createManualFeeItem = createManualFeeItem;
window.addFiles = addFiles;

pickBtn.addEventListener("click", () => fileInput.click());
if (fileListAddBtn) {
  fileListAddBtn.addEventListener("click", () => {
    pendingTargetGroupKey = selectedGroupKey;
    fileInput.click();
  });
}
if (feeItemAddBtn) {
  feeItemAddBtn.addEventListener("click", () => {
    createManualFeeItem();
  });
}
fileInput.addEventListener("change", (e) => {
  const targetGroupKey = pendingTargetGroupKey || fileInput.dataset.targetGroupKey || null;
  const targetFeeKey = fileInput.dataset.targetFeeKey || null;
  pendingTargetGroupKey = null;
  fileInput.dataset.targetGroupKey = "";
  fileInput.dataset.targetFeeKey = "";
  const added = addFiles(e.target.files, targetGroupKey ? { targetGroupKey } : {});
  if (targetFeeKey && added && added.length) {
    const groupFiles = getGroupFiles(targetGroupKey || selectedGroupKey);
    groupFiles.forEach((file) => {
      if (file.feeKey === targetFeeKey) file.feeKey = null;
    });
    const target = groupFiles.find((file) => file.id === added[0].id);
    if (target) {
      target.feeKey = targetFeeKey;
      if (!feeAttachmentMap[targetGroupKey || selectedGroupKey]) {
        feeAttachmentMap[targetGroupKey || selectedGroupKey] = {};
      }
      const attachments = feeAttachmentMap[targetGroupKey || selectedGroupKey];
      Object.keys(attachments).forEach((name) => {
        if (attachments[name] === targetFeeKey) delete attachments[name];
      });
      const name = target.uploadName || target.name;
      if (name) attachments[name] = targetFeeKey;
      if (typeof window.saveSharedSettings === "function") {
        window.saveSharedSettings();
      }
    }
    updateUI();
  }
});
folderSearch.addEventListener("input", updateFolderList);

const isFileDrag = (event) =>
  Array.from(event.dataTransfer?.types || []).includes("Files");

if (fileListPanel) {
  ["dragenter", "dragover"].forEach((eventName) => {
    fileListPanel.addEventListener(eventName, (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      fileListPanel.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    fileListPanel.addEventListener(eventName, (event) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      fileListPanel.classList.remove("dragover");
    });
  });

  fileListPanel.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    const incoming = event.dataTransfer?.files || [];
    if (incoming.length) {
      const targetGroupKey = selectedGroupKey;
      addFiles(incoming, targetGroupKey ? { targetGroupKey } : {});
    }
  });
}

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

const closeSettingsMenu = () => {
  if (settingsMenu) settingsMenu.classList.remove("show");
  if (settingsToggle) settingsToggle.checked = false;
};

const openSettingsMenu = () => {
  if (!settingsMenu) return;
  settingsMenu.classList.add("show");
  if (settingsToggle) settingsToggle.checked = true;
};

if (settingsToggle) {
  settingsToggle.addEventListener("change", () => {
    if (settingsToggle.checked) {
      openSettingsMenu();
    } else {
      closeSettingsMenu();
    }
  });
}

if (settingsMenu) {
  settingsMenu.addEventListener("click", (event) => {
    const targetButton = event.target.closest("button[data-target]");
    const actionButton = event.target.closest("button[data-action]");
    if (!targetButton && !actionButton) return;
    if (actionButton && actionButton.dataset.action === "clear") {
      closeSettingsMenu();
      if (window.confirm("전체 초기화를 진행할까요?")) {
        clearAll();
      }
      return;
    }
    if (actionButton && actionButton.dataset.action === "update") {
      closeSettingsMenu();
      const confirmed = window.confirm(
        "업데이트를 실행할까요? 실행 중인 프로그램이 종료된 뒤 업데이트가 적용됩니다."
      );
      if (!confirmed) return;
      setStatus("업데이트를 시작합니다. 잠시 후 프로그램이 종료됩니다.");
      fetch("/update", { method: "POST" })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "업데이트 실행 실패");
          }
          return res.json();
        })
        .then(() => {
          setStatus("업데이트 준비 완료. 프로그램이 종료되면 자동 적용됩니다.");
        })
        .catch((err) => {
          setStatus(err.message || "업데이트 실행에 실패했습니다.");
        });
      return;
    }
    const target = targetButton.dataset.target;
    closeSettingsMenu();
    if (target === "order") {
      openOrderModal();
    } else if (target === "merged") {
      openMergedModal();
    }
  });
}

closeOrderSettings.addEventListener("click", closeOrderModal);
closeMergedSettings.addEventListener("click", closeMergedModal);
orderModal.addEventListener("click", (e) => {
  if (e.target.dataset.close) closeOrderModal();
});
mergedModal.addEventListener("click", (e) => {
  if (e.target.dataset.close) closeMergedModal();
});
addPrefix.addEventListener("click", addPrefixItem);
newPrefix.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPrefixItem();
});
newDocName.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addPrefixItem();
});
if (mergedSearch) {
  mergedSearch.addEventListener("input", renderMergedList);
}
if (mergedDate) {
  mergedDate.addEventListener("change", renderMergedList);
}
if (mergedPaste) {
  mergedPaste.addEventListener("click", pasteMergedTokens);
}
if (mergedDownload) {
  mergedDownload.addEventListener("click", downloadMergedSelection);
}
if (fileCompleteToggle) {
  fileCompleteToggle.addEventListener("change", () => {
    if (!selectedGroupKey) return;
    completedGroups[selectedGroupKey] = fileCompleteToggle.checked;
    persistCompletedGroups();
    updateFolderList();
  });
}
if (customsOnlyFirstToggle) {
  customsOnlyFirstToggle.checked = Boolean(customsOnlyFirst);
  customsOnlyFirstToggle.addEventListener("change", () => {
    customsOnlyFirst = customsOnlyFirstToggle.checked;
    persistCustomsOnlyFirst();
    regroupFiles();
    updateUI();
  });
}
resetOrder.addEventListener("click", resetPrefixOrder);
saveOrder.addEventListener("click", savePrefixOrder);

const loadSharedSettings = async () => {
  try {
    const response = await fetch("/settings");
    if (!response.ok) return;
    const data = await response.json();
    applySharedSettings(data);
  } catch (err) {
    // Ignore load failures to keep UI responsive.
  }
};

const saveSharedSettings = async () => {
  try {
    const feeHiddenSerialized = {};
    Object.entries(feeHiddenMap || {}).forEach(([key, value]) => {
      if (value instanceof Set) {
        feeHiddenSerialized[key] = Array.from(value);
      } else if (Array.isArray(value)) {
        feeHiddenSerialized[key] = value;
      }
    });
    await fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefixOrder,
        customsOnlyFirst,
        completedGroups,
        feeOrderMap,
        feeHiddenMap: feeHiddenSerialized,
        feeManualMap,
        feeOverrideMap,
        listOrderMap,
        feeAttachmentMap,
      }),
    });
  } catch (err) {
    // Ignore save failures to avoid blocking UI.
  }
};

const requestSaveSharedSettings = (() => {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      saveSharedSettings();
    }, 400);
  };
})();

window.saveSharedSettings = saveSharedSettings;
window.requestSaveSharedSettings = requestSaveSharedSettings;

const initApp = async () => {
  await loadSharedSettings();
  if (customsOnlyFirstToggle) {
    customsOnlyFirstToggle.checked = Boolean(customsOnlyFirst);
  }
  loadSidebarWidth();
  loadContentSplit();
  initResizer();
  initContentResizer();
  initContentResizeObserver();
  loadStoredUploads();
  updateUI();
  updateZoomUI();
};

initApp();

zoomOutBtn.addEventListener("click", () => {
  previewZoom = Math.min(2, Math.round((previewZoom + 0.1) * 10) / 10);
  applyPreviewZoom();
});

zoomInBtn.addEventListener("click", () => {
  previewZoom = Math.max(0.5, Math.round((previewZoom - 0.1) * 10) / 10);
  applyPreviewZoom();
});

zoomResetBtn.addEventListener("click", () => {
  previewZoom = 1;
  applyPreviewZoom();
});
document.addEventListener("click", (event) => {
  if (!settingsMenu || settingsMenu.classList.contains("show") === false) return;
  if (settingsMenu.contains(event.target)) return;
  if (settingsTrigger && settingsTrigger.contains(event.target)) return;
  closeSettingsMenu();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (orderModal.classList.contains("show")) {
    closeOrderModal();
  }
  if (mergedModal.classList.contains("show")) {
    closeMergedModal();
  }
});
