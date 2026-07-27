(function () {
  const statusEl = document.getElementById("status");
  const hourInput = document.getElementById("hourInput");
  const btnLoad = document.getElementById("btnLoad");
  const chkNil = document.getElementById("chkNil");
  const detail = document.getElementById("detail");
  const detailBody = document.getElementById("detailBody");
  const detailClose = document.getElementById("detailClose");
  const hoverTip = document.getElementById("hoverTip");

  const map = L.map("map", {
    center: [-40.5, -64.5],
    zoom: 4,
    zoomControl: true,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  // Argenmap / IGN si está disponible (fallback OSM ya cargado)
  // Se mantiene OSM por simplicidad y cero keys.

  let layerGroup = L.layerGroup().addTo(map);

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInputValue(utcDate) {
    // datetime-local es local; mostramos la hora UTC en el control
    // usando los componentes UTC directamente.
    return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())}T${pad(utcDate.getUTCHours())}:00`;
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

  async function loadSynops() {
    const hour = hourParamFromInput();
    const nil = chkNil.checked ? "1" : "0";
    statusEl.textContent = "Consultando OGIMET…";
    btnLoad.disabled = true;
    try {
      const url = `/api/synops?nil=${nil}${hour ? `&hour=${hour}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error de API");

      layerGroup.clearLayers();
      hideHover();

      const bounds = [];
      for (const obs of data.synops) {
        if (obs.lat == null || obs.lng == null) continue;

        let html;
        if (obs.nil) {
          html = `<svg class="station-svg" width="72" height="28" viewBox="0 0 72 28" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="70" height="26" rx="4" fill="#fff" stroke="#666"/><text x="36" y="18" text-anchor="middle" font-size="11" fill="#666" font-family="IBM Plex Mono, monospace">NIL</text></svg>`;
        } else {
          html = StationPlot.buildStationSvg(obs);
        }

        const icon = L.divIcon({
          className: "station-icon",
          html,
          iconSize: obs.nil ? [72, 28] : [110, 110],
          iconAnchor: obs.nil ? [36, 14] : [55, 55],
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
        bounds.push([obs.lat, obs.lng]);
      }

      statusEl.textContent = `${data.hour_label} · ${data.count} estaciones`;
      if (bounds.length > 5) {
        // No auto-zoom agresivo: Argentina completa se ve bien en zoom 4
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Error: ${err.message}`;
    } finally {
      btnLoad.disabled = false;
    }
  }

  function addCloudHotspots(obs) {
    // Hotspots cerca del plot para tooltips de tipos de nube (como el original)
    const offsets = [];
    if (obs.cl && obs.cl !== "0") {
      offsets.push({ dlat: -0.035, dlng: 0.02, html: SynopSymbols.cloudLabel("CL", obs.cl) });
    }
    if (obs.cm && obs.cm !== "0") {
      offsets.push({ dlat: -0.055, dlng: 0.02, html: SynopSymbols.cloudLabel("CM", obs.cm) });
    }
    if (obs.ch && obs.ch !== "0") {
      offsets.push({ dlat: -0.075, dlng: 0.02, html: SynopSymbols.cloudLabel("CH", obs.ch) });
    }
    for (const o of offsets) {
      const m = L.circleMarker([obs.lat + o.dlat, obs.lng + o.dlng], {
        radius: 8,
        opacity: 0,
        fillOpacity: 0,
        interactive: true,
      });
      m.on("mouseover", (e) =>
        showHover(
          `<b>Nubes</b><br/>${o.html}<div class="synop-line">${SynopSymbols.esc(obs.nombre || obs.omm)}</div>`,
          e
        )
      );
      m.on("mousemove", moveHover);
      m.on("mouseout", hideHover);
      m.addTo(layerGroup);
    }
  }

  btnLoad.addEventListener("click", loadSynops);
  chkNil.addEventListener("change", loadSynops);
  hourInput.addEventListener("change", loadSynops);

  setDefaultHour();
  loadSynops();

  // Refresh suave cada 5 minutos
  setInterval(loadSynops, 5 * 60 * 1000);
})();
