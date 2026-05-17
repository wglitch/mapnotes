const STORAGE_KEY = "scoutmap.places.v1";

window.addEventListener("error", (event) => {
  const target = document.querySelector("#saveStatus");
  if (target) target.textContent = `JS-fel: ${event.message}`;
  console.error(event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  const target = document.querySelector("#saveStatus");
  if (target) target.textContent = `JS-fel: ${event.reason?.message || event.reason}`;
  console.error(event.reason);
});

const overviewTemplate = {
  title: "Översikt",
  body: "Kort helhetsbild: potential, access, bergkvalitet och vad som bör kollas nästa gång."
};

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
  markers: new Map()
};

const elements = {
  locate: document.querySelector("#locateButton"),
  newAtCenter: document.querySelector("#newAtCenterButton"),
  newAtMe: document.querySelector("#newAtMeButton"),
  exportButton: document.querySelector("#exportButton"),
  openImport: document.querySelector("#openImportButton"),
  importPanel: document.querySelector("#importPanel"),
  closeImport: document.querySelector("#closeImportButton"),
  importFile: document.querySelector("#importFileInput"),
  importPaste: document.querySelector("#importPasteInput"),
  pasteImport: document.querySelector("#pasteImportButton"),
  saveStatus: document.querySelector("#saveStatus"),
  syncStatus: document.querySelector("#syncStatus")
};

persist(false);
renderMarkers();
showSaveStatus("Sparat lokalt");

if (elements.newAtCenter) elements.newAtCenter.addEventListener("click", () => {
  const center = map.getCenter();
  safeCreatePlace(center.lat, center.lng);
});

if (elements.newAtMe) elements.newAtMe.addEventListener("click", () => {
  getCurrentPosition()
    .then(({ latitude, longitude }) => safeCreatePlace(latitude, longitude))
    .catch(() => {
      const center = map.getCenter();
      safeCreatePlace(center.lat, center.lng);
    });
});

if (elements.locate) elements.locate.addEventListener("click", () => {
  getCurrentPosition().then(({ latitude, longitude }) => {
    map.setView([latitude, longitude], 15);
  });
});

if (elements.exportButton) elements.exportButton.addEventListener("click", exportTextFile);
if (elements.openImport) elements.openImport.addEventListener("click", () => elements.importPanel?.classList.remove("hidden"));
if (elements.closeImport) elements.closeImport.addEventListener("click", () => elements.importPanel?.classList.add("hidden"));
if (elements.importFile) elements.importFile.addEventListener("change", importFile);
if (elements.pasteImport) elements.pasteImport.addEventListener("click", importPastedText);

map.on("click", (event) => safeCreatePlace(event.latlng.lat, event.latlng.lng));

function safeCreatePlace(lat, lng) {
  try {
    createPlace(lat, lng);
  } catch (error) {
    console.error("Kunde inte skapa plats", error);
    showSaveStatus(`Kunde inte skapa plats: ${error?.message || error}`);
  }
}

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
    blocks: [{
      id: newId(),
      title: overviewTemplate.title,
      body: overviewTemplate.body,
      expanded: true
    }],
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
    marker.bindPopup(buildPopup(place), {
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
  header.className = "pin-editor-header single";

  const titleInput = document.createElement("input");
  titleInput.className = "popup-title-input";
  titleInput.value = place.title || "";
  titleInput.placeholder = "Namn på platsen";
  titleInput.addEventListener("input", () => {
    place.title = titleInput.value;
    place.updatedAt = new Date().toISOString();
    persist();
  });
  header.append(titleInput);

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

  const blocks = document.createElement("div");
  blocks.className = "popup-blocks-editor";
  place.blocks.forEach((block) => blocks.append(buildBlockEditor(place, block)));

  const footer = document.createElement("footer");
  footer.className = "popup-footer";
  const saved = document.createElement("span");
  saved.textContent = `Sparat lokalt · ${formatTime(place.updatedAt)}`;
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-place-button danger";
  deleteButton.textContent = "Ta bort punkt";
  deleteButton.title = "Tar bort hela kartpunkten";
  deleteButton.addEventListener("click", () => {
    const ok = window.confirm("Ta bort hela punkten? Det här går inte att ångra.");
    if (!ok) return;
    state.places = state.places.filter((item) => item.id !== place.id);
    state.selectedId = null;
    persist();
    renderMarkers();
  });
  footer.append(saved, deleteButton);

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

function makeExportPayload() {
  return {
    type: "scoutmap-text-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    places: getTextOnlyPlaces()
  };
}

function exportTextFile() {
  const payload = makeExportPayload();
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `scoutmap-${date}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showSaveStatus(`Exporterade ${payload.places.length} platser`);
}

async function importFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    importText(text);
    event.target.value = "";
  } catch (error) {
    showSyncStatus(`Kunde inte läsa filen: ${error?.message || error}`);
  }
}

function importPastedText() {
  const text = elements.importPaste?.value || "";
  importText(text);
}

function importText(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    showSyncStatus("Importtexten är inte giltig JSON.");
    return;
  }

  if (!payload || !Array.isArray(payload.places)) {
    showSyncStatus("Filen verkar inte vara en Scoutmap-export.");
    return;
  }

  const result = mergePlaces(payload.places);
  persist();
  renderMarkers();
  showSyncStatus(`Importerade ${result.added} nya, uppdaterade ${result.updated}, hoppade över ${result.skipped} · Sparat ${formatTime(new Date().toISOString())}`);
  showSaveStatus(`Sparat ${formatTime(new Date().toISOString())}`);
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
  const blocks = Array.isArray(safe.blocks) && safe.blocks.length
    ? safe.blocks.map((block) => ({
        id: block.id || newId(),
        title: block.title || "Anteckning",
        body: block.body || "",
        expanded: Boolean(block.expanded)
      }))
    : [{
        id: newId(),
        title: overviewTemplate.title,
        body: overviewTemplate.body,
        expanded: true
      }];

  return {
    id: safe.id || newId(),
    title: safe.title || "Namnlös plats",
    lat: Number.isFinite(Number(safe.lat)) ? Number(safe.lat) : defaultCenter[0],
    lng: Number.isFinite(Number(safe.lng)) ? Number(safe.lng) : defaultCenter[1],
    priority: clamp(Number(safe.priority) || 3, 1, 5),
    tags: Array.isArray(safe.tags) ? safe.tags.map(String).filter(Boolean) : parseTags(safe.tags || ""),
    images: [],
    blocks,
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
