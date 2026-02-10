/* =========================================================
   ZIP WRITER (Stored ZIP, no compression)
   - Works without JSZip CDN
========================================================= */
class ZipWriter {
  constructor() {
    this.parts = [];
    this.centralParts = [];
    this.offset = 0;
    this.crcTable = ZipWriter.makeCrcTable();
    this.textEncoder = new TextEncoder();
  }
  static makeCrcTable() {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  }
  crc32(bytes) {
    let c = ~0;
    for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ this.crcTable[(c ^ bytes[i]) & 0xff];
    return (~c) >>> 0;
  }
  dosDateTime(date = new Date()) {
    const yr = Math.max(1980, date.getFullYear());
    const mo = date.getMonth() + 1, da = date.getDate();
    const hr = date.getHours(), mi = date.getMinutes(), se = Math.floor(date.getSeconds() / 2);
    return {
      dosTime: (hr << 11) | (mi << 5) | se,
      dosDate: ((yr - 1980) << 9) | (mo << 5) | da
    };
  }
  push(u8) { this.parts.push(u8); this.offset += u8.length; }
  addText(path, text) { this.addFile(path, this.textEncoder.encode(text)); }

  addFile(path, bytes, mtime = new Date()) {
    if (!(bytes instanceof Uint8Array)) throw new Error("ZipWriter.addFile expects Uint8Array");
    path = String(path).replace(/\\/g, "/");

    const nameBytes = this.textEncoder.encode(path);
    const { dosTime, dosDate } = this.dosDateTime(mtime);
    const crc = this.crc32(bytes), size = bytes.length, localOffset = this.offset;

    const flag = 0x0800; // UTF-8 filename
    const method = 0;    // stored
    const ver = 20;

    // Local header
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, ver, true);
    dv.setUint16(6, flag, true);
    dv.setUint16(8, method, true);
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    this.push(lh);
    this.push(bytes);

    // Central directory entry
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, ver, true);
    cdv.setUint16(6, ver, true);
    cdv.setUint16(8, flag, true);
    cdv.setUint16(10, method, true);
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, localOffset, true);
    cd.set(nameBytes, 46);
    this.centralParts.push(cd);
  }

  finalizeBlob() {
    const centralOffset = this.offset;
    let centralSize = 0;
    for (const c of this.centralParts) centralSize += c.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    const count = this.centralParts.length;
    ev.setUint16(8, count, true);
    ev.setUint16(10, count, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralOffset, true);
    ev.setUint16(20, 0, true);

    return new Blob([...this.parts, ...this.centralParts, eocd], { type: "application/zip" });
  }
}

