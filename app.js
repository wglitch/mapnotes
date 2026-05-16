const STORAGE_KEY = "scoutmap.places.v1";
const QR_CHUNK_SIZE = 650;

const templates = [
  { title: "Potential", body: "Vad kan det här bli? Linjer, höjd, mängd klättring, känsla." },
  { title: "Access", body: "Väg in, stig, markägare, grindar, känsliga passager." },
  { title: "Berg", body: "Kvalitet, typ av klippa, sprickor, block, behov av rensning." },
  { title: "Risker", body: "Lös sten, landningar, fallzoner, vatten, privat mark eller naturvärden." },
  { title: "Parkering", body: "Var går det att ställa bilen utan att störa?" },
  { title: "Nästa steg", body: "Vad behöver kollas nästa gång?" },
  { title: "Reselogistik", body: "Boende, mat, vatten, vägval och annat som hör till en längre scoutingresa." }
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
  emptyState: document.querySelector("#emptyState"),
  form: document.querySelector("#placeForm"),
  title: document.querySelector("#titleInput"),
  lat: document.querySelector("#latInput"),
  lng: document.querySelector("#lngInput"),
  priority: document.querySelector("#priorityInput"),
  tags: document.querySelector("#tagsInput"),
  saveStatus: document.querySelector("#saveStatus"),
  gallery: document.querySelector("#gallery"),
  imageInput: document.querySelector("#imageInput"),
  blocks: document.querySelector("#blocks"),
  templateRow: document.querySelector("#templateRow"),
  addBlock: document.querySelector("#addBlockButton"),
  delete: document.querySelector("#deleteButton"),
  locate: document.querySelector("#locateButton"),
  newAtCenter: document.querySelector("#newAtCenterButton"),
  newAtMe: document.querySelector("#newAtMeButton"),
  showQr: document.querySelector("#showQrButton"),
  openImport: document.querySelector("#openImportButton"),
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
renderTemplates();
renderMarkers();
selectPlace(state.places[0]?.id ?? null);
showSaveStatus("Sparat lokalt");

elements.newAtCenter.addEventListener("click", () => {
  const center = map.getCenter();
  createPlace(center.lat, center.lng);
});

elements.newAtMe.addEventListener("click", () => {
  getCurrentPosition()
    .then(({ latitude, longitude }) => createPlace(latitude, longitude))
    .catch(() => {
      const center = map.getCenter();
      createPlace(center.lat, center.lng);
    });
});

elements.locate.addEventListener("click", () => {
  getCurrentPosition().then(({ latitude, longitude }) => {
    map.setView([latitude, longitude], 15);
  });
});

map.on("click", (event) => {
  createPlace(event.latlng.lat, event.latlng.lng);
});

elements.title.addEventListener("input", () => updateSelected({ title: elements.title.value }));
elements.lat.addEventListener("change", updateSelectedCoordinates);
elements.lng.addEventListener("change", updateSelectedCoordinates);
elements.priority.addEventListener("change", () => updateSelected({ priority: Number(elements.priority.value) }));
elements.tags.addEventListener("input", () => updateSelected({ tags: parseTags(elements.tags.value) }));
elements.addBlock.addEventListener("click", () => addBlock({ title: "Nytt block", body: "" }));
elements.delete.addEventListener("click", deleteSelected);
if (elements.imageInput) elements.imageInput.addEventListener("change", addImages);
elements.showQr.addEventListener("click", showQrExport);
elements.closeQr.addEventListener("click", () => elements.qrExportPanel.classList.add("hidden"));
elements.openImport.addEventListener("click", () => elements.qrImportPanel.classList.remove("hidden"));
elements.closeImport.addEventListener("click", () => {
  stopScanner();
  elements.qrImportPanel.classList.add("hidden");
});
elements.startScan.addEventListener("click", startScanner);
elements.stopScan.addEventListener("click", stopScanner);
elements.pasteImport.addEventListener("click", importPastedQrText);

function createPlace(lat, lng) {
  const place = normalizePlace({
    id: crypto.randomUUID(),
    title: "Ny scoutingplats",
    lat,
    lng,
    priority: 3,
    tags: [],
    images: [],
    blocks: templates.slice(0, 5).map((template) => ({
      id: crypto.randomUUID(),
      title: template.title,
      body: template.body,
      expanded: template.title === "Potential"
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  state.places.unshift(place);
  persist();
  renderMarkers();
  selectPlace(place.id);
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}

function selectPlace(id) {
  state.selectedId = id;
  const place = getSelected();

  elements.emptyState.classList.toggle("hidden", Boolean(place));
  elements.form.classList.toggle("hidden", !place);

  if (!place) return;

  elements.title.value = place.title;
  elements.lat.value = place.lat.toFixed(6);
  elements.lng.value = place.lng.toFixed(6);
  elements.priority.value = String(place.priority ?? 3);
  elements.tags.value = (place.tags || []).join(", ");
  renderGallery(place);
  renderBlocks(place);

  const marker = state.markers.get(place.id);
  if (marker) marker.openPopup();
}

function updateSelected(patch) {
  const place = getSelected();
  if (!place) return;
  Object.assign(place, patch, { updatedAt: new Date().toISOString() });
  persist();
  renderMarkers();
}

function updateSelectedCoordinates() {
  const lat = Number(elements.lat.value);
  const lng = Number(elements.lng.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  updateSelected({ lat, lng });
  map.setView([lat, lng], map.getZoom());
}

function deleteSelected() {
  const place = getSelected();
  if (!place) return;
  state.places = state.places.filter((item) => item.id !== place.id);
  persist();
  renderMarkers();
  selectPlace(state.places[0]?.id ?? null);
}

function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();

  state.places.forEach((place) => {
    const marker = L.marker([place.lat, place.lng], { draggable: true }).addTo(map);
    marker.bindPopup(buildPopup(place), { maxWidth: 330 });
    marker.on("click", () => selectPlace(place.id));
    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      place.lat = lat;
      place.lng = lng;
      place.updatedAt = new Date().toISOString();
      persist();
      selectPlace(place.id);
    });
    state.markers.set(place.id, marker);
  });
}

function buildPopup(place) {
  const template = document.querySelector("#popupTemplate");
  const node = template.content.firstElementChild.cloneNode(true);
  const image = node.querySelector(".popup-image");
  const title = node.querySelector("h3");
  const meta = node.querySelector(".popup-meta");
  const blocks = node.querySelector(".popup-blocks");
  const openButton = node.querySelector(".popup-open");

  title.textContent = place.title || "Namnlös plats";
  meta.innerHTML = "";
  const stars = document.createElement("div");
  stars.className = "stars";
  stars.textContent = renderStars(place.priority);
  meta.append(stars);
  if (place.tags?.length) {
    const tags = document.createElement("div");
    tags.className = "tag-row";
    place.tags.slice(0, 4).forEach((tag) => {
      const span = document.createElement("span");
      span.textContent = tag;
      tags.append(span);
    });
    meta.append(tags);
  }

  // Bilder är pausade i localStorage-versionen. Gamla bilder kan fortfarande visas om de redan finns sparade.
  if (place.images?.[0]) {
    image.src = place.images[0].dataUrl;
    image.alt = place.images[0].name || place.title;
  }

  blocks.innerHTML = "";
  place.blocks.slice(0, 5).forEach((block) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "popup-block-row";
    row.textContent = `${block.expanded ? "▼" : "▶"} ${block.title || "Anteckning"}`;
    row.addEventListener("click", () => {
      block.expanded = !block.expanded;
      persist();
      selectPlace(place.id);
      renderMarkers();
    });
    blocks.append(row);
  });
  openButton.addEventListener("click", () => selectPlace(place.id));
  return node;
}

function renderGallery(place) {
  elements.gallery.innerHTML = "";
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "Bildsparning är pausad tills bilder flyttas till IndexedDB eller molnlagring. Gamla bilder kan ligga kvar lokalt i denna webbläsare.";
  elements.gallery.append(note);

  if (!place.images?.length) return;

  place.images.forEach((image) => {
    const tile = document.createElement("div");
    tile.className = "image-tile";
    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name || "Scoutingbild";
    tile.append(img);
    elements.gallery.append(tile);
  });
}

function renderTemplates() {
  elements.templateRow.innerHTML = "";
  templates.forEach((template) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `+ ${template.title}`;
    button.addEventListener("click", () => addBlock(template));
    elements.templateRow.append(button);
  });
}

function renderBlocks(place) {
  elements.blocks.innerHTML = "";
  place.blocks.forEach((block) => {
    const article = document.createElement("article");
    article.className = "block";

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "block-summary";
    summary.innerHTML = `<span aria-hidden="true">${block.expanded ? "▼" : "▶"}</span><span class="block-title"></span><span aria-hidden="true">⋯</span>`;
    summary.querySelector(".block-title").textContent = block.title || "Anteckning";
    summary.addEventListener("click", () => {
      block.expanded = !block.expanded;
      place.updatedAt = new Date().toISOString();
      persist();
      renderBlocks(place);
      renderMarkers();
    });

    const body = document.createElement("div");
    body.className = "block-body";
    body.hidden = !block.expanded;

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Rubrik";
    const titleInput = document.createElement("input");
    titleInput.value = block.title;
    titleInput.addEventListener("input", () => {
      block.title = titleInput.value;
      place.updatedAt = new Date().toISOString();
      persist();
      summary.querySelector(".block-title").textContent = block.title || "Anteckning";
      renderMarkers();
    });
    titleLabel.append(titleInput);

    const textLabel = document.createElement("label");
    textLabel.textContent = "Text";
    const textarea = document.createElement("textarea");
    textarea.value = block.body;
    textarea.addEventListener("input", () => {
      block.body = textarea.value;
      place.updatedAt = new Date().toISOString();
      persist();
    });
    textLabel.append(textarea);

    const actions = document.createElement("div");
    actions.className = "block-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.textContent = "Ta bort";
    remove.addEventListener("click", () => {
      place.blocks = place.blocks.filter((item) => item.id !== block.id);
      place.updatedAt = new Date().toISOString();
      persist();
      renderBlocks(place);
      renderMarkers();
    });
    actions.append(remove);
    body.append(titleLabel, textLabel, actions);
    article.append(summary, body);
    elements.blocks.append(article);
  });
}

function addBlock(template) {
  const place = getSelected();
  if (!place) return;
  place.blocks.push({
    id: crypto.randomUUID(),
    title: template.title,
    body: template.body,
    expanded: true
  });
  place.updatedAt = new Date().toISOString();
  persist();
  renderBlocks(place);
  renderMarkers();
}

function addImages(event) {
  event.target.value = "";
  showSyncStatus("Bildsparning är pausad i den här versionen.");
}

async function showQrExport() {
  elements.qrExportPanel.classList.remove("hidden");
  elements.qrCodes.innerHTML = "";
  showSyncStatus("Skapar QR-export…");

  try {
    if (typeof QRCode === "undefined") throw new Error("QR-bibliotek saknas");
    const payload = makeExportPayload();
    const payloadText = JSON.stringify(payload);
    const checksum = await sha256(payloadText);
    const syncId = crypto.randomUUID();
    const chunks = chunkString(payloadText, QR_CHUNK_SIZE);

    chunks.forEach((chunk, index) => {
      const wrapper = document.createElement("article");
      wrapper.className = "qr-card";
      const heading = document.createElement("h4");
      heading.textContent = `Del ${index + 1} av ${chunks.length}`;
      const holder = document.createElement("div");
      holder.className = "qr-holder";
      const part = {
        type: "scoutmap-sync-part",
        version: 1,
        syncId,
        partIndex: index,
        totalParts: chunks.length,
        checksum,
        data: chunk
      };
      const text = JSON.stringify(part);
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Visa textfallback";
      const textarea = document.createElement("textarea");
      textarea.readOnly = true;
      textarea.value = text;
      details.append(summary, textarea);
      wrapper.append(heading, holder, details);
      elements.qrCodes.append(wrapper);
      new QRCode(holder, { text, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.L });
    });

    showSyncStatus(`QR-export klar: ${chunks.length} del${chunks.length === 1 ? "" : "ar"}.`);
  } catch (error) {
    showSyncStatus(`Kunde inte skapa QR-export: ${error.message}`);
  }
}

function makeExportPayload() {
  return {
    type: "scoutmap-sync",
    version: 1,
    exportedAt: new Date().toISOString(),
    places: state.places.map(stripPlaceForSync)
  };
}

function stripPlaceForSync(place) {
  return {
    id: place.id,
    title: place.title,
    lat: place.lat,
    lng: place.lng,
    priority: place.priority ?? 3,
    tags: place.tags || [],
    blocks: (place.blocks || []).map((block) => ({
      id: block.id,
      title: block.title,
      body: block.body,
      expanded: Boolean(block.expanded)
    })),
    createdAt: place.createdAt,
    updatedAt: place.updatedAt
  };
}

async function startScanner() {
  if (typeof Html5Qrcode === "undefined") {
    showSyncStatus("QR-scannerbibliotek saknas. Använd textfallbacken i stället.");
    return;
  }
  await stopScanner();
  showSyncStatus("Startar kamera…");
  state.scanner = new Html5Qrcode("qrReader");
  try {
    await state.scanner.start(
      { facingMode: "environment" },
      { fps: 8, qrbox: { width: 240, height: 240 } },
      (decodedText) => collectQrText(decodedText),
      () => {}
    );
    showSyncStatus("Kamera igång. Skanna en eller flera QR-delar.");
  } catch (error) {
    showSyncStatus(`Kunde inte starta kameran: ${error.message}`);
  }
}

async function stopScanner() {
  if (!state.scanner) return;
  try {
    await state.scanner.stop();
    await state.scanner.clear();
  } catch {}
  state.scanner = null;
}

function importPastedQrText() {
  const text = elements.qrPaste.value.trim();
  if (!text) return;
  const chunks = text
    .split(/\n(?=\s*\{)/g)
    .map((item) => item.trim())
    .filter(Boolean);
  chunks.forEach(collectQrText);
}

function collectQrText(text) {
  let part;
  try {
    part = JSON.parse(text);
  } catch {
    showSyncStatus("QR-texten gick inte att läsa som JSON.");
    return;
  }

  if (part.type === "scoutmap-sync") {
    mergePayload(part).then(showMergeResult).catch((error) => showSyncStatus(error.message));
    return;
  }

  if (part.type !== "scoutmap-sync-part") {
    showSyncStatus("Det här verkar inte vara en Scoutmap-QR.");
    return;
  }

  const key = part.syncId;
  if (!state.qrParts.has(key)) {
    state.qrParts.set(key, { totalParts: part.totalParts, checksum: part.checksum, parts: new Map() });
  }
  const bundle = state.qrParts.get(key);
  if (bundle.checksum !== part.checksum || bundle.totalParts !== part.totalParts) {
    showSyncStatus("QR-delarna verkar inte höra till samma export.");
    return;
  }
  bundle.parts.set(part.partIndex, part.data);
  showSyncStatus(`Skannat ${bundle.parts.size} av ${bundle.totalParts} delar.`);

  if (bundle.parts.size === bundle.totalParts) {
    finishMultipartImport(key).catch((error) => showSyncStatus(error.message));
  }
}

async function finishMultipartImport(syncId) {
  const bundle = state.qrParts.get(syncId);
  const joined = Array.from({ length: bundle.totalParts }, (_, index) => bundle.parts.get(index)).join("");
  const checksum = await sha256(joined);
  if (checksum !== bundle.checksum) throw new Error("Checksumma stämmer inte. Skanna om exporten.");
  const payload = JSON.parse(joined);
  const result = await mergePayload(payload);
  state.qrParts.delete(syncId);
  showMergeResult(result);
}

async function mergePayload(payload) {
  if (payload.type !== "scoutmap-sync" || !Array.isArray(payload.places)) {
    throw new Error("QR-paketet har fel format.");
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  const byId = new Map(state.places.map((place) => [place.id, place]));

  payload.places.map(normalizePlace).forEach((incoming) => {
    const existing = byId.get(incoming.id);
    if (!existing) {
      state.places.unshift(incoming);
      byId.set(incoming.id, incoming);
      added += 1;
      return;
    }
    if (new Date(incoming.updatedAt || 0) > new Date(existing.updatedAt || 0)) {
      Object.assign(existing, incoming);
      updated += 1;
    } else {
      skipped += 1;
    }
  });

  persist();
  renderMarkers();
  selectPlace(state.selectedId ?? state.places[0]?.id ?? null);
  return { added, updated, skipped };
}

function showMergeResult({ added, updated, skipped }) {
  showSyncStatus(`Importerade ${added} nya, uppdaterade ${updated}, hoppade över ${skipped} · ${savedTimeText()}`);
}

function normalizePlaces(places) {
  return Array.isArray(places) ? places.map(normalizePlace).filter((place) => place.id) : [];
}

function normalizePlace(place) {
  const now = new Date().toISOString();
  return {
    id: place.id || crypto.randomUUID(),
    title: place.title || "Namnlös plats",
    lat: Number(place.lat),
    lng: Number(place.lng),
    priority: clampPriority(place.priority),
    tags: Array.isArray(place.tags) ? place.tags.filter(Boolean) : [],
    images: Array.isArray(place.images) ? place.images : [],
    blocks: Array.isArray(place.blocks) ? place.blocks.map(normalizeBlock) : [],
    createdAt: place.createdAt || now,
    updatedAt: place.updatedAt || now
  };
}

function normalizeBlock(block) {
  return {
    id: block.id || crypto.randomUUID(),
    title: block.title || "Anteckning",
    body: block.body || "",
    expanded: Boolean(block.expanded)
  };
}

function clampPriority(priority) {
  const value = Number(priority);
  if (!Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function parseTags(value) {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
}

function renderStars(priority = 3) {
  const value = clampPriority(priority);
  return "★".repeat(value) + "☆".repeat(5 - value);
}

function chunkString(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function getSelected() {
  return state.places.find((place) => place.id === state.selectedId);
}

function persist(updateStatus = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.places));
    if (updateStatus) showSaveStatus(savedTimeText());
  } catch (error) {
    showSaveStatus(`Kunde inte spara: ${error.message}`);
  }
}

function savedTimeText() {
  return `Sparat ${new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
}

function showSaveStatus(text) {
  if (elements.saveStatus) elements.saveStatus.textContent = text;
}

function showSyncStatus(text) {
  if (elements.syncStatus) elements.syncStatus.textContent = text;
}

function loadPlaces() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
