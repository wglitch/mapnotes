const STORAGE_KEY = "scoutmap.places.v1";
const QR_CHUNK_SIZE = 450;

const templates = [
  { title: "Potential", body: "Vad kan det här bli? Linjer, höjd, mängd klättring, känsla." },
  { title: "Access", body: "Väg in, stig, markägare, grindar, känsliga passager." },
  { title: "Berg", body: "Kvalitet, typ av klippa, sprickor, block, behov av rensning." },
  { title: "Risker", body: "Lös sten, landningar, fallzoner, vatten, privat mark eller naturvärden." },
  { title: "Parkering", body: "Var går det att ställa bilen utan att störa?" },
  { title: "Nästa steg", body: "Vad behöver kollas nästa gång?" }
];

const defaultCenter = [59.3293, 18.0686];
const map = L.map("map", { zoomControl: false }).setView(defaultCenter, 11);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
}).addTo(map);

const state = {
  places: normalizePlaces(loadPlaces()),
  selectedId: null,
  markers: new Map(),
  qrParts: new Map(),
  scanner: null
};

const elements = {
  locate: document.querySelector("#locateButton"),
  newAtCenter: document.querySelector("#newAtCenterButton"),
  newAtMe: document.querySelector("#newAtMeButton"),
  showQr: document.querySelector("#showQrButton"),
  openImport: document.querySelector("#openImportButton"),
  saveStatus: document.querySelector("#saveStatus"),
  syncStatus: document.querySelector("#syncStatus"),
  qrExportPanel: document.querySelector("#qrExportPanel"),
  closeQr: document.querySelector("#closeQrButton"),
  qrCodes: document.querySelector("#qrCodes"),
  qrImportPanel: document.querySelector("#qrImportPanel"),
  closeImport: document.querySelector("#closeImportButton"),
  startScan: document.querySelector("#startScanButton"),
  stopScan: document.querySelector("#stopScanButton"),
  qrPaste: document.querySelector("#qrPasteInput"),
  pasteImport: document.querySelector("#pasteImportButton")
};

persist(false);
renderMarkers();
showSaveStatus("Sparat lokalt");

if (elements.newAtCenter) elements.newAtCenter.addEventListener("click", () => {
  const center = map.getCenter();
  createPlace(center.lat, center.lng);
});

if (elements.newAtMe) elements.newAtMe.addEventListener("click", () => {
  getCurrentPosition()
    .then(({ latitude, longitude }) => createPlace(latitude, longitude))
    .catch(() => {
      const center = map.getCenter();
      createPlace(center.lat, center.lng);
    });
});

if (elements.locate) elements.locate.addEventListener("click", () => {
  getCurrentPosition().then(({ latitude, longitude }) => {
    map.setView([latitude, longitude], 15);
  });
});

if (elements.showQr) elements.showQr.addEventListener("click", showQrExport);
if (elements.openImport) elements.openImport.addEventListener("click", () => elements.qrImportPanel?.classList.remove("hidden"));
if (elements.closeQr) elements.closeQr.addEventListener("click", () => elements.qrExportPanel?.classList.add("hidden"));
if (elements.closeImport) elements.closeImport.addEventListener("click", () => {
  stopScanner();
  elements.qrImportPanel?.classList.add("hidden");
});
if (elements.startScan) elements.startScan.addEventListener("click", startScanner);
if (elements.stopScan) elements.stopScan.addEventListener("click", stopScanner);
if (elements.pasteImport) elements.pasteImport.addEventListener("click", importPastedQrText);

map.on("click", (event) => createPlace(event.latlng.lat, event.latlng.lng));

function createPlace(lat, lng) {
  const now = new Date().toISOString();
  const place = normalizePlace({
    id: newId(),
    title: "Ny scoutingplats",
    lat,
    lng,
    priority: 3,
    tags: [],
    images: [],
    blocks: templates.map((template, index) => ({
      id: newId(),
      title: template.title,
      body: template.body,
      expanded: index === 0
    })),
    createdAt: now,
    updatedAt: now
  });

  state.places.unshift(place);
  persist();
  renderMarkers();
  selectPlace(place.id);
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}

