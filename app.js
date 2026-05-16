const STORAGE_KEY = "scoutmap.places.v1";

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
  places: loadPlaces(),
  selectedId: null,
  markers: new Map()
};

const elements = {
  emptyState: document.querySelector("#emptyState"),
  form: document.querySelector("#placeForm"),
  title: document.querySelector("#titleInput"),
  lat: document.querySelector("#latInput"),
  lng: document.querySelector("#lngInput"),
  gallery: document.querySelector("#gallery"),
  imageInput: document.querySelector("#imageInput"),
  blocks: document.querySelector("#blocks"),
  templateRow: document.querySelector("#templateRow"),
  addBlock: document.querySelector("#addBlockButton"),
  delete: document.querySelector("#deleteButton"),
  locate: document.querySelector("#locateButton"),
  newAtCenter: document.querySelector("#newAtCenterButton"),
  newAtMe: document.querySelector("#newAtMeButton")
};

renderTemplates();
renderMarkers();
selectPlace(state.places[0]?.id ?? null);

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
elements.addBlock.addEventListener("click", () => addBlock({ title: "Nytt block", body: "" }));
elements.delete.addEventListener("click", deleteSelected);
elements.imageInput.addEventListener("change", addImages);

function createPlace(lat, lng) {
  const place = {
    id: crypto.randomUUID(),
    title: "Ny scoutingplats",
    lat,
    lng,
    images: [],
    blocks: templates.slice(0, 5).map((template) => ({
      id: crypto.randomUUID(),
      title: template.title,
      body: template.body,
      expanded: template.title === "Potential"
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

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

  if (!place) {
    return;
  }

  elements.title.value = place.title;
  elements.lat.value = place.lat.toFixed(6);
  elements.lng.value = place.lng.toFixed(6);
  renderGallery(place);
  renderBlocks(place);

  const marker = state.markers.get(place.id);
  if (marker) {
    marker.openPopup();
  }
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
  for (const marker of state.markers.values()) {
    marker.remove();
  }
  state.markers.clear();

  state.places.forEach((place) => {
    const marker = L.marker([place.lat, place.lng], { draggable: true }).addTo(map);
    marker.bindPopup(buildPopup(place));
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
  const blocks = node.querySelector(".popup-blocks");
  const openButton = node.querySelector(".popup-open");

  title.textContent = place.title || "Namnlös plats";
  if (place.images[0]) {
    image.src = place.images[0].dataUrl;
    image.alt = place.images[0].name || place.title;
  }
  blocks.innerHTML = "";
  place.blocks.slice(0, 5).forEach((block) => {
    const row = document.createElement("div");
    row.textContent = `${block.expanded ? "▼" : "▶"} ${block.title || "Anteckning"}`;
    blocks.append(row);
  });
  openButton.addEventListener("click", () => selectPlace(place.id));
  return node;
}

function renderGallery(place) {
  elements.gallery.innerHTML = "";
  if (!place.images.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Inga bilder ännu.";
    elements.gallery.append(empty);
    return;
  }

  place.images.forEach((image) => {
    const tile = document.createElement("div");
    tile.className = "image-tile";
    const img = document.createElement("img");
    img.src = image.dataUrl;
    img.alt = image.name || "Scoutingbild";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.ariaLabel = "Ta bort bild";
    remove.addEventListener("click", () => {
      place.images = place.images.filter((item) => item.id !== image.id);
      place.updatedAt = new Date().toISOString();
      persist();
      renderGallery(place);
      renderMarkers();
    });
    tile.append(img, remove);
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

async function addImages(event) {
  const place = getSelected();
  if (!place) return;

  const files = Array.from(event.target.files || []);
  const images = await Promise.all(files.map(readImage));
  place.images.push(...images);
  place.updatedAt = new Date().toISOString();
  persist();
  renderGallery(place);
  renderMarkers();
  elements.imageInput.value = "";
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: reader.result
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.places));
}

function loadPlaces() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
