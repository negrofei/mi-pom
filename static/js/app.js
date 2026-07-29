(function () {
  const STORAGE_KEY = "synop-ar-config-v1";
  const BASE_W = 120;
  const BASE_H = 160;
  const REFRESH_MS = 2 * 60 * 1000;

  const statusEl = document.getElementById("status");
  const hourInput = document.getElementById("hourInput");
  const btnLoad = document.getElementById("btnLoad");
  const btnConfig = document.getElementById("btnConfig");
  const configPanel = document.getElementById("configPanel");
  const configClose = document.getElementById("configClose");
  const chkNil = document.getElementById("chkNil");
  const cfgAutorefresh = document.getElementById("cfgAutorefresh");
  const cfgTimelineExact = document.getElementById("cfgTimelineExact");
  const cfgTimelineLatest = document.getElementById("cfgTimelineLatest");
  const cfgPlotScale = document.getElementById("cfgPlotScale");
  const cfgScaleLabel = document.getElementById("cfgScaleLabel");
  const detail = document.getElementById("detail");
  const detailBody = document.getElementById("detailBody");
  const detailClose = document.getElementById("detailClose");
  const hoverTip = document.getElementById("hoverTip");

  const defaults = {
    autorefresh: false,
    timeline: "exact",
    plotScale: 0.75,
    includeNil: false,
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaults };
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return { ...defaults };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  let settings = loadSettings();
  let refreshTimer = null;

  const map = L.map("map", {
    center: [-40.5, -64.5],
    zoom: 4,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  let layerGroup = L.layerGroup().addTo(map);

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInputValue(utcDate) {
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(
      utcDate.getUTCDate()
    )}T${pad(utcDate.getUTCHours())}:00`;
  }

  function hourParamFromInput() {
    const v = hourInput.value;
    if (!v) return null;
    const [date, time] = v.split("T");
    const [y, m, d] = date.split("-");
    const [hh] = time.split(":");
    return `${y}${m}${d}${hh}`;
  }

  function setDefaultHour() {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    hourInput.value = toLocalInputValue(now);
  }

  function applySettingsToUi() {
    cfgAutorefresh.checked = !!settings.autorefresh;
    chkNil.checked = !!settings.includeNil;
    if (settings.timeline === "latest") cfgTimelineLatest.checked = true;
    else cfgTimelineExact.checked = true;
    cfgPlotScale.value = String(settings.plotScale);
    cfgScaleLabel.textContent = Number(settings.plotScale).toFixed(2);
  }

  function readSettingsFromUi() {
    settings = {
      autorefresh: cfgAutorefresh.checked,
      timeline: cfgTimelineLatest.checked ? "latest" : "exact",
      plotScale: Number(cfgPlotScale.value),
      includeNil: chkNil.checked,
    };
    cfgScaleLabel.textContent = settings.plotScale.toFixed(2);
    saveSettings(settings);
    syncAutorefresh();
  }

  function syncAutorefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (settings.autorefresh) {
      refreshTimer = setInterval(() => {
        // En autorefresh, avanzar a la hora UTC actual
        setDefaultHour();
        loadSynops();
      }, REFRESH_MS);
    }
  }

  function toggleConfig(force) {
    const open = force != null ? force : configPanel.classList.contains("hidden");
    configPanel.classList.toggle("hidden", !open);
    btnConfig.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function showHover(html, evt) {
    hoverTip.innerHTML = html;
    hoverTip.classList.remove("hidden");
    moveHover(evt);
  }

  function moveHover(evt) {
    const x = evt.originalEvent?.clientX ?? evt.clientX ?? 0;
    const y = evt.originalEvent?.clientY ?? evt.clientY ?? 0;
    const padX = 14;
    const padY = 14;
    let left = x + padX;
    let top = y + padY;
    const rect = hoverTip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - 8) left = x - rect.width - padX;
    if (top + rect.height > window.innerHeight - 8) top = y - rect.height - padY;
    hoverTip.style.left = `${left}px`;
    hoverTip.style.top = `${top}px`;
  }

  function hideHover() {
    hoverTip.classList.add("hidden");
  }

  function openDetail(obs) {
    detailBody.innerHTML = StationPlot.detailHtml(obs);
    detail.classList.remove("hidden");
  }

  detailClose.addEventListener("click", () => detail.classList.add("hidden"));
  configClose.addEventListener("click", () => toggleConfig(false));
  btnConfig.addEventListener("click", () => toggleConfig());

  async function loadSynops() {
    const hour = hourParamFromInput();
    const nil = settings.includeNil ? "1" : "0";
    const timeline = settings.timeline || "exact";
    const scale = settings.plotScale || 0.75;
    statusEl.textContent = "Consultando OGIMET…";
    btnLoad.disabled = true;
    try {
      const url = `/api/synops?nil=${nil}&timeline=${timeline}&lookback=24${
        hour ? `&hour=${hour}` : ""
      }`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error de API");

      layerGroup.clearLayers();
      hideHover();

      const w = Math.round(BASE_W * scale);
      const h = Math.round(BASE_H * scale);

      for (const obs of data.synops) {
        if (obs.lat == null || obs.lng == null) continue;

        const html = StationPlot.buildStationHtml(obs, { scale });
        const icon = L.divIcon({
          className: "station-icon",
          html,
          iconSize: obs.nil ? [72, 28] : [w, h],
          iconAnchor: obs.nil ? [36, 14] : [Math.round(w / 2), Math.round(h / 2)],
        });

        const marker = L.marker([obs.lat, obs.lng], {
          icon,
          interactive: true,
          keyboard: true,
          riseOnHover: true,
        });

        marker.on("mouseover", (e) => showHover(StationPlot.hoverHtml(obs), e));
        marker.on("mousemove", (e) => moveHover(e));
        marker.on("mouseout", hideHover);
        marker.on("click", () => openDetail(obs));

        if (!obs.nil) addCloudHotspots(obs);

        marker.addTo(layerGroup);
      }

      const modeLabel = timeline === "latest" ? "último dato" : "hora exacta";
      statusEl.textContent = `${data.hour_label} · ${data.count} estaciones · ${modeLabel}`;
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      btnLoad.disabled = false;
    }
  }

  function addCloudHotspots(obs) {
    const offsets = [];
    if (obs.cl && obs.cl !== "0") {
      offsets.push({
        dlat: -0.04,
        dlng: 0.01,
        html: `<b>Sección 1 · CL</b><br/>${SynopSymbols.cloudLabel("CL", obs.cl)}`,
      });
    }
    if (obs.cm && obs.cm !== "0") {
      offsets.push({
        dlat: 0.03,
        dlng: 0.01,
        html: `<b>Sección 1 · CM</b><br/>${SynopSymbols.cloudLabel("CM", obs.cm)}`,
      });
    }
    if (obs.ch && obs.ch !== "0") {
      offsets.push({
        dlat: 0.05,
        dlng: 0.01,
        html: `<b>Sección 1 · CH</b><br/>${SynopSymbols.cloudLabel("CH", obs.ch)}`,
      });
    }

    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    layers.forEach((layer, i) => {
      const ft =
        layer.height_ft != null
          ? layer.height_ft
          : layer.height_m != null
            ? Math.round((layer.height_m * 3.28084) / 100) * 100
            : null;
      const bits = [
        ft != null ? `${ft} ft` : null,
        layer.genus_name || (layer.genus != null ? `C=${layer.genus}` : null),
        layer.ns != null ? `Ns=${layer.ns}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      offsets.push({
        dlat: -0.04 - i * 0.025,
        dlng: 0.05,
        html: `<b>Sección 3 · capa ${i + 1}</b><br/>${SynopSymbols.esc(bits)}`,
      });
    });

    for (const o of offsets) {
      const m = L.circleMarker([obs.lat + o.dlat, obs.lng + o.dlng], {
        radius: 9,
        opacity: 0,
        fillOpacity: 0,
        interactive: true,
      });
      m.on("mouseover", (e) =>
        showHover(
          `${o.html}<div class="synop-line">${SynopSymbols.esc(obs.nombre || obs.omm)}</div>`,
          e
        )
      );
      m.on("mousemove", moveHover);
      m.on("mouseout", hideHover);
      m.addTo(layerGroup);
    }
  }

  function onConfigChange(reload) {
    readSettingsFromUi();
    if (reload) loadSynops();
  }

  btnLoad.addEventListener("click", loadSynops);
  chkNil.addEventListener("change", () => onConfigChange(true));
  hourInput.addEventListener("change", loadSynops);
  cfgAutorefresh.addEventListener("change", () => onConfigChange(false));
  cfgTimelineExact.addEventListener("change", () => onConfigChange(true));
  cfgTimelineLatest.addEventListener("change", () => onConfigChange(true));
  cfgPlotScale.addEventListener("input", () => {
    cfgScaleLabel.textContent = Number(cfgPlotScale.value).toFixed(2);
  });
  cfgPlotScale.addEventListener("change", () => onConfigChange(true));

  applySettingsToUi();
  setDefaultHour();
  syncAutorefresh();
  loadSynops();
})();
