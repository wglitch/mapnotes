const STORAGE_KEY = "scoutmap.places.v1";

const templates = [
  { title: "Access", body: "" },
  { title: "Berg", body: "" },
  { title: "Risker", body: "" },
  { title: "Parkering", body: "" },
  { title: "Nästa steg", body: "" },
  { title: "Reselogistik", body: "" },
  { title: "Övrigt", body: "" }
];

const overviewPlaceholder = "Kort helhetsbild: vad är det här för plats, varför är den intressant och vad behöver kollas nästa gång?";
const blockPlaceholders = {
  "Access": "Väg in, stig, markägare, grindar, känsliga passager.",
  "Berg": "Kvalitet, typ av klippa, sprickor, block, behov av rensning.",
  "Risker": "Lös sten, landningar, fallzoner, vatten, privat mark eller naturvärden.",
  "Parkering": "Var går det att ställa bilen utan att störa?",
  "Nästa steg": "Vad behöver kollas nästa gång?",
  "Reselogistik": "Boende, mat, vatten, vägval och annat som hör till en längre scoutingresa.",
  "Övrigt": "Skriv fritt här om något inte passar i de andra blocken."
};

const defaultCenter = [59.3293, 18.0686];
const map = L.map("map", { zoomControl: false, closePopupOnClick: false }).setView(defaultCenter, 11);
L.control.zoom({ position: "bottomright" }).addTo(map);

const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 17,
  attribution: "Map data: &copy; OpenStreetMap, SRTM | Map style: &copy; OpenTopoMap"
});
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap"
});
topo.addTo(map);
L.control.layers({ "Höjdkurvor": topo, "Standardkarta": osm }, null, { position: "bottomright" }).addTo(map);

const state = {
  places: normalizePlaces(loadPlaces()),
  selectedId: null,
  markers: new Map(),
  moveModeId: null,
  suppressMapCreateUntil: 0
};

const elements = {
  saveStatus: document.querySelector("#saveStatus"),
  locate: document.querySelector("#locateButton"),
  newAtCenter: document.querySelector("#newAtCenterButton"),
  newAtMe: document.querySelector("#newAtMeButton"),
  exportButton: document.querySelector("#exportButton"),
  importInput: document.querySelector("#importInput")
};

window.addEventListener("error", (event) => showSaveStatus(`Fel: ${event.message}`));

persist(false);
renderMarkers();
showSaveStatus("Sparat lokalt");

map.on("click", (event) => {
  if (Date.now() < state.suppressMapCreateUntil) return;

  if (state.selectedId) {
    closeActivePopup();
    return;
  }

  createPlace(event.latlng.lat, event.latlng.lng);
});

map.on("popupopen", () => {
  document.body.classList.add("popup-is-open");
});

map.on("popupclose", () => {
  document.body.classList.remove("popup-is-open");
  state.selectedId = null;
  stopMoveMode();
  // Leaflet can close a popup and let the same pointer event continue to the map.
  // This guard makes the first outside click close only, never create a new point.
  state.suppressMapCreateUntil = Date.now() + 250;
});

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

elements.exportButton.addEventListener("click", exportPlaces);
elements.importInput.addEventListener("change", importPlacesFile);

function createPlace(lat, lng) {
  const now = new Date().toISOString();
  const place = normalizePlace({
    id: newId(),
    title: "Ny scoutingplats",
    lat,
    lng,
    priority: 3,
    images: [],
    blocks: [
      {
        id: newId(),
        title: "Översikt",
        body: "",
        expanded: false
      }
    ],
    createdAt: now,
    updatedAt: now
  });

  state.places.unshift(place);
  persist();
  renderMarkers();
  openPlace(place.id);
  map.setView([lat, lng], Math.max(map.getZoom(), 15));
}

function openPlace(id) {
  const place = state.places.find((item) => item.id === id);
  if (!place) return;

  state.selectedId = id;
  place.blocks.forEach((block) => {
    block.expanded = false;
  });

  const marker = state.markers.get(id);
  if (marker) marker.openPopup();
}

function closeActivePopup() {
  state.suppressMapCreateUntil = Date.now() + 250;
  map.closePopup();
}

function updatePlace(place, patch) {
  Object.assign(place, patch, { updatedAt: new Date().toISOString() });
  persist();
  refreshMarker(place.id);
}

function updateBlock(place, block, patch) {
  Object.assign(block, patch);
  place.updatedAt = new Date().toISOString();
  persist();
  refreshMarker(place.id);
}

