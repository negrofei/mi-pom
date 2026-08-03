(function () {
  const STORAGE_KEY = "synop-ar-config-v4";
  const BASE_W = 120;
  const BASE_H = 160;
  const REFRESH_MS = 2 * 60 * 1000;
  const ALL_FIRS = ["EZE", "CBA", "DOZ", "SIS", "CRV"];
  const FIR_META = {
    EZE: { name: "Ezeiza", color: "#1f4e79" },
    CBA: { name: "Córdoba", color: "#6b3a1f" },
    DOZ: { name: "Mendoza", color: "#2f5d3a" },
    SIS: { name: "Resistencia", color: "#5a2d6e" },
    CRV: { name: "Comodoro Rivadavia", color: "#8a4b12" },
  };

  const statusEl = document.getElementById("status");
  const hourInput = document.getElementById("hourInput");
  const btnLoad = document.getElementById("btnLoad");
  const btnConfig = document.getElementById("btnConfig");
  const configPanel = document.getElementById("configPanel");
  const configClose = document.getElementById("configClose");
  const chkNil = document.getElementById("chkNil");
  const nilWrap = document.getElementById("nilWrap");
  const cfgAutorefresh = document.getElementById("cfgAutorefresh");
  const cfgTimelineExact = document.getElementById("cfgTimelineExact");
  const cfgTimelineLatest = document.getElementById("cfgTimelineLatest");
  const cfgPlotGap = document.getElementById("cfgPlotGap");
  const cfgGapLabel = document.getElementById("cfgGapLabel");
  const cfgFirAll = document.getElementById("cfgFirAll");
  const firChecks = document.getElementById("firChecks");
  const btnProductSynop = document.getElementById("btnProductSynop");
  const btnProductMetar = document.getElementById("btnProductMetar");
  const fltLegend = document.getElementById("fltLegend");
  const detail = document.getElementById("detail");
  const detailBody = document.getElementById("detailBody");
  const detailClose = document.getElementById("detailClose");
  const hoverTip = document.getElementById("hoverTip");
  const tsModal = document.getElementById("tsModal");
  const tsBody = document.getElementById("tsBody");
  const tsTitle = document.getElementById("tsTitle");
  const tsSubtitle = document.getElementById("tsSubtitle");
  const tsClose = document.getElementById("tsClose");

  const defaults = {
    product: "synop",
    autorefresh: false,
    timeline: "exact",
    plotGap: 0.75,
    includeNil: false,
    firs: [...ALL_FIRS],
  };

  function loadSettings() {
    try {
      const raw =
        localStorage.getItem(STORAGE_KEY) ||
        localStorage.getItem("synop-ar-config-v2") ||
        localStorage.getItem("synop-ar-config-v1");
      if (!raw) return { ...defaults, firs: [...ALL_FIRS] };
      const parsed = JSON.parse(raw);
      // migrar plotScale → plotGap
      if (parsed.plotGap == null && parsed.plotScale != null) {
        parsed.plotGap = parsed.plotScale;
      }
      if (!Array.isArray(parsed.firs) || !parsed.firs.length) {
        parsed.firs = [...ALL_FIRS];
      }
      if (parsed.product !== "metar" && parsed.product !== "synop") {
        parsed.product = "synop";
      }
      return { ...defaults, ...parsed, firs: parsed.firs.filter((c) => ALL_FIRS.includes(c)) };
    } catch {
      return { ...defaults, firs: [...ALL_FIRS] };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  let settings = loadSettings();
  let refreshTimer = null;
  let seenSpeci = new Set();
  let speciSeeded = false;

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
  let firLayer = L.geoJSON(null, {
    style: (feature) => {
      const code = feature?.properties?.fir;
      const active = !settings.firs.length || settings.firs.includes(code);
      const color = FIR_META[code]?.color || "#444";
      return {
        color,
        weight: active ? 1.25 : 0.7,
        opacity: active ? 0.85 : 0.25,
        fill: false,
        fillOpacity: 0,
        interactive: true,
      };
    },
    onEachFeature: (feature, layer) => {
      const code = feature.properties?.fir || "?";
      const name = feature.properties?.name || FIR_META[code]?.name || code;
      layer.bindTooltip(`FIR ${code} · ${name}`, {
        sticky: true,
        direction: "top",
        opacity: 0.9,
        className: "fir-tooltip",
      });
    },
  }).addTo(map);

  async function loadFirLayer() {
    try {
      const res = await fetch("/data/fir_argentina.geojson");
      if (!res.ok) throw new Error(res.statusText);
      const geo = await res.json();
      firLayer.clearLayers();
      firLayer.addData(geo);
    } catch (err) {
      console.error("No se pudo cargar FIR", err);
    }
  }

  function selectedFirsFromUi() {
    const boxes = [...firChecks.querySelectorAll('input[type="checkbox"]')];
    return boxes.filter((b) => b.checked).map((b) => b.value);
  }

  function syncFirAllCheckbox() {
    const selected = selectedFirsFromUi();
    cfgFirAll.checked = selected.length === ALL_FIRS.length;
    cfgFirAll.indeterminate = selected.length > 0 && selected.length < ALL_FIRS.length;
  }

  function applyFirChecks(firs) {
    const set = new Set(firs && firs.length ? firs : ALL_FIRS);
    firChecks.querySelectorAll('input[type="checkbox"]').forEach((b) => {
      b.checked = set.has(b.value);
    });
    syncFirAllCheckbox();
  }

  function refreshFirStyles() {
    firLayer.setStyle((feature) => {
      const code = feature?.properties?.fir;
      const active = !settings.firs.length || settings.firs.includes(code);
      const color = FIR_META[code]?.color || "#444";
      return {
        color,
        weight: active ? 1.25 : 0.7,
        opacity: active ? 0.85 : 0.25,
        fill: false,
        fillOpacity: 0,
      };
    });
  }

  function firAllowed(obs) {
    if (!settings.firs || settings.firs.length === ALL_FIRS.length) return true;
    if (!settings.firs.length) return false;
    return settings.firs.includes(obs.fir);
  }

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
    cfgPlotGap.value = String(settings.plotGap);
    cfgGapLabel.textContent = Number(settings.plotGap).toFixed(2);
    applyFirChecks(settings.firs);
    applyProductUi();
  }

  function readSettingsFromUi() {
    settings = {
      product: settings.product || "synop",
      autorefresh: cfgAutorefresh.checked,
      timeline: cfgTimelineLatest.checked ? "latest" : "exact",
      plotGap: Number(cfgPlotGap.value),
      includeNil: chkNil.checked,
      firs: selectedFirsFromUi(),
    };
    cfgGapLabel.textContent = settings.plotGap.toFixed(2);
    saveSettings(settings);
    syncAutorefresh();
    refreshFirStyles();
  }

  function applyProductUi() {
    const isMetar = settings.product === "metar";
    btnProductSynop.classList.toggle("active", !isMetar);
    btnProductMetar.classList.toggle("active", isMetar);
    nilWrap.classList.toggle("hidden", isMetar);
    fltLegend.classList.toggle("hidden", !isMetar);
    if (isMetar) fltLegend.innerHTML = MetarPlot.legendHtml();
  }

  function setProduct(product) {
    settings.product = product === "metar" ? "metar" : "synop";
    if (settings.product === "metar") {
      // En METAR se consultan mensajes cada 2 min para detectar SPECI
      settings.autorefresh = true;
      cfgAutorefresh.checked = true;
      settings.timeline = "latest";
      cfgTimelineLatest.checked = true;
    }
    saveSettings(settings);
    applyProductUi();
    syncAutorefresh();
    loadCurrent();
  }

  function syncAutorefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    // METAR siempre refresca cada 2 min; SYNOP respeta el checkbox
    const enabled = settings.product === "metar" || settings.autorefresh;
    if (enabled) {
      refreshTimer = setInterval(() => {
        setDefaultHour();
        loadCurrent();
      }, REFRESH_MS);
    }
  }

  function speciKey(s) {
    return `${s.icao}|${s.obs_iso || s.raw || ""}`;
  }

  function pushToast(html, kind) {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast ${kind || ""}`;
    el.innerHTML = html;
    stack.appendChild(el);
    setTimeout(() => {
      el.classList.add("toast-out");
      setTimeout(() => el.remove(), 350);
    }, 8000);
  }

  function notifySpecis(specis) {
    if (!Array.isArray(specis) || !specis.length) return;
    const fresh = [];
    for (const s of specis) {
      const key = speciKey(s);
      if (seenSpeci.has(key)) continue;
      seenSpeci.add(key);
      fresh.push(s);
    }
    if (!speciSeeded) {
      speciSeeded = true;
      return; // primera carga: no spamear toasts de SPECI ya vigentes
    }
    for (const s of fresh) {
      const icao = String(s.icao || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const nombre = String(s.nombre || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
      const raw = String(s.raw || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/"/g, "&quot;");
      pushToast(
        `<div class="toast-title">SPECI · ${icao}</div>
         <div class="toast-sub">${nombre}</div>
         <code>${raw}</code>`,
        "toast-speci"
      );
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
    if (settings.product === "metar") {
      detailBody.innerHTML = MetarPlot.detailHtml(obs);
    } else {
      detailBody.innerHTML = StationPlot.detailHtml(obs);
    }
    detail.classList.remove("hidden");
  }

  function loadCurrent() {
    if (settings.product === "metar") return loadMetars();
    return loadSynops();
  }

  async function openTimeSeries(omm, nombre) {
    tsTitle.textContent = `Serie temporal · ${nombre || omm}`;
    tsSubtitle.textContent = `${omm} · últimas 24 h`;
    tsModal.classList.remove("hidden");
    try {
      const data = await TimeSeries.loadAndRender(tsBody, omm, hourParamFromInput());
      tsSubtitle.textContent = `${omm} · ${data.count} obs · hasta ${data.until_label}`;
    } catch (err) {
      console.error(err);
      const msg = String(err.message || err)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
      tsBody.innerHTML = `<div class="ts-empty">Error: ${msg}</div>`;
    }
  }

  function closeTimeSeries() {
    tsModal.classList.add("hidden");
    const tip = document.getElementById("tsHoverTip");
    if (tip) tip.classList.add("hidden");
  }

  detailClose.addEventListener("click", () => detail.classList.add("hidden"));
  configClose.addEventListener("click", () => toggleConfig(false));
  btnConfig.addEventListener("click", () => toggleConfig());
  tsClose.addEventListener("click", closeTimeSeries);
  tsModal.addEventListener("click", (e) => {
    if (e.target === tsModal) closeTimeSeries();
  });
  detailBody.addEventListener("click", (e) => {
    const hist = e.target.closest(".metar-hist-btn");
    if (hist) {
      openMetarHistory(hist.getAttribute("data-icao"), hist.getAttribute("data-nombre"));
      return;
    }
    const btn = e.target.closest(".ts-open-btn");
    if (!btn) return;
    openTimeSeries(btn.getAttribute("data-omm"), btn.getAttribute("data-nombre"));
  });

  async function openMetarHistory(icao, nombre) {
    tsTitle.textContent = `METAR · ${nombre || icao}`;
    tsSubtitle.textContent = `${icao} · últimas 24 h`;
    tsModal.classList.remove("hidden");
    try {
      const data = await MetarPlot.loadHistory(tsBody, icao);
      tsSubtitle.textContent = `${icao} · ${data.count} reportes · últimas ${data.hours} h`;
    } catch (err) {
      console.error(err);
      const msg = String(err.message || err)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;");
      tsBody.innerHTML = `<div class="ts-empty">Error: ${msg}</div>`;
    }
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeTimeSeries();
  });

  async function loadMetars() {
    const hour = hourParamFromInput();
    const timeline = settings.timeline || "latest";
    // Ventana: 3 h para latest (como el ejemplo AW), 1–3 h para exact
    const hours = timeline === "latest" ? 3 : 3;
    statusEl.textContent = "Consultando AviationWeather…";
    btnLoad.disabled = true;
    try {
      const url = `/api/metars?taf=1&timeline=${timeline}&hours=${hours}${
        hour ? `&hour=${hour}` : ""
      }`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error de API");

      layerGroup.clearLayers();
      hideHover();

      let shown = 0;
      for (const obs of data.metars) {
        if (obs.lat == null || obs.lng == null) continue;
        if (!firAllowed(obs)) continue;

        const marker = L.circleMarker([obs.lat, obs.lng], MetarPlot.markerOptions(obs));
        marker.on("mouseover", (e) => {
          marker.setStyle(MetarPlot.markerOptions(obs, true));
          showHover(MetarPlot.hoverHtml(obs), e);
        });
        marker.on("mousemove", (e) => moveHover(e));
        marker.on("mouseout", () => {
          marker.setStyle(MetarPlot.markerOptions(obs, false));
          hideHover();
        });
        marker.on("click", () => openDetail(obs));
        marker.addTo(layerGroup);
        shown += 1;
      }

      const modeLabel = timeline === "latest" ? "último METAR" : "hora exacta";
      const firLabel =
        settings.firs.length === ALL_FIRS.length
          ? "todas las FIR"
          : settings.firs.length
            ? `FIR ${settings.firs.join("+")}`
            : "sin FIR";
      statusEl.textContent = `${data.hour_label} · ${shown}/${data.count} aeródromos · ${modeLabel} · ${firLabel}${
        data.speci_count ? ` · ${data.speci_count} SPECI` : ""
      }`;
      notifySpecis(data.specis || data.metars.filter((m) => m.is_speci));
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      btnLoad.disabled = false;
    }
  }

  async function loadSynops() {
    const hour = hourParamFromInput();
    const nil = settings.includeNil ? "1" : "0";
    const timeline = settings.timeline || "exact";
    const gap = settings.plotGap || 0.75;
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

      const w = Math.round(BASE_W * gap);
      const h = Math.round(BASE_H * gap);

      for (const obs of data.synops) {
        if (obs.lat == null || obs.lng == null) continue;
        if (!firAllowed(obs)) continue;

        const html = StationPlot.buildStationHtml(obs, { gap });
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

      const shown = layerGroup.getLayers().filter((l) => l instanceof L.Marker).length;
      const modeLabel = timeline === "latest" ? "último dato" : "hora exacta";
      const firLabel =
        settings.firs.length === ALL_FIRS.length
          ? "todas las FIR"
          : settings.firs.length
            ? `FIR ${settings.firs.join("+")}`
            : "sin FIR";
      statusEl.textContent = `${data.hour_label} · ${shown}/${data.count} estaciones · ${modeLabel} · ${firLabel}`;
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
    if (reload) loadCurrent();
  }

  btnLoad.addEventListener("click", loadCurrent);
  chkNil.addEventListener("change", () => onConfigChange(true));
  hourInput.addEventListener("change", loadCurrent);
  cfgAutorefresh.addEventListener("change", () => onConfigChange(false));
  cfgTimelineExact.addEventListener("change", () => onConfigChange(true));
  cfgTimelineLatest.addEventListener("change", () => onConfigChange(true));
  cfgPlotGap.addEventListener("input", () => {
    cfgGapLabel.textContent = Number(cfgPlotGap.value).toFixed(2);
  });
  cfgPlotGap.addEventListener("change", () => onConfigChange(true));
  cfgFirAll.addEventListener("change", () => {
    const on = cfgFirAll.checked;
    firChecks.querySelectorAll('input[type="checkbox"]').forEach((b) => {
      b.checked = on;
    });
    syncFirAllCheckbox();
    onConfigChange(true);
  });
  firChecks.addEventListener("change", () => {
    syncFirAllCheckbox();
    onConfigChange(true);
  });
  btnProductSynop.addEventListener("click", () => setProduct("synop"));
  btnProductMetar.addEventListener("click", () => setProduct("metar"));

  applySettingsToUi();
  setDefaultHour();
  syncAutorefresh();
  loadFirLayer();
  loadCurrent();
})();
