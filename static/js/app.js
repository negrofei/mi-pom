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

  let layerGroup = L.layerGroup().addTo(map);

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toLocalInputValue(utcDate) {
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

      for (const obs of data.synops) {
        if (obs.lat == null || obs.lng == null) continue;

        const html = StationPlot.buildStationHtml(obs);
        const icon = L.divIcon({
          className: "station-icon",
          html,
          iconSize: obs.nil ? [72, 28] : [120, 130],
          iconAnchor: obs.nil ? [36, 14] : [60, 50],
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

      statusEl.textContent = `${data.hour_label} · ${data.count} estaciones`;
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
        dlat: -0.06,
        dlng: 0.01,
        html: `<b>Sección 1 · CM</b><br/>${SynopSymbols.cloudLabel("CM", obs.cm)}`,
      });
    }
    if (obs.ch && obs.ch !== "0") {
      offsets.push({
        dlat: -0.08,
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
            ? Math.round(layer.height_m * 3.28084)
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

  btnLoad.addEventListener("click", loadSynops);
  chkNil.addEventListener("change", loadSynops);
  hourInput.addEventListener("change", loadSynops);

  setDefaultHour();
  loadSynops();
  setInterval(loadSynops, 5 * 60 * 1000);
})();