function deletePlace(place) {
  state.places = state.places.filter((item) => item.id !== place.id);
  persist();
  state.selectedId = null;
  stopMoveMode();
  renderMarkers();
}

function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();

  state.places.forEach((place) => {
    const marker = L.marker([place.lat, place.lng], {
      draggable: state.moveModeId === place.id,
      autoPan: true
    }).addTo(map);

    marker.bindPopup(() => buildPopup(place), {
      maxWidth: 420,
      minWidth: 280,
      autoPan: true,
      autoPanPaddingTopLeft: [14, 14],
      autoPanPaddingBottomRight: [14, 14],
      offset: [0, 8]
    });

    marker.on("click", (event) => {
      L.DomEvent.stop(event);
      openPlace(place.id);
    });

    marker.on("dragend", () => {
      const { lat, lng } = marker.getLatLng();
      place.lat = lat;
      place.lng = lng;
      place.updatedAt = new Date().toISOString();
      persist();
      showSaveStatus(`Flyttad · Sparat ${timeStamp()}`);
      openPlace(place.id);
    });

    state.markers.set(place.id, marker);
  });
}

function refreshMarker(id) {
  const place = state.places.find((item) => item.id === id);
  const marker = state.markers.get(id);
  if (!place || !marker) return;

  marker.setLatLng([place.lat, place.lng]);
  if (marker.isPopupOpen()) {
    marker.setPopupContent(buildPopup(place));
  }
}

function buildPopup(place) {
  const template = document.querySelector("#popupTemplate");
  const node = template.content.firstElementChild.cloneNode(true);

  L.DomEvent.disableClickPropagation(node);
  L.DomEvent.disableScrollPropagation(node);

  const titleInput = node.querySelector(".popup-title");
  const stars = Array.from(node.querySelectorAll(".star"));
  const toolbar = node.querySelector(".block-toolbar");
  const blocksRoot = node.querySelector(".popup-blocks");
  const moveButton = node.querySelector(".move-button");
  const deleteButton = node.querySelector(".delete-button");

  titleInput.value = place.title || "";
  titleInput.addEventListener("input", () => updatePlace(place, { title: titleInput.value }));

  renderStars(stars, place.priority || 3);
  stars.forEach((button) => {
    button.addEventListener("click", () => {
      const priority = Number(button.dataset.priority);
      updatePlace(place, { priority });
      renderStars(stars, priority);
    });
  });

  templates.forEach((templateItem) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-chip";
    button.textContent = `+ ${templateItem.title}`;
    button.addEventListener("click", () => {
      place.blocks.push({
        id: newId(),
        title: templateItem.title,
        body: templateItem.body || "",
        expanded: true
      });
      place.updatedAt = new Date().toISOString();
      persist();
      markerReopen(place.id);
    });
    toolbar.append(button);
  });

  renderBlocks(place, blocksRoot);

  moveButton.textContent = state.moveModeId === place.id ? "Klar flytt" : "Flytta punkt";
  moveButton.classList.toggle("active", state.moveModeId === place.id);
  moveButton.addEventListener("click", () => {
    if (state.moveModeId === place.id) {
      stopMoveMode();
      moveButton.textContent = "Flytta punkt";
      moveButton.classList.remove("active");
    } else {
      startMoveMode(place.id);
      moveButton.textContent = "Klar flytt";
      moveButton.classList.add("active");
    }
  });

  deleteButton.addEventListener("click", () => {
    if (confirm("Ta bort punkten?")) deletePlace(place);
  });

  return node;
}

function renderBlocks(place, root) {
  root.innerHTML = "";

  place.blocks.forEach((block) => {
    const article = document.createElement("article");
    article.className = "block";

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "block-summary";
    summary.innerHTML = `<span aria-hidden="true">${block.expanded ? "▼" : "▶"}</span><span class="block-title"></span>`;
    summary.querySelector(".block-title").textContent = block.title || "Anteckning";
    summary.addEventListener("click", () => {
      block.expanded = !block.expanded;
      place.updatedAt = new Date().toISOString();
      persist();
      markerReopen(place.id);
    });

    const body = document.createElement("div");
    body.className = "block-body";
    body.hidden = !block.expanded;

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Rubrik";
    const titleInput = document.createElement("input");
    titleInput.value = block.title || "";
    titleInput.placeholder = "Rubrik";
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
    textarea.placeholder = block.title === "Översikt" ? overviewPlaceholder : (blockPlaceholders[block.title] || "Skriv anteckning här.");
    textarea.addEventListener("input", () => updateBlock(place, block, { body: textarea.value }));
    textLabel.append(textarea);

    const actions = document.createElement("div");
    actions.className = "block-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary danger-text";
    remove.textContent = "Ta bort block";
    remove.addEventListener("click", () => {
      place.blocks = place.blocks.filter((item) => item.id !== block.id);
      place.updatedAt = new Date().toISOString();
      persist();
      markerReopen(place.id);
    });
    actions.append(remove);

    body.append(titleLabel, textLabel, actions);
    article.append(summary, body);
    root.append(article);
  });
}