/* =========================================================
   APP
========================================================= */
document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* -----------------------------
     Helpers
  ----------------------------- */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const deepClone = (o) => JSON.parse(JSON.stringify(o));
  const px = (n) => `${Math.round(n)}px`;

  function setCSSVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }
  function getCSSVarPx(name, fallbackPx) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallbackPx;
  }
  function fileBaseName(filename) {
    const dot = filename.lastIndexOf(".");
    return dot >= 0 ? filename.slice(0, dot) : filename;
  }
  async function blobToU8(blob) {
    const ab = await blob.arrayBuffer();
    return new Uint8Array(ab);
  }

  /* -----------------------------
     DOM
  ----------------------------- */
  const annTypeEl = $("#annType");

  const importBtn = $("#importBtn");
  const fileInput = $("#fileInput");
  const imageListEl = $("#imageList");
  const imageSearchEl = $("#imageSearch");

  const modeWrap = $("#mode");
  const modeBtn = $("#modeBtn");
  const modeMenu = $("#modeMenu");

  const newClassName = $("#newClassName");
  const newClassColor = $("#newClassColor");
  const inlineAddBtn = $("#inlineAddBtn");
  const classStripEl = $("#classStrip");

  const toggleDetailsBtn = $("#toggleDetailsBtn");
  const exportBtn = $("#exportBtn");

  const resetEverythingBtn = $("#resetEverythingBtn");

  const undoBtn = $("#undoBtn");
  const redoBtn = $("#redoBtn");

  const imgNameEl = $("#imgName");
  const imgMetaEl = $("#imgMeta");
  const emptyState = $("#emptyState");

  const infoFilename = $("#infoFilename");
  const infoResolution = $("#infoResolution");
  const infoCount = $("#infoCount");
  const infoActiveLabel = $("#infoActiveLabel");
  const selectedStatus = $("#selectedStatus");

  const canvasWrap = $("#canvasWrap");
  const canvas = $("#canvas");
  const ctx = canvas?.getContext("2d", { alpha: true });

  const zoomUI = $("#zoomUI");
  const regionsListEl = $("#regionsList");

  const leftResizer = document.querySelector(".lsf-resizer__handle_quickview");
  const rightResizer = document.querySelector(".lsf-resizer__handle_right");

  /* -----------------------------
     Constants
  ----------------------------- */
  const ZOOM_STEP = 1.12;
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 30;

  // Polygon drawing
  const POLY_CLOSE_THRESHOLD_PX = 12;
  const POLY_START_RADIUS_PX = 7;
  const POLY_POINT_RADIUS_PX = 4;
  const VERTEX_HIT_RADIUS_PX = 8;

  // BBox editing
  const HANDLE_SIZE_PX = 10;
  const MIN_BBOX_SIZE_IMG = 3;

  // Resizer limits
  const MIN_LEFT = 200, MAX_LEFT = 560;
  const MIN_RIGHT = 260, MAX_RIGHT = 720;

  /* -----------------------------
     State
  ----------------------------- */
  const state = {
    images: [],       // {id,file,name,url,bitmap,w,h,annotations:[]}
    labels: [],       // {id,name,color}
    currentImageId: null,
    activeLabelId: null,
    filter: "",
    mode: "bbox",     // "bbox" | "poly"

    labelHidden: new Set(),
    labelLocked: new Set(),

    view: { scale: 1, ox: 0, oy: 0 },

    drawing: {
      isDown: false,
      startImg: null,
      bboxDraft: null,
      isPolyDrawing: false,
      polyPoints: [],
      polyHover: null
    },

    selectedAnnId: null,
    dragOp: null,

    history: { undo: [], redo: [] }
  };

  /* -----------------------------
     Session (LocalStorage)
  ----------------------------- */
  const STORAGE_KEY = "GIS_ANNOTATION_SESSION_V1";
  let pendingByKey = new Map(); // key -> { annotations: [...] }

  function imageKey(name, w, h) {
    return `${name}||${w}||${h}`;
  }

  let __saveTimer = null;
  function markDirty() {
    clearTimeout(__saveTimer);
    __saveTimer = setTimeout(saveSessionNow, 250);
  }

  function saveSessionNow() {
    try {
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        labels: state.labels.map(l => ({ id: l.id, name: l.name, color: l.color })),
        activeLabelId: state.activeLabelId || null,
        labelHidden: Array.from(state.labelHidden),
        labelLocked: Array.from(state.labelLocked),
        images: state.images.map(img => ({
          name: img.name,
          w: img.w,
          h: img.h,
          annotations: (img.annotations || []).map(a => ({
            id: a.id,
            type: a.type,
            color: a.color,
            labelId: a.labelId || null,
            bbox: a.bbox || null,
            points: a.points || null,
            hidden: !!a.hidden,
            locked: !!a.locked
          }))
        }))
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn("Auto-save failed:", err);
    }
  }

  function restoreSessionOnBoot() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1) return;

      state.labels = Array.isArray(saved.labels) ? saved.labels : [];
      state.activeLabelId = saved.activeLabelId || null;
      state.labelHidden = new Set(saved.labelHidden || []);
      state.labelLocked = new Set(saved.labelLocked || []);

      pendingByKey.clear();
      if (Array.isArray(saved.images)) {
        for (const rec of saved.images) {
          if (!rec?.name || !rec?.w || !rec?.h) continue;
          pendingByKey.set(imageKey(rec.name, rec.w, rec.h), {
            annotations: (rec.annotations || []).map(a => ({
              id: a.id || uid(),
              type: a.type,
              color: a.color || "#fb923c",
              labelId: a.labelId || null,
              bbox: a.bbox || null,
              points: a.points || null,
              hidden: !!a.hidden,
              locked: !!a.locked
            }))
          });
        }
      }
    } catch (err) {
      console.warn("Restore failed:", err);
    }
  }

  function tryApplyPendingToImage(img) {
    const key = imageKey(img.name, img.w, img.h);
    const pending = pendingByKey.get(key);
    if (!pending) return false;
    img.annotations = pending.annotations.map(a => ({ ...a }));
    pendingByKey.delete(key);
    return true;
  }

  /* -----------------------------
     Effective getters
  ----------------------------- */
  function getCurrentImage() {
    return state.images.find(i => i.id === state.currentImageId) || null;
  }
  function getActiveLabel() {
    return state.labels.find(l => l.id === state.activeLabelId) || null;
  }
  function strokeColor() {
    return getActiveLabel()?.color || "#fb923c";
  }
  function isLabelHidden(labelId) {
    return !!labelId && state.labelHidden.has(labelId);
  }
  function isLabelLocked(labelId) {
    return !!labelId && state.labelLocked.has(labelId);
  }
  function isAnnEffectivelyHidden(ann) {
    return !!ann.hidden || isLabelHidden(ann.labelId);
  }
  function isAnnEffectivelyLocked(ann) {
    return !!ann.locked || isLabelLocked(ann.labelId);
  }

  /* -----------------------------
     Annotation Type UI
  ----------------------------- */
  function updateAnnTypeUI() {
    if (!annTypeEl) return;
    const isPoly = state.mode === "poly";
    const label = isPoly ? "Polygon" : "Bounding Box";
    annTypeEl.innerHTML = `<span class="meta-pill__dot"></span> Type: ${label}`;
  }

  /* -----------------------------
     View transform
  ----------------------------- */
  function fitToScreenContain() {
    const img = getCurrentImage();
    if (!img || !canvas) return;

    const cw = canvas.width, ch = canvas.height;
    const s = Math.min(cw / img.w, ch / img.h) * 0.98;
    state.view.scale = clamp(s, MIN_SCALE, MAX_SCALE);
    state.view.ox = (cw - img.w * state.view.scale) / 2;
    state.view.oy = (ch - img.h * state.view.scale) / 2;
  }

  function zoomAtCanvasPoint(cx, cy, factor) {
    const img = getCurrentImage();
    if (!img || !canvas) return;

    const old = state.view.scale;
    const next = clamp(old * factor, MIN_SCALE, MAX_SCALE);
    const k = next / old;

    state.view.ox = cx - (cx - state.view.ox) * k;
    state.view.oy = cy - (cy - state.view.oy) * k;
    state.view.scale = next;
  }

  function canvasToImage(x, y) {
    return { x: (x - state.view.ox) / state.view.scale, y: (y - state.view.oy) / state.view.scale };
  }
  function imageToCanvas(x, y) {
    return { x: x * state.view.scale + state.view.ox, y: y * state.view.scale + state.view.oy };
  }

  /* -----------------------------
     Canvas sizing
  ----------------------------- */
  function resizeCanvasToWrap() {
    if (!canvasWrap || !canvas) return;
    const r = canvasWrap.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  function getCanvasMouse(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* -----------------------------
     History
  ----------------------------- */
  function pushHistory(cmd) {
    cmd.do();
    state.history.redo.length = 0;
    state.history.undo.push(cmd);
    updateUndoRedoButtons();
    markDirty();
  }
  function undo() {
    const cmd = state.history.undo.pop();
    if (!cmd) return;
    cmd.undo();
    state.history.redo.push(cmd);
    updateUndoRedoButtons();
    markDirty();
  }
  function redo() {
    const cmd = state.history.redo.pop();
    if (!cmd) return;
    cmd.do();
    state.history.undo.push(cmd);
    updateUndoRedoButtons();
    markDirty();
  }
  function updateUndoRedoButtons() {
    if (undoBtn) undoBtn.disabled = state.history.undo.length === 0;
    if (redoBtn) redoBtn.disabled = state.history.redo.length === 0;
  }

  /* -----------------------------
     Mode (single setMode only)
  ----------------------------- */
  function resetDrawing() {
    state.drawing.isDown = false;
    state.drawing.startImg = null;
    state.drawing.bboxDraft = null;
    state.drawing.isPolyDrawing = false;
    state.drawing.polyPoints = [];
    state.drawing.polyHover = null;
    state.dragOp = null;
  }

  function setMode(mode) {
    state.mode = (mode === "poly") ? "poly" : "bbox";
    resetDrawing();
    $$(".mode__item").forEach(b => b.classList.toggle("is-active", b.dataset.mode === state.mode));
    updateAnnTypeUI();
    redraw();
    markDirty();
  }

  /* -----------------------------
     Images
  ----------------------------- */
  async function loadImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  }

  async function addImageFromFile(file) {
    const url = URL.createObjectURL(file);
    const bitmap = await loadImage(url).catch(() => null);
    if (!bitmap) {
      URL.revokeObjectURL(url);
      return null;
    }

    const imageObj = {
      id: uid(),
      file,
      name: file.name,
      url,
      bitmap,
      w: bitmap.naturalWidth,
      h: bitmap.naturalHeight,
      annotations: []
    };

    state.images.push(imageObj);
    tryApplyPendingToImage(imageObj);
    return imageObj;
  }

  function selectImage(imageId) {
    const img = state.images.find(i => i.id === imageId);
    if (!img) return;

    state.currentImageId = imageId;
    state.selectedAnnId = null;
    resetDrawing();

    if (emptyState) emptyState.style.display = "none";
    if (imgNameEl) imgNameEl.textContent = img.name;
    if (imgMetaEl) imgMetaEl.textContent = `${img.w}×${img.h}`;

    resizeCanvasToWrap();
    fitToScreenContain();
    updateUIAll();
    redraw();
  }

  function deleteImage(imageId) {
    const idx = state.images.findIndex(i => i.id === imageId);
    if (idx === -1) return;

    const removed = state.images[idx];
    pushHistory({
      do() {
        try { if (removed.url) URL.revokeObjectURL(removed.url); } catch {}
        state.images.splice(idx, 1);

        if (state.currentImageId === imageId) {
          state.currentImageId = state.images[0]?.id || null;
          state.selectedAnnId = null;
          resetDrawing();
          if (state.currentImageId) selectImage(state.currentImageId);
          else clearWorkspaceUI();
        }
        updateUIAll();
        redraw();
      },
      undo() {
        state.images.splice(idx, 0, removed);
        if (!state.currentImageId) selectImage(removed.id);
        updateUIAll();
        redraw();
      }
    });
  }

  function clearWorkspaceUI() {
    if (emptyState) emptyState.style.display = "flex";
    if (imgNameEl) imgNameEl.textContent = "No image";
    if (imgMetaEl) imgMetaEl.textContent = "—";
    if (selectedStatus) selectedStatus.textContent = "None";

    if (infoFilename) infoFilename.textContent = "—";
    if (infoResolution) infoResolution.textContent = "—";
    if (infoCount) infoCount.textContent = "0";
    if (infoActiveLabel) infoActiveLabel.textContent = getActiveLabel()?.name || "—";

    if (regionsListEl) regionsListEl.innerHTML = "";
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /* -----------------------------
     Labels
  ----------------------------- */
  function addLabel({ name, color }) {
    const lbl = { id: uid(), name, color };
    pushHistory({
      do() {
        state.labels.push(lbl);
        state.activeLabelId = lbl.id;
        updateUIAll();
      },
      undo() {
        const i = state.labels.findIndex(l => l.id === lbl.id);
        if (i !== -1) state.labels.splice(i, 1);
        if (state.activeLabelId === lbl.id) state.activeLabelId = null;
        state.labelHidden.delete(lbl.id);
        state.labelLocked.delete(lbl.id);
        updateUIAll();
      }
    });
  }

  function deleteLabel(labelId) {
    const idx = state.labels.findIndex(l => l.id === labelId);
    if (idx === -1) return;

    const removed = state.labels[idx];
    const wasActive = state.activeLabelId === labelId;
    const wasHidden = state.labelHidden.has(labelId);
    const wasLocked = state.labelLocked.has(labelId);

    pushHistory({
      do() {
        state.labels.splice(idx, 1);
        if (wasActive) state.activeLabelId = null;
        state.labelHidden.delete(labelId);
        state.labelLocked.delete(labelId);
        updateUIAll();
        redraw();
      },
      undo() {
        state.labels.splice(idx, 0, removed);
        if (wasActive) state.activeLabelId = removed.id;
        if (wasHidden) state.labelHidden.add(labelId);
        if (wasLocked) state.labelLocked.add(labelId);
        updateUIAll();
        redraw();
      }
    });
  }

  function setActiveLabel(labelId) {
    state.activeLabelId = labelId;
    renderLabels();
    updateInfoPanel();
    markDirty();
  }

  function clearActiveLabel() {
    if (!state.activeLabelId) return;
    state.activeLabelId = null;
    renderLabels();
    updateInfoPanel();
    markDirty();
  }

  /* -----------------------------
     UI Rendering
  ----------------------------- */
  function updateUIAll() {
    renderImageList();
    renderLabels();
    renderRegions();
    updateInfoPanel();
    updateUndoRedoButtons();
    updateAnnTypeUI();
  }

  function renderImageList() {
    if (!imageListEl) return;
    imageListEl.innerHTML = "";

    const q = state.filter;
    const list = q
      ? state.images.filter(img => img.name.toLowerCase().includes(q))
      : state.images;

    for (const img of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "img-item" + (img.id === state.currentImageId ? " is-active" : "");
      btn.dataset.id = img.id;

      const thumb = document.createElement("div");
      thumb.className = "img-item__thumb";
      thumb.style.backgroundImage = `url('${img.url}')`;

      const close = document.createElement("button");
      close.type = "button";
      close.className = "img-item__close";
      close.textContent = "×";
      close.title = "Remove image";

      const cap = document.createElement("div");
      cap.className = "img-item__cap";

      const name = document.createElement("div");
      name.className = "img-item__name";
      name.textContent = img.name;

      const sub = document.createElement("div");
      sub.className = "img-item__sub";
      sub.textContent = `${img.w}×${img.h} • ${(img.annotations?.length || 0)} ann`;

      cap.appendChild(name);
      cap.appendChild(sub);

      thumb.appendChild(close);
      thumb.appendChild(cap);

      btn.appendChild(thumb);
      imageListEl.appendChild(btn);
    }
  }

  function renderLabels() {
    if (!classStripEl) return;
    classStripEl.innerHTML = "";

    for (const lbl of state.labels) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "class-pill" + (lbl.id === state.activeLabelId ? " is-active" : "");
      pill.dataset.id = lbl.id;

      pill.style.setProperty("--lbl", lbl.color);

      const sw = document.createElement("span");
      sw.className = "class-pill__swatch";
      sw.style.setProperty("--lbl", lbl.color);

      const text = document.createElement("span");
      text.textContent = lbl.name;

      const close = document.createElement("span");
      close.className = "class-pill__close";
      close.textContent = "×";
      close.title = "Delete label";

      pill.appendChild(sw);
      pill.appendChild(text);
      pill.appendChild(close);
      classStripEl.appendChild(pill);
    }
  }

  function updateInfoPanel() {
    const img = getCurrentImage();
    const active = getActiveLabel();

    if (infoFilename) infoFilename.textContent = img ? img.name : "—";
    if (infoResolution) infoResolution.textContent = img ? `${img.w}×${img.h}` : "—";
    if (infoCount) infoCount.textContent = img ? String(img.annotations?.length || 0) : "0";
    if (infoActiveLabel) infoActiveLabel.textContent = active ? active.name : "—";
    if (selectedStatus) selectedStatus.textContent = state.selectedAnnId ? "Selected" : "None";
  }

  function annLabelText(ann) {
    const lbl = ann.labelId ? state.labels.find(l => l.id === ann.labelId) : null;
    return lbl?.name || "Unlabeled";
  }

  /* -----------------------------
     Regions (OLD workflow: group + row controls)
  ----------------------------- */
  function renderRegions() {
    if (!regionsListEl) return;
    const img = getCurrentImage();
    regionsListEl.innerHTML = "";

    if (!img || !img.annotations.length) {
      regionsListEl.innerHTML = `<div class="rs-empty small">
        <h3>No regions yet</h3>
        <p>Create a bbox or polygon to see regions here.</p>
      </div>`;
      return;
    }

    const groups = new Map(); // key -> {labelId,labelName,labelColor,items:[]}
    for (const ann of img.annotations) {
      const key = ann.labelId || "__unlabeled__";
      if (!groups.has(key)) {
        const lbl = ann.labelId ? state.labels.find(l => l.id === ann.labelId) : null;
        groups.set(key, {
          labelId: ann.labelId || null,
          labelName: lbl?.name || "Unlabeled",
          labelColor: lbl?.color || "#94a3b8",
          items: []
        });
      }
      groups.get(key).items.push(ann);
    }

    for (const [, g] of groups) {
      const details = document.createElement("details");
      details.className = "rg";
      details.open = true;

      const head = document.createElement("summary");
      head.className = "rg-head";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";
      left.style.minWidth = "0";

      const dot = document.createElement("span");
      dot.style.width = "10px";
      dot.style.height = "10px";
      dot.style.borderRadius = "999px";
      dot.style.background = g.labelColor;

      const title = document.createElement("span");
      title.className = "rg-name";
      title.textContent = g.labelName;

      const count = document.createElement("span");
      count.style.opacity = ".7";
      count.style.fontWeight = "800";
      count.textContent = `(${g.items.length})`;

      left.appendChild(dot);
      left.appendChild(title);
      left.appendChild(count);

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.alignItems = "center";
      actions.style.gap = "6px";

      const labelId = g.labelId || "";
      const groupEnabled = !!g.labelId;

      const hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "r-btn";
      hideBtn.dataset.action = "toggleLabelHidden";
      hideBtn.dataset.labelId = labelId;
      hideBtn.disabled = !groupEnabled;
      hideBtn.textContent = groupEnabled && isLabelHidden(g.labelId) ? "🙈" : "👁";

      const lockBtn = document.createElement("button");
      lockBtn.type = "button";
      lockBtn.className = "r-btn";
      lockBtn.dataset.action = "toggleLabelLocked";
      lockBtn.dataset.labelId = labelId;
      lockBtn.disabled = !groupEnabled;
      // ✅ correct icons: locked => 🔒, unlocked => 🔓
      lockBtn.textContent = groupEnabled && isLabelLocked(g.labelId) ? "🔒" : "🔓";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "r-btn";
      delBtn.dataset.action = "deleteLabelGroup";
      delBtn.dataset.labelId = labelId;
      delBtn.disabled = !groupEnabled || (groupEnabled && isLabelLocked(g.labelId));
      delBtn.textContent = "🗑";

      actions.appendChild(hideBtn);
      actions.appendChild(lockBtn);
      actions.appendChild(delBtn);

      head.appendChild(left);
      head.appendChild(actions);

      const body = document.createElement("div");
      body.style.padding = "6px 0";

      for (const ann of g.items) {
        const row = document.createElement("div");
        row.className =
          "region-row-ui" +
          (ann.id === state.selectedAnnId ? " is-selected" : "") +
          (isAnnEffectivelyHidden(ann) ? " is-hidden" : "") +
          (isAnnEffectivelyLocked(ann) ? " is-locked" : "");
        row.dataset.id = ann.id;

        const rLeft = document.createElement("div");
        rLeft.className = "rr-left";

        const ico = document.createElement("div");
        ico.className = "rr-ico";
        ico.textContent = ann.type === "poly" ? "⬠" : "▭";

        const name = document.createElement("div");
        name.className = "rr-name";
        name.style.color = "#f97316";
        name.textContent = annLabelText(ann);

        rLeft.appendChild(ico);
        rLeft.appendChild(name);

        const rActions = document.createElement("div");
        rActions.className = "rr-actions";

        const aHide = document.createElement("button");
        aHide.type = "button";
        aHide.className = "r-btn";
        aHide.dataset.action = "toggleHidden";
        aHide.textContent = ann.hidden ? "🙈" : "👁";

        const aLock = document.createElement("button");
        aLock.type = "button";
        aLock.className = "r-btn";
        aLock.dataset.action = "toggleLocked";
        aLock.disabled = isLabelLocked(ann.labelId);
        // ✅ correct icons: locked => 🔒, unlocked => 🔓
        aLock.textContent = ann.locked ? "🔒" : "🔓";

        const aDel = document.createElement("button");
        aDel.type = "button";
        aDel.className = "r-btn";
        aDel.dataset.action = "delete";
        aDel.disabled = isAnnEffectivelyLocked(ann);
        aDel.textContent = "🗑";

        rActions.appendChild(aHide);
        rActions.appendChild(aLock);
        rActions.appendChild(aDel);

        row.appendChild(rLeft);
        row.appendChild(rActions);
        body.appendChild(row);
      }

      details.appendChild(head);
      details.appendChild(body);
      regionsListEl.appendChild(details);
    }
  }

  /* -----------------------------
     Annotation CRUD
  ----------------------------- */
  function addAnnotation(img, annLike) {
    const ann = {
      id: uid(),
      type: annLike.type,
      color: annLike.color || "#fb923c",
      labelId: annLike.labelId || null,
      bbox: annLike.bbox || null,
      points: annLike.points || null,
      hidden: false,
      locked: false
    };

    pushHistory({
      do() {
        img.annotations.push(ann);
        state.selectedAnnId = ann.id;
        updateUIAll();
        redraw();
      },
      undo() {
        const idx = img.annotations.findIndex(a => a.id === ann.id);
        if (idx !== -1) img.annotations.splice(idx, 1);
        if (state.selectedAnnId === ann.id) state.selectedAnnId = null;
        updateUIAll();
        redraw();
      }
    });
  }

  function deleteAnnotationById(annId) {
    const img = getCurrentImage();
    if (!img) return;

    const idx = img.annotations.findIndex(a => a.id === annId);
    if (idx === -1) return;

    const removed = img.annotations[idx];
    pushHistory({
      do() {
        img.annotations.splice(idx, 1);
        if (state.selectedAnnId === annId) state.selectedAnnId = null;
        updateUIAll();
        redraw();
      },
      undo() {
        img.annotations.splice(idx, 0, removed);
        state.selectedAnnId = removed.id;
        updateUIAll();
        redraw();
      }
    });
  }

  /* -----------------------------
     Regions actions (group + row) with history
  ----------------------------- */
  function toggleAnnHidden(annId) {
    const img = getCurrentImage();
    if (!img) return;
    const ann = img.annotations.find(a => a.id === annId);
    if (!ann) return;

    const before = deepClone(ann);
    const after = deepClone(ann);
    after.hidden = !before.hidden;

    pushHistory({
      do() {
        const idx = img.annotations.findIndex(a => a.id === annId);
        if (idx !== -1) img.annotations[idx] = after;
        updateUIAll();
        redraw();
      },
      undo() {
        const idx = img.annotations.findIndex(a => a.id === annId);
        if (idx !== -1) img.annotations[idx] = before;
        updateUIAll();
        redraw();
      }
    });
  }

  function toggleAnnLocked(annId) {
    const img = getCurrentImage();
    if (!img) return;
    const ann = img.annotations.find(a => a.id === annId);
    if (!ann) return;

    if (isLabelLocked(ann.labelId)) return; // label lock overrides

    const before = deepClone(ann);
    const after = deepClone(ann);
    after.locked = !before.locked;

    pushHistory({
      do() {
        const idx = img.annotations.findIndex(a => a.id === annId);
        if (idx !== -1) img.annotations[idx] = after;
        updateUIAll();
        redraw();
      },
      undo() {
        const idx = img.annotations.findIndex(a => a.id === annId);
        if (idx !== -1) img.annotations[idx] = before;
        updateUIAll();
        redraw();
      }
    });
  }

  function toggleLabelHidden(labelId) {
    if (!labelId) return;

    pushHistory({
      do() {
        if (state.labelHidden.has(labelId)) state.labelHidden.delete(labelId);
        else state.labelHidden.add(labelId);
        updateUIAll();
        redraw();
      },
      undo() {
        if (state.labelHidden.has(labelId)) state.labelHidden.delete(labelId);
        else state.labelHidden.add(labelId);
        updateUIAll();
        redraw();
      }
    });
  }

  function toggleLabelLocked(labelId) {
    if (!labelId) return;

    pushHistory({
      do() {
        if (state.labelLocked.has(labelId)) state.labelLocked.delete(labelId);
        else state.labelLocked.add(labelId);
        updateUIAll();
        redraw();
      },
      undo() {
        if (state.labelLocked.has(labelId)) state.labelLocked.delete(labelId);
        else state.labelLocked.add(labelId);
        updateUIAll();
        redraw();
      }
    });
  }

  function deleteLabelGroup(labelId) {
    const img = getCurrentImage();
    if (!img || !labelId) return;
    if (state.labelLocked.has(labelId)) return;

    const before = deepClone(img.annotations);
    const after = img.annotations.filter(a => a.labelId !== labelId);
    if (after.length === before.length) return;

    pushHistory({
      do() {
        img.annotations = after;
        if (state.selectedAnnId && !img.annotations.some(a => a.id === state.selectedAnnId)) {
          state.selectedAnnId = null;
        }
        updateUIAll();
        redraw();
      },
      undo() {
        img.annotations = before;
        updateUIAll();
        redraw();
      }
    });
  }

  /* -----------------------------
     Hit testing helpers
  ----------------------------- */
  function pointInBBox(p, b) {
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  function pointInPolygon(p, vs) {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i].x, yi = vs[i].y;
      const xj = vs[j].x, yj = vs[j].y;
      const intersect =
        ((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / ((yj - yi) || 1e-9) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function bboxHandlePointsCanvas(b) {
    const x1 = b.x, y1 = b.y;
    const x2 = b.x + b.w, y2 = b.y + b.h;
    const xm = (x1 + x2) / 2;
    const ym = (y1 + y2) / 2;

    const P = (x, y, handle) => {
      const c = imageToCanvas(x, y);
      return { x: c.x, y: c.y, handle };
    };

    return [
      P(x1, y1, "nw"),
      P(xm, y1, "n"),
      P(x2, y1, "ne"),
      P(x2, ym, "e"),
      P(x2, y2, "se"),
      P(xm, y2, "s"),
      P(x1, y2, "sw"),
      P(x1, ym, "w")
    ];
  }

  function hitBBoxHandle(b, cx, cy) {
    const pts = bboxHandlePointsCanvas(b);
    for (const hp of pts) {
      if (Math.abs(cx - hp.x) <= HANDLE_SIZE_PX && Math.abs(cy - hp.y) <= HANDLE_SIZE_PX) {
        return hp.handle;
      }
    }
    return null;
  }

  function hitTest(img, canvasX, canvasY) {
    const ip = canvasToImage(canvasX, canvasY);

    for (let k = img.annotations.length - 1; k >= 0; k--) {
      const ann = img.annotations[k];
      if (isAnnEffectivelyHidden(ann)) continue;

      const isSelected = ann.id === state.selectedAnnId;

      // polygon vertices only when selected
      if (ann.type === "poly" && isSelected && ann.points?.length) {
        const tolImg = VERTEX_HIT_RADIUS_PX / state.view.scale;
        for (let i = 0; i < ann.points.length; i++) {
          const p = ann.points[i];
          if (Math.hypot(ip.x - p.x, ip.y - p.y) <= tolImg) {
            return { annId: ann.id, kind: "poly-vertex", vertexIndex: i };
          }
        }
      }

      // bbox handles only when selected
      if (ann.type === "bbox" && isSelected && ann.bbox) {
        const h = hitBBoxHandle(ann.bbox, canvasX, canvasY);
        if (h) return { annId: ann.id, kind: "bbox-resize", handle: h };
      }

      // bbox move
      if (ann.type === "bbox" && ann.bbox && pointInBBox(ip, ann.bbox)) {
        return { annId: ann.id, kind: "bbox-move" };
      }

      // poly move
      if (ann.type === "poly" && ann.points?.length && pointInPolygon(ip, ann.points)) {
        return { annId: ann.id, kind: "poly-move" };
      }
    }
    return null;
  }

  /* -----------------------------
     Geometry clamp helpers
  ----------------------------- */
  function clampPointToImage(p, img) {
    return { x: clamp(p.x, 0, img.w), y: clamp(p.y, 0, img.h) };
  }
  function normalizeBBox(b, img) {
    const x = clamp(b.x, 0, img.w);
    const y = clamp(b.y, 0, img.h);
    const w = clamp(b.w, 0, img.w - x);
    const h = clamp(b.h, 0, img.h - y);
    return { x, y, w, h };
  }

  /* -----------------------------
     Canvas interactions
  ----------------------------- */
  function onCanvasDown(e) {
    const img = getCurrentImage();
    if (!img || !canvas) return;

    const p = getCanvasMouse(e);
    const ip = clampPointToImage(canvasToImage(p.x, p.y), img);

    const hit = hitTest(img, p.x, p.y);
    if (hit) {
      const ann = img.annotations.find(a => a.id === hit.annId);
      if (!ann) return;

      state.selectedAnnId = ann.id;
      updateUIAll();
      redraw();

      if (isAnnEffectivelyLocked(ann)) return;

      if (hit.kind === "bbox-move") {
        state.dragOp = {
          kind: "bbox-move",
          annId: ann.id,
          startPt: ip,
          baseBBox: deepClone(ann.bbox),
          beforeAnn: deepClone(ann)
        };
      } else if (hit.kind === "bbox-resize") {
        state.dragOp = {
          kind: "bbox-resize",
          annId: ann.id,
          handle: hit.handle,
          startPt: ip,
          baseBBox: deepClone(ann.bbox),
          beforeAnn: deepClone(ann)
        };
      } else if (hit.kind === "poly-move") {
        state.dragOp = {
          kind: "poly-move",
          annId: ann.id,
          startPt: ip,
          basePoints: deepClone(ann.points),
          beforeAnn: deepClone(ann)
        };
      } else if (hit.kind === "poly-vertex") {
        state.dragOp = {
          kind: "poly-vertex",
          annId: ann.id,
          vertexIndex: hit.vertexIndex,
          beforeAnn: deepClone(ann)
        };
      }
      return;
    }

    state.selectedAnnId = null;
    updateUIAll();

    if (state.mode === "bbox") {
      state.drawing.isDown = true;
      state.drawing.startImg = ip;
      state.drawing.bboxDraft = { x: ip.x, y: ip.y, w: 0, h: 0 };
      redraw();
      return;
    }

    if (state.mode === "poly") {
      handlePolyClick(img, ip, p);
      redraw();
      return;
    }
  }

  function onCanvasMove(e) {
    const img = getCurrentImage();
    if (!img || !canvas) return;

    const p = getCanvasMouse(e);
    const ip = clampPointToImage(canvasToImage(p.x, p.y), img);

    if (state.dragOp) {
      const op = state.dragOp;
      const ann = img.annotations.find(a => a.id === op.annId);
      if (!ann || isAnnEffectivelyHidden(ann) || isAnnEffectivelyLocked(ann)) return;

      if (op.kind === "bbox-move") applyBBoxMove(ann, op, ip, img);
      if (op.kind === "bbox-resize") applyBBoxResize(ann, op, ip, img);
      if (op.kind === "poly-move") applyPolyMove(ann, op, ip, img);
      if (op.kind === "poly-vertex") applyPolyVertex(ann, op, ip, img);

      redraw();
      return;
    }

    if (state.mode === "bbox" && state.drawing.isDown && state.drawing.bboxDraft) {
      const s = state.drawing.startImg;
      const x = Math.min(s.x, ip.x);
      const y = Math.min(s.y, ip.y);
      const w = Math.abs(ip.x - s.x);
      const h = Math.abs(ip.y - s.y);
      state.drawing.bboxDraft = { x, y, w, h };
      redraw();
      return;
    }

    if (state.mode === "poly") {
      state.drawing.polyHover = ip;
      redraw();
    }
  }

  function onCanvasUp() {
    const img = getCurrentImage();
    if (!img) return;

    if (state.dragOp) {
      const op = state.dragOp;
      const ann = img.annotations.find(a => a.id === op.annId);
      state.dragOp = null;
      if (!ann) return;

      const after = deepClone(ann);
      const before = op.beforeAnn;

      if (JSON.stringify(before) !== JSON.stringify(after)) {
        pushHistory({
          do() {
            const idx = img.annotations.findIndex(a => a.id === after.id);
            if (idx !== -1) img.annotations[idx] = deepClone(after);
            updateUIAll();
            redraw();
          },
          undo() {
            const idx = img.annotations.findIndex(a => a.id === before.id);
            if (idx !== -1) img.annotations[idx] = deepClone(before);
            updateUIAll();
            redraw();
          }
        });
      } else {
        updateUIAll();
      }
      return;
    }

    if (state.mode === "bbox" && state.drawing.bboxDraft) {
      const draft = normalizeBBox(state.drawing.bboxDraft, img);
      state.drawing.bboxDraft = null;
      state.drawing.isDown = false;

      if (draft.w >= MIN_BBOX_SIZE_IMG && draft.h >= MIN_BBOX_SIZE_IMG) {
        addAnnotation(img, {
          type: "bbox",
          bbox: draft,
          color: strokeColor(),
          labelId: state.activeLabelId || null
        });
      }
      redraw();
      return;
    }

    state.drawing.isDown = false;
  }

  /* -----------------------------
     BBox operations
  ----------------------------- */
  function applyBBoxMove(ann, op, currentPt, img) {
    if (!ann.bbox) return;
    const dx = currentPt.x - op.startPt.x;
    const dy = currentPt.y - op.startPt.y;

    const b = deepClone(op.baseBBox);
    b.x = clamp(b.x + dx, 0, img.w - b.w);
    b.y = clamp(b.y + dy, 0, img.h - b.h);
    ann.bbox = b;
  }

  function applyBBoxResize(ann, op, currentPt, img) {
    if (!ann.bbox) return;
    const base = op.baseBBox;
    const x1 = base.x, y1 = base.y;
    const x2 = base.x + base.w, y2 = base.y + base.h;

    let nx1 = x1, ny1 = y1, nx2 = x2, ny2 = y2;
    const h = op.handle;

    if (h.includes("n")) ny1 = currentPt.y;
    if (h.includes("s")) ny2 = currentPt.y;
    if (h.includes("w")) nx1 = currentPt.x;
    if (h.includes("e")) nx2 = currentPt.x;

    let rx1 = Math.min(nx1, nx2);
    let rx2 = Math.max(nx1, nx2);
    let ry1 = Math.min(ny1, ny2);
    let ry2 = Math.max(ny1, ny2);

    if (rx2 - rx1 < MIN_BBOX_SIZE_IMG) {
      if (h.includes("w")) rx1 = rx2 - MIN_BBOX_SIZE_IMG;
      else rx2 = rx1 + MIN_BBOX_SIZE_IMG;
    }
    if (ry2 - ry1 < MIN_BBOX_SIZE_IMG) {
      if (h.includes("n")) ry1 = ry2 - MIN_BBOX_SIZE_IMG;
      else ry2 = ry1 + MIN_BBOX_SIZE_IMG;
    }

    rx1 = clamp(rx1, 0, img.w);
    rx2 = clamp(rx2, 0, img.w);
    ry1 = clamp(ry1, 0, img.h);
    ry2 = clamp(ry2, 0, img.h);

    const w = clamp(rx2 - rx1, MIN_BBOX_SIZE_IMG, img.w - rx1);
    const h2 = clamp(ry2 - ry1, MIN_BBOX_SIZE_IMG, img.h - ry1);

    ann.bbox = { x: rx1, y: ry1, w, h: h2 };
  }

  /* -----------------------------
     Polygon operations
  ----------------------------- */
  function handlePolyClick(img, ip, canvasPoint) {
    if (!state.drawing.isPolyDrawing) {
      state.drawing.isPolyDrawing = true;
      state.drawing.polyPoints = [ip];
      return;
    }

    const pts = state.drawing.polyPoints;
    const first = pts[0];
    const firstCanvas = imageToCanvas(first.x, first.y);
    const d = Math.hypot(canvasPoint.x - firstCanvas.x, canvasPoint.y - firstCanvas.y);

    if (pts.length >= 3 && d <= POLY_CLOSE_THRESHOLD_PX) {
      addAnnotation(img, {
        type: "poly",
        points: pts.map(p => ({ x: p.x, y: p.y })),
        color: strokeColor(),
        labelId: state.activeLabelId || null
      });

      state.drawing.isPolyDrawing = false;
      state.drawing.polyPoints = [];
      state.drawing.polyHover = null;
      return;
    }

    pts.push(ip);
  }

  function applyPolyVertex(ann, op, currentPt, img) {
    if (!ann.points?.length) return;
    const i = op.vertexIndex;
    if (i < 0 || i >= ann.points.length) return;
    ann.points[i] = clampPointToImage(currentPt, img);
  }

  function applyPolyMove(ann, op, currentPt, img) {
    if (!ann.points?.length) return;

    const dx = currentPt.x - op.startPt.x;
    const dy = currentPt.y - op.startPt.y;

    const base = op.basePoints;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    base.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });

    const cdx = clamp(dx, -minX, img.w - maxX);
    const cdy = clamp(dy, -minY, img.h - maxY);

    ann.points = base.map(p => ({ x: p.x + cdx, y: p.y + cdy }));
  }

  /* -----------------------------
     Drawing
  ----------------------------- */
  function drawBBoxHandles(b) {
    const pts = bboxHandlePointsCanvas(b);
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 1;
    for (const p of pts) {
      ctx.beginPath();
      ctx.rect(p.x - HANDLE_SIZE_PX / 2, p.y - HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPolyVertices(ptsCanvas) {
    ctx.save();
    for (const p of ptsCanvas) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAnnotation(ann, isSelected) {
    ctx.save();
    ctx.strokeStyle = ann.color || "#fb923c";
    ctx.fillStyle = ann.color || "#fb923c";
    ctx.lineWidth = 2;

    if (ann.type === "bbox" && ann.bbox) {
      const b = ann.bbox;
      const p = imageToCanvas(b.x, b.y);
      const w = b.w * state.view.scale;
      const h = b.h * state.view.scale;

      ctx.strokeRect(p.x, p.y, w, h);
      ctx.globalAlpha = 0.10;
      ctx.fillRect(p.x, p.y, w, h);
      ctx.globalAlpha = 1;

      if (isSelected && !isAnnEffectivelyLocked(ann)) drawBBoxHandles(b);
    }

    if (ann.type === "poly" && ann.points?.length) {
      const pts = ann.points.map(pt => imageToCanvas(pt.x, pt.y));
      if (pts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 0.10;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (isSelected && !isAnnEffectivelyLocked(ann)) drawPolyVertices(pts);
    }

    ctx.restore();
  }

  function drawDrafts() {
    const img = getCurrentImage();
    if (!img || !ctx) return;

    if (state.mode === "bbox" && state.drawing.bboxDraft) {
      const b = state.drawing.bboxDraft;
      const p = imageToCanvas(b.x, b.y);
      const w = b.w * state.view.scale;
      const h = b.h * state.view.scale;

      ctx.save();
      ctx.strokeStyle = strokeColor();
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(p.x, p.y, w, h);
      ctx.restore();
    }

    if (state.mode === "poly" && state.drawing.isPolyDrawing) {
      const pts = state.drawing.polyPoints.map(pt => imageToCanvas(pt.x, pt.y));
      if (!pts.length) return;

      ctx.save();
      ctx.strokeStyle = strokeColor();
      ctx.lineWidth = 2;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);

      if (state.drawing.polyHover) {
        const h = imageToCanvas(state.drawing.polyHover.x, state.drawing.polyHover.y);
        ctx.lineTo(h.x, h.y);
      }
      ctx.stroke();

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const r = (i === 0) ? POLY_START_RADIUS_PX : POLY_POINT_RADIUS_PX;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(251,146,60,0.18)";
        ctx.strokeStyle = "rgba(251,146,60,0.95)";
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();
      }

      if (pts.length >= 3 && state.drawing.polyHover) {
        const first = pts[0];
        const hv = imageToCanvas(state.drawing.polyHover.x, state.drawing.polyHover.y);
        const d = Math.hypot(hv.x - first.x, hv.y - first.y);
        if (d <= POLY_CLOSE_THRESHOLD_PX) {
          ctx.beginPath();
          ctx.arc(first.x, first.y, POLY_CLOSE_THRESHOLD_PX, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(34,197,94,0.85)";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
        }
      }

      ctx.restore();
    }
  }

  function redraw() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const img = getCurrentImage();
    if (!img) {
      clearWorkspaceUI();
      return;
    }

    ctx.save();
    ctx.setTransform(state.view.scale, 0, 0, state.view.scale, state.view.ox, state.view.oy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.bitmap, 0, 0, img.w, img.h);
    ctx.restore();

    for (const ann of img.annotations) {
      if (isAnnEffectivelyHidden(ann)) continue;
      drawAnnotation(ann, ann.id === state.selectedAnnId);
    }

    drawDrafts();
  }

  /* =========================================================
     RESET EVERYTHING (images + labels + annotations + regions)
  ========================================================= */
  function resetEverything() {
    for (const img of state.images) {
      try { if (img.url) URL.revokeObjectURL(img.url); } catch {}
    }

    state.images = [];
    state.labels = [];
    state.currentImageId = null;
    state.activeLabelId = null;
    state.selectedAnnId = null;
    state.labelHidden = new Set();
    state.labelLocked = new Set();
    state.view = { scale: 1, ox: 0, oy: 0 };
    resetDrawing();

    state.history.undo.length = 0;
    state.history.redo.length = 0;
    updateUndoRedoButtons();

    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    try { pendingByKey.clear(); } catch {}

    if (imageListEl) imageListEl.innerHTML = "";
    if (classStripEl) classStripEl.innerHTML = "";
    if (regionsListEl) regionsListEl.innerHTML = "";
    clearWorkspaceUI();

    if (fileInput) fileInput.value = "";
    if (newClassName) newClassName.value = "";
    if (newClassColor) newClassColor.value = "#fb923c";

    updateAnnTypeUI();
  }

  /* =========================================================
     EXPORT (ZIP) — chosen type labels only
  ========================================================= */
  async function saveZipToSpecificFolderOnly(zipBlob, filename) {
    // NOTE: Must run on https:// or localhost (not file://)
    if (window.showDirectoryPicker) {
      try {
        const dir = await window.showDirectoryPicker();
        const fh = await dir.getFileHandle(filename, { create: true });
        const w = await fh.createWritable();
        await w.write(zipBlob);
        await w.close();
        return true;
      } catch (err) {
        console.warn("Folder save cancelled/failed:", err);
        return false;
      }
    }

    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }]
        });
        const w = await handle.createWritable();
        await w.write(zipBlob);
        await w.close();
        return true;
      } catch (err) {
        console.warn("Save picker cancelled/failed:", err);
        return false;
      }
    }

    alert("Saving to a specific folder is not supported in this browser. Use Chrome / Edge on https or localhost.");
    return false;
  }

  function bboxToYoloLine(b, imgW, imgH, classIndex) {
    const cx = (b.x + b.w / 2) / imgW;
    const cy = (b.y + b.h / 2) / imgH;
    const w = b.w / imgW;
    const h = b.h / imgH;
    const c = (v) => Math.max(0, Math.min(1, v));
    return `${classIndex} ${c(cx).toFixed(6)} ${c(cy).toFixed(6)} ${c(w).toFixed(6)} ${c(h).toFixed(6)}`;
  }

  function polyToYoloSegLine(points, imgW, imgH, classIndex) {
    const norm = (v, max) => Math.max(0, Math.min(1, v / max));
    const coords = [];
    for (const p of points) {
      coords.push(norm(p.x, imgW).toFixed(6));
      coords.push(norm(p.y, imgH).toFixed(6));
    }
    return `${classIndex} ${coords.join(" ")}`;
  }

  async function renderAnnotatedImageBlob_Filtered(img, chosenType) {
    const c = document.createElement("canvas");
    c.width = img.w;
    c.height = img.h;
    const g = c.getContext("2d");
    g.drawImage(img.bitmap, 0, 0, img.w, img.h);

    for (const ann of (img.annotations || [])) {
      if (ann.type !== chosenType) continue;

      const color = ann.color || "#fb923c";
      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 3;

      if (ann.type === "bbox" && ann.bbox) {
        const b = ann.bbox;
        g.strokeRect(b.x, b.y, b.w, b.h);
        g.globalAlpha = 0.12;
        g.fillRect(b.x, b.y, b.w, b.h);
        g.globalAlpha = 1;
      }

      if (ann.type === "poly" && Array.isArray(ann.points) && ann.points.length >= 3) {
        g.beginPath();
        g.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) g.lineTo(ann.points[i].x, ann.points[i].y);
        g.closePath();
        g.stroke();
        g.globalAlpha = 0.10;
        g.fill();
        g.globalAlpha = 1;
      }
    }

    const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png", 0.92));
    if (!blob) throw new Error("Canvas toBlob returned null");
    return blob;
  }

  async function exportDatasetZip() {
    try {
      if (!state.images.length) return alert("No images to export.");
      if (!state.labels.length) return alert("No labels available. Add labels first.");

      const chosenType = (state.mode === "poly") ? "poly" : "bbox";
      const zipName = chosenType === "bbox" ? "dataset_bbox.zip" : "dataset_polygon.zip";

      const classes = state.labels.map(l => l.name);
      const labelIdToIndex = new Map(state.labels.map((l, i) => [l.id, i]));

      const datasetYaml =
`path: .
train: images
val: images

names:
${classes.map((n, i) => `  ${i}: ${n}`).join("\n")}
`;

      const zw = new ZipWriter();

      zw.addText("meta/classes.txt", classes.join("\n"));
      zw.addText("meta/summary.json", JSON.stringify({
        createdAt: new Date().toISOString(),
        chosenType,
        totalImages: state.images.length,
        totalClasses: state.labels.length,
        labelFormat: chosenType === "bbox"
          ? "YOLO Detect: class x_center y_center width height (normalized)"
          : "YOLO Seg: class x1 y1 x2 y2 ... (normalized polygon vertices)"
      }, null, 2));
      zw.addText("dataset.yaml", datasetYaml);

      for (const img of state.images) {
        const base = fileBaseName(img.name);

        // images/
        if (img.file) {
          const u8 = await blobToU8(img.file);
          zw.addFile(`images/${img.name}`, u8, new Date(img.file.lastModified || Date.now()));
        }

        // labels/ (only chosen type)
        const lines = [];
        for (const ann of (img.annotations || [])) {
          if (ann.type !== chosenType) continue;

          const classIndex = (ann.labelId && labelIdToIndex.has(ann.labelId))
            ? labelIdToIndex.get(ann.labelId)
            : null;
          if (classIndex === null) continue;

          if (chosenType === "bbox") {
            if (!ann.bbox) continue;
            const b = ann.bbox;
            if (b.w <= 0 || b.h <= 0) continue;
            lines.push(bboxToYoloLine(b, img.w, img.h, classIndex));
          } else {
            if (!Array.isArray(ann.points) || ann.points.length < 3) continue;
            lines.push(polyToYoloSegLine(ann.points, img.w, img.h, classIndex));
          }
        }
        zw.addText(`labels/${base}.txt`, lines.join("\n"));

        // annotated_images/ filtered
        const annBlob = await renderAnnotatedImageBlob_Filtered(img, chosenType);
        const annU8 = await blobToU8(annBlob);
        zw.addFile(`annotated_images/${base}.png`, annU8, new Date());
      }

      const zipBlob = zw.finalizeBlob();
      const ok = await saveZipToSpecificFolderOnly(zipBlob, zipName);
      if (!ok) return;

      alert(`Export completed ✅\nSaved: ${zipName}`);
    } catch (err) {
      console.error(err);
      alert("Export failed. Open Console (F12) and share the first red error line.");
    }
  }

  /* -----------------------------
     Resizers (pointer events)
  ----------------------------- */
  function initResizers() {
    if (leftResizer) attachResizer(leftResizer, "left");
    if (rightResizer) attachResizer(rightResizer, "right");
  }

  function attachResizer(handleEl, side) {
    let startX = 0;
    let startLeft = 0;
    let startRight = 0;

    function onPointerDown(e) {
      if (side === "right" && document.body.classList.contains("details-hidden")) return;
      e.preventDefault();
      handleEl.setPointerCapture(e.pointerId);

      startX = e.clientX;
      startLeft = getCSSVarPx("--leftW", 260);
      startRight = getCSSVarPx("--rightW", 360);

      document.body.classList.add("is-resizing");
      handleEl.addEventListener("pointermove", onPointerMove);
      handleEl.addEventListener("pointerup", onPointerUp);
      handleEl.addEventListener("pointercancel", onPointerUp);
    }

    function onPointerMove(e) {
      const dx = e.clientX - startX;

      if (side === "left") setCSSVar("--leftW", px(clamp(startLeft + dx, MIN_LEFT, MAX_LEFT)));
      else setCSSVar("--rightW", px(clamp(startRight - dx, MIN_RIGHT, MAX_RIGHT)));

      resizeCanvasToWrap();
      redraw();
    }

    function onPointerUp(e) {
      document.body.classList.remove("is-resizing");
      handleEl.removeEventListener("pointermove", onPointerMove);
      handleEl.removeEventListener("pointerup", onPointerUp);
      handleEl.removeEventListener("pointercancel", onPointerUp);
      try { handleEl.releasePointerCapture(e.pointerId); } catch {}
    }

    handleEl.addEventListener("pointerdown", onPointerDown);
  }

  /* -----------------------------
     Events
  ----------------------------- */
  function setupEvents() {
    // upload
    importBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []).filter(f => f.type.startsWith("image/"));
      if (!files.length) return;

      for (const f of files) await addImageFromFile(f);
      if (!state.currentImageId && state.images.length) selectImage(state.images[0].id);

      updateUIAll();
      redraw();
      markDirty();
      fileInput.value = "";
    });

    // search
    imageSearchEl?.addEventListener("input", (e) => {
      state.filter = (e.target.value || "").trim().toLowerCase();
      renderImageList();
    });

    // image select/delete
    imageListEl?.addEventListener("click", (e) => {
      const item = e.target.closest(".img-item");
      if (!item) return;
      const id = item.dataset.id;
      if (!id) return;

      if (e.target.closest(".img-item__close")) {
        e.stopPropagation();
        deleteImage(id);
        return;
      }
      selectImage(id);
    });

    // mode dropdown
    modeBtn?.addEventListener("click", () => {
      modeWrap?.classList.toggle("is-open");
      modeBtn?.setAttribute("aria-expanded", modeWrap?.classList.contains("is-open") ? "true" : "false");
    });

    window.addEventListener("click", (e) => {
      if (!modeWrap) return;
      if (modeWrap.contains(e.target)) return;
      modeWrap.classList.remove("is-open");
      modeBtn?.setAttribute("aria-expanded", "false");
    });

    modeMenu?.addEventListener("click", (e) => {
      const btn = e.target.closest(".mode__item");
      if (!btn) return;
      setMode(btn.dataset.mode);
      modeWrap?.classList.remove("is-open");
      modeBtn?.setAttribute("aria-expanded", "false");
    });

    // add label
    inlineAddBtn?.addEventListener("click", () => {
      const name = (newClassName.value || "").trim();
      const color = newClassColor.value || "#fb923c";
      if (!name) return;
      addLabel({ name, color });
      newClassName.value = "";
    });

    // label select/delete/clear
    classStripEl?.addEventListener("click", (e) => {
      const pill = e.target.closest(".class-pill");
      if (!pill) return;
      const id = pill.dataset.id;
      if (!id) return;

      if (e.target.closest(".class-pill__close")) {
        e.stopPropagation();
        deleteLabel(id);
        return;
      }

      if (state.activeLabelId === id) clearActiveLabel();
      else setActiveLabel(id);
    });

    // details toggle
    toggleDetailsBtn?.addEventListener("click", () => {
      document.body.classList.toggle("details-hidden");
      const hidden = document.body.classList.contains("details-hidden");
      toggleDetailsBtn.textContent = hidden ? "Show Details" : "Hide Details";
      toggleDetailsBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
      resizeCanvasToWrap();
      redraw();
    });

    // export
    exportBtn?.addEventListener("click", exportDatasetZip);

    // reset everything
    resetEverythingBtn?.addEventListener("click", () => {
      const ok = confirm(
        "Reset EVERYTHING?\n\nThis will remove:\n- All images\n- All annotations\n- All labels\n- All regions\n\nThis cannot be undone.\nProceed?"
      );
      if (!ok) return;
      resetEverything();
    });

    // undo/redo
    undoBtn?.addEventListener("click", undo);
    redoBtn?.addEventListener("click", redo);

    // shortcuts
    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      if (key === "escape") { clearActiveLabel(); return; }
      if (ctrl && key === "z" && !shift) { e.preventDefault(); undo(); return; }
      if ((ctrl && key === "y") || (ctrl && shift && key === "z")) { e.preventDefault(); redo(); return; }
      if ((key === "delete" || key === "backspace") && state.selectedAnnId) {
        e.preventDefault();
        deleteAnnotationById(state.selectedAnnId);
      }
    });

    // zoom UI
    zoomUI?.addEventListener("click", (e) => {
      const b = e.target.closest(".ga-zoomBtn");
      if (!b || !canvas) return;
      const z = b.dataset.zoom;
      if (z === "in") zoomAtCanvasPoint(canvas.width / 2, canvas.height / 2, ZOOM_STEP);
      if (z === "out") zoomAtCanvasPoint(canvas.width / 2, canvas.height / 2, 1 / ZOOM_STEP);
      if (z === "fit") { resizeCanvasToWrap(); fitToScreenContain(); }
      redraw();
    });

    // wheel zoom
    canvas?.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? ZOOM_STEP : (1 / ZOOM_STEP);
      const p = getCanvasMouse(e);
      zoomAtCanvasPoint(p.x, p.y, factor);
      redraw();
    }, { passive: false });

    // canvas interactions
    canvas?.addEventListener("mousedown", onCanvasDown);
    canvas?.addEventListener("mousemove", onCanvasMove);
    window.addEventListener("mouseup", onCanvasUp);

    // Regions: group + row actions + select row
    regionsListEl?.addEventListener("click", (e) => {
      const actionBtn = e.target.closest("button[data-action]");
      const row = e.target.closest(".region-row-ui");
      const summary = e.target.closest("summary");

      // prevent <details> toggle when clicking buttons in summary
      if (actionBtn && summary) {
        e.preventDefault();
        e.stopPropagation();
      }

      // prevent row select when clicking row buttons
      if (actionBtn && row) {
        e.preventDefault();
        e.stopPropagation();
      }

      if (actionBtn) {
        const action = actionBtn.dataset.action;
        const annId = row?.dataset?.id || null;
        const labelId = actionBtn.dataset.labelId || null;

        switch (action) {
          case "toggleLabelHidden":
            if (labelId) toggleLabelHidden(labelId);
            return;
          case "toggleLabelLocked":
            if (labelId) toggleLabelLocked(labelId);
            return;
          case "deleteLabelGroup":
            if (labelId) deleteLabelGroup(labelId);
            return;
          case "toggleHidden":
            if (annId) toggleAnnHidden(annId);
            return;
          case "toggleLocked":
            if (annId) toggleAnnLocked(annId);
            return;
          case "delete":
            if (annId) deleteAnnotationById(annId);
            return;
        }
      }

      // click row to select (old workflow)
      if (row?.dataset?.id) {
        state.selectedAnnId = row.dataset.id;
        updateUIAll();
        redraw();
      }
    });

    // window resize
    window.addEventListener("resize", () => {
      resizeCanvasToWrap();
      redraw();
    });
  }

  /* -----------------------------
     Boot
  ----------------------------- */
  function boot() {
    setupEvents();
    initResizers();
    resizeCanvasToWrap();

    restoreSessionOnBoot();

    setMode("bbox");
    updateUIAll();
    redraw();
  }

  boot();
});