function selectPlace(id) {
  state.selectedId = id;
  const marker = state.markers.get(id);
  if (!marker) return;
  try {
    marker.openPopup();
  } catch (error) {
    console.error("Kunde inte öppna popup", error);
  }
}

function getSelected() {
  return state.places.find((place) => place.id === state.selectedId);
}

function updatePlace(place, patch = {}) {
  Object.assign(place, patch, { updatedAt: new Date().toISOString() });
  persist();
  renderMarkers();
  selectPlace(place.id);
}

function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();

  state.places.forEach((place) => {
    const marker = L.marker([place.lat, place.lng], { draggable: true }).addTo(map);
    marker.bindPopup(() => buildPopup(place), {
      maxWidth: 430,
      minWidth: 300,
      autoPan: true,
      keepInView: true
    });
    marker.on("click", () => { state.selectedId = place.id; });
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      place.lat = lat;
      place.lng = lng;
      place.updatedAt = new Date().toISOString();
      persist();
      renderMarkers();
      selectPlace(place.id);
    });
    state.markers.set(place.id, marker);
  });
}

function buildPopup(place) {
  const node = document.createElement("article");
  node.className = "pin-editor";

  const header = document.createElement("header");
  header.className = "pin-editor-header";

  const titleInput = document.createElement("input");
  titleInput.className = "popup-title-input";
  titleInput.value = place.title || "";
  titleInput.placeholder = "Namn på platsen";
  titleInput.addEventListener("input", () => {
    place.title = titleInput.value;
    place.updatedAt = new Date().toISOString();
    persist();
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "icon-button danger";
  deleteButton.textContent = "×";
  deleteButton.title = "Ta bort plats";
  deleteButton.addEventListener("click", () => {
    state.places = state.places.filter((item) => item.id !== place.id);
    persist();
    renderMarkers();
  });
  header.append(titleInput, deleteButton);

  const meta = document.createElement("div");
  meta.className = "popup-meta-grid";

  const priorityLabel = document.createElement("label");
  priorityLabel.textContent = "Prioritet";
  const priority = document.createElement("select");
  for (let i = 1; i <= 5; i += 1) {
    const option = document.createElement("option");
    option.value = String(i);
    option.textContent = `${renderStars(i)} ${i}`;
    priority.append(option);
  }
  priority.value = String(place.priority || 3);
  priority.addEventListener("change", () => updatePlace(place, { priority: Number(priority.value) }));
  priorityLabel.append(priority);

  const tagsLabel = document.createElement("label");
  tagsLabel.textContent = "Etiketter";
  const tags = document.createElement("input");
  tags.value = (place.tags || []).join(", ");
  tags.placeholder = "access, rensning";
  tags.addEventListener("input", () => {
    place.tags = parseTags(tags.value);
    place.updatedAt = new Date().toISOString();
    persist();
  });
  tagsLabel.append(tags);
  meta.append(priorityLabel, tagsLabel);

  const position = document.createElement("details");
  position.className = "position-details";
  position.innerHTML = "<summary>Position</summary>";
  const posGrid = document.createElement("div");
  posGrid.className = "popup-meta-grid";
  const latLabel = document.createElement("label");
  latLabel.textContent = "Latitud";
  const latInput = document.createElement("input");
  latInput.type = "number";
  latInput.step = "0.000001";
  latInput.value = Number(place.lat).toFixed(6);
  latLabel.append(latInput);
  const lngLabel = document.createElement("label");
  lngLabel.textContent = "Longitud";
  const lngInput = document.createElement("input");
  lngInput.type = "number";
  lngInput.step = "0.000001";
  lngInput.value = Number(place.lng).toFixed(6);
  lngLabel.append(lngInput);
  const updateCoordinates = () => {
    const lat = Number(latInput.value);
    const lng = Number(lngInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    place.lat = lat;
    place.lng = lng;
    place.updatedAt = new Date().toISOString();
    persist();
    renderMarkers();
    selectPlace(place.id);
    map.setView([lat, lng], map.getZoom());
  };
  latInput.addEventListener("change", updateCoordinates);
  lngInput.addEventListener("change", updateCoordinates);
  posGrid.append(latLabel, lngLabel);
  position.append(posGrid);

  const blocks = document.createElement("div");
  blocks.className = "popup-blocks-editor";
  place.blocks.forEach((block) => blocks.append(buildBlockEditor(place, block)));

  const templateRow = document.createElement("div");
  templateRow.className = "template-row popup-template-row";
  templates.forEach((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `+ ${template.title}`;
    button.addEventListener("click", () => {
      place.blocks.push({
        id: newId(),
        title: template.title,
        body: template.body,
        expanded: true
      });
      place.updatedAt = new Date().toISOString();
      persist();
      renderMarkers();
      selectPlace(place.id);
    });
    templateRow.append(button);
  });

  const footer = document.createElement("footer");
  footer.className = "popup-footer";
  footer.textContent = `Sparat lokalt · ${formatTime(place.updatedAt)}`;

  node.append(header, meta, position, templateRow, blocks, footer);
  return node;
}

function buildBlockEditor(place, block) {
  const article = document.createElement("article");
  article.className = "block popup-block";

  const summary = document.createElement("button");
  summary.type = "button";
  summary.className = "block-summary compact";
  summary.innerHTML = `<span aria-hidden="true">${block.expanded ? "▼" : "▶"}</span><span class="block-title"></span>`;
  summary.querySelector(".block-title").textContent = block.title || "Anteckning";
  summary.addEventListener("click", () => {
    block.expanded = !block.expanded;
    place.updatedAt = new Date().toISOString();
    persist();
    renderMarkers();
    selectPlace(place.id);
  });

  const body = document.createElement("div");
  body.className = "block-body";
  body.hidden = !block.expanded;

  const titleLabel = document.createElement("label");
  titleLabel.textContent = "Rubrik";
  const titleInput = document.createElement("input");
  titleInput.value = block.title || "";
  titleInput.addEventListener("input", () => {
    block.title = titleInput.value;
    place.updatedAt = new Date().toISOString();
    persist();
    summary.querySelector(".block-title").textContent = block.title || "Anteckning";
  });
  titleLabel.append(titleInput);

  const textLabel = document.createElement("label");
  textLabel.textContent = "Text";
  const textarea = document.createElement("textarea");
  textarea.value = block.body || "";
  textarea.addEventListener("input", () => {
    block.body = textarea.value;
    place.updatedAt = new Date().toISOString();
    persist();
  });
  textLabel.append(textarea);

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger secondary";
  remove.textContent = "Ta bort block";
  remove.addEventListener("click", () => {
    place.blocks = place.blocks.filter((item) => item.id !== block.id);
    place.updatedAt = new Date().toISOString();
    persist();
    renderMarkers();
    selectPlace(place.id);
  });

  body.append(titleLabel, textLabel, remove);
  article.append(summary, body);
  return article;
}

function getTextOnlyPlaces() {
  return state.places.map((place) => ({
    id: place.id,
    title: place.title,
    lat: place.lat,
    lng: place.lng,
    priority: place.priority,
    tags: place.tags || [],
    blocks: (place.blocks || []).map((block) => ({
      id: block.id,
      title: block.title,
      body: block.body,
      expanded: Boolean(block.expanded)
    })),
    createdAt: place.createdAt,
    updatedAt: place.updatedAt
  }));
}

function showQrExport() {
  if (!elements.qrExportPanel || !elements.qrCodes) return;
  elements.qrExportPanel.classList.remove("hidden");
  elements.qrCodes.innerHTML = "";

  const payload = {
    type: "scoutmap-sync-payload",
    version: 1,
    exportedAt: new Date().toISOString(),
    places: getTextOnlyPlaces()
  };
  const encoded = encodePayload(payload);
  const checksum = String(hashString(encoded));
  const syncId = newId();
  const chunks = chunkString(encoded, QR_CHUNK_SIZE);

  chunks.forEach((chunk, index) => {
    const qrText = JSON.stringify({
      type: "scoutmap-sync-part",
      version: 1,
      syncId,
      partIndex: index,
      totalParts: chunks.length,
      checksum,
      data: chunk
    });

    const card = document.createElement("article");
    card.className = "qr-card";
    const heading = document.createElement("h4");
    heading.textContent = `Del ${index + 1} av ${chunks.length}`;
    const qrBox = document.createElement("div");
    qrBox.className = "qr-box";
    const text = document.createElement("textarea");
    text.readOnly = true;
    text.value = qrText;
    text.addEventListener("focus", () => text.select());
    card.append(heading, qrBox, text);
    elements.qrCodes.append(card);

    if (window.QRCode) {
      new QRCode(qrBox, {
        text: qrText,
        width: 220,
        height: 220,
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      qrBox.textContent = "QR-biblioteket laddades inte. Kopiera texten nedan i stället.";
    }
  });
  showSyncStatus(`Skapade ${chunks.length} QR-del${chunks.length === 1 ? "" : "ar"}.`);
}

function importPastedQrText() {
  const raw = elements.qrPaste?.value || "";
  const parts = raw
    .split(/\n\s*\n|\n(?=\{)/g)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!parts.length) {
    showSyncStatus("Klistra in minst en QR-text först.");
    return;
  }

  parts.forEach(handleScannedText);
}

async function startScanner() {
  const readerId = "qrReader";
  if (!document.querySelector(`#${readerId}`)) return;
  if (!window.Html5Qrcode) {
    showSyncStatus("QR-kamerabiblioteket laddades inte. Använd klistra in-fältet.");
    return;
  }
  if (state.scanner) return;

  try {
    state.scanner = new Html5Qrcode(readerId);
    await state.scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 240, height: 240 } },
      (decodedText) => handleScannedText(decodedText),
      () => {}
    );
    showSyncStatus("Kameran är igång. Skanna QR-delarna i valfri ordning.");
  } catch (error) {
    state.scanner = null;
    showSyncStatus(`Kunde inte starta kameran: ${error?.message || error}`);
  }
}

async function stopScanner() {
  if (!state.scanner) return;
  try {
    await state.scanner.stop();
    await state.scanner.clear();
  } catch {}
  state.scanner = null;
  showSyncStatus("Kameran stoppad.");
}

function handleScannedText(text) {
  let part;
  try {
    part = JSON.parse(text);
  } catch {
    showSyncStatus("QR-texten var inte giltig JSON.");
    return;
  }

  if (part.type !== "scoutmap-sync-part") {
    showSyncStatus("Det här verkar inte vara en Scoutmap-QR.");
    return;
  }

  if (!state.qrParts.has(part.syncId)) state.qrParts.set(part.syncId, new Map());
  const syncParts = state.qrParts.get(part.syncId);
  syncParts.set(Number(part.partIndex), part);

  const scanned = syncParts.size;
  showSyncStatus(`Skannat ${scanned} av ${part.totalParts} delar.`);

  if (scanned >= Number(part.totalParts)) {
    completeImport(part.syncId);
  }
}

function completeImport(syncId) {
  const parts = state.qrParts.get(syncId);
  if (!parts) return;
  const ordered = [...parts.values()].sort((a, b) => Number(a.partIndex) - Number(b.partIndex));
  const totalParts = Number(ordered[0].totalParts);
  if (ordered.length !== totalParts) return;

  for (let i = 0; i < totalParts; i += 1) {
    if (Number(ordered[i].partIndex) !== i) {
      showSyncStatus("QR-delarna kunde inte sättas ihop. Någon del saknas eller är trasig.");
      return;
    }
  }

  const encoded = ordered.map((part) => part.data).join("");
  const checksum = String(hashString(encoded));
  if (checksum !== String(ordered[0].checksum)) {
    showSyncStatus("Checksum stämmer inte. Importen avbröts.");
    return;
  }

  let payload;
  try {
    payload = decodePayload(encoded);
  } catch {
    showSyncStatus("Kunde inte läsa QR-paketet efter hopsättning.");
    return;
  }

  if (payload.type !== "scoutmap-sync-payload" || !Array.isArray(payload.places)) {
    showSyncStatus("QR-paketet har fel format.");
    return;
  }

  const result = mergePlaces(payload.places);
  persist();
  renderMarkers();
  state.qrParts.delete(syncId);
  showSyncStatus(`Importerade ${result.added} nya, uppdaterade ${result.updated}, hoppade över ${result.skipped} · Sparat ${formatTime(new Date().toISOString())}`);
}

function mergePlaces(importedPlaces) {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const localById = new Map(state.places.map((place) => [place.id, place]));

  importedPlaces.map(normalizePlace).forEach((incoming) => {
    const existing = localById.get(incoming.id);
    if (!existing) {
      state.places.unshift(incoming);
      localById.set(incoming.id, incoming);
      added += 1;
      return;
    }
    const existingTime = Date.parse(existing.updatedAt || existing.createdAt || "") || 0;
    const incomingTime = Date.parse(incoming.updatedAt || incoming.createdAt || "") || 0;
    if (incomingTime > existingTime) {
      Object.assign(existing, incoming);
      updated += 1;
    } else {
      skipped += 1;
    }
  });
  return { added, updated, skipped };
}

function normalizePlaces(places) {
  return Array.isArray(places) ? places.map(normalizePlace).filter(Boolean) : [];
}

function normalizePlace(place) {
  const now = new Date().toISOString();
  const safe = place || {};
  return {
    id: safe.id || newId(),
    title: safe.title || "Namnlös plats",
    lat: Number.isFinite(Number(safe.lat)) ? Number(safe.lat) : defaultCenter[0],
    lng: Number.isFinite(Number(safe.lng)) ? Number(safe.lng) : defaultCenter[1],
    priority: clamp(Number(safe.priority) || 3, 1, 5),
    tags: Array.isArray(safe.tags) ? safe.tags.map(String).filter(Boolean) : parseTags(safe.tags || ""),
    images: [],
    blocks: Array.isArray(safe.blocks) ? safe.blocks.map((block) => ({
      id: block.id || newId(),
      title: block.title || "Anteckning",
      body: block.body || "",
      expanded: Boolean(block.expanded)
    })) : [],
    createdAt: safe.createdAt || now,
    updatedAt: safe.updatedAt || safe.createdAt || now
  };
}

function persist(showStatus = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.places));
    if (showStatus) showSaveStatus(`Sparat ${formatTime(new Date().toISOString())}`);
  } catch (error) {
    showSaveStatus("Kunde inte spara lokalt. LocalStorage kan vara fullt.");
  }
}

function loadPlaces() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function showSaveStatus(message) {
  if (elements.saveStatus) elements.saveStatus.textContent = message;
}

function showSyncStatus(message) {
  if (elements.syncStatus) elements.syncStatus.textContent = message;
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function renderStars(value) {
  const n = clamp(Number(value) || 0, 1, 5);
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "nu";
  return date.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function chunkString(value, size) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks.length ? chunks : [""];
}

function encodePayload(payload) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

function decodePayload(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function newId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation saknas"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      reject,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });
}