function markerReopen(id) {
  const marker = state.markers.get(id);
  const place = state.places.find((item) => item.id === id);
  if (!marker || !place) return;
  marker.setPopupContent(buildPopup(place));
}

function startMoveMode(id) {
  state.moveModeId = id;
  for (const [markerId, marker] of state.markers.entries()) {
    if (markerId === id) marker.dragging.enable();
    else marker.dragging.disable();
  }
  showSaveStatus("Flyttläge: dra punkten");
}

function stopMoveMode() {
  state.moveModeId = null;
  for (const marker of state.markers.values()) {
    if (marker.dragging) marker.dragging.disable();
  }
}

function renderStars(buttons, priority) {
  buttons.forEach((button) => {
    const value = Number(button.dataset.priority);
    button.textContent = value <= priority ? "★" : "☆";
    button.classList.toggle("selected", value <= priority);
  });
}

function exportPlaces() {
  const payload = {
    type: "scoutmap-export",
    version: 2,
    exportedAt: new Date().toISOString(),
    places: state.places.map(stripImages)
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `scoutmap-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showSaveStatus("Exporterad");
}

function importPlacesFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const importedPlaces = normalizePlaces(Array.isArray(parsed) ? parsed : parsed.places || []);
      const result = mergePlaces(importedPlaces);
      persist();
      renderMarkers();
      showSaveStatus(`Importerade ${result.added}, uppdaterade ${result.updated} · Sparat ${timeStamp()}`);
    } catch (error) {
      showSaveStatus(`Importfel: ${error.message}`);
    } finally {
      elements.importInput.value = "";
    }
  };
  reader.readAsText(file);
}

function mergePlaces(importedPlaces) {
  let added = 0;
  let updated = 0;
  const byId = new Map(state.places.map((place) => [place.id, place]));

  importedPlaces.forEach((incoming) => {
    const existing = byId.get(incoming.id);
    if (!existing) {
      state.places.push(incoming);
      byId.set(incoming.id, incoming);
      added += 1;
      return;
    }

    if (new Date(incoming.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      Object.assign(existing, incoming);
      updated += 1;
    }
  });

  state.places.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return { added, updated };
}

function normalizePlaces(rawPlaces) {
  return (Array.isArray(rawPlaces) ? rawPlaces : []).map(normalizePlace).filter(Boolean);
}

function normalizePlace(raw) {
  if (!raw || !Number.isFinite(Number(raw.lat)) || !Number.isFinite(Number(raw.lng))) return null;
  const now = new Date().toISOString();
  const blocks = Array.isArray(raw.blocks) && raw.blocks.length
    ? raw.blocks.map((block) => ({
        id: block.id || newId(),
        title: block.title || "Anteckning",
        body: block.body || "",
        expanded: false
      }))
    : [{ id: newId(), title: "Översikt", body: "", expanded: false }];

  return {
    id: raw.id || newId(),
    title: raw.title || "Ny scoutingplats",
    lat: Number(raw.lat),
    lng: Number(raw.lng),
    priority: clampPriority(raw.priority),
    images: [],
    blocks,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now
  };
}

function stripImages(place) {
  return {
    ...place,
    images: [],
    blocks: place.blocks.map((block) => ({ ...block, expanded: false }))
  };
}

function clampPriority(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 3;
  return Math.min(5, Math.max(1, Math.round(number)));
}

function persist(showStatus = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.places.map(stripImages)));
    if (showStatus) showSaveStatus(`Sparat ${timeStamp()}`);
  } catch (error) {
    showSaveStatus(`Sparfel: ${error.message}`);
  }
}

function loadPlaces() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
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

function showSaveStatus(text) {
  if (elements.saveStatus) elements.saveStatus.textContent = text;
}

function timeStamp() {
  return new Date().toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

function newId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
