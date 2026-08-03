/**
 * Visualización METAR/TAF: puntos por categoría de vuelo + panel de detalle.
 */
(function (global) {
  const CAT = {
    VFR: { color: "#00aa00", label: "VFR", hint: "Techo > 3000 ft y vis > 8000 m" },
    MVFR: { color: "#0066ff", label: "MVFR", hint: "Techo 1000–3000 ft o vis 5000–8000 m" },
    IFR: { color: "#ff0000", label: "IFR", hint: "Techo 500–999 ft o vis 1500–5000 m" },
    LIFR: { color: "#ff00ff", label: "LIFR", hint: "Techo < 500 ft o vis < 1500 m" },
  };

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function catMeta(code) {
    return CAT[code] || { color: "#888888", label: code || "—", hint: "Sin categoría" };
  }

  /** Colores de visibilidad horizontal (m). */
  function visStyle(m) {
    if (m == null || Number.isNaN(Number(m))) return null;
    const v = Number(m);
    if (v < 1000) return { color: "#c62828", label: "< 1000 m" };
    if (v < 3000) return { color: "#f9a825", label: "1000–3000 m" };
    if (v <= 9000) return { color: "#6d4c41", label: "3000–9000 m" };
    return { color: "#2e7d32", label: "> 9000 m" };
  }

  function fmtVis(m) {
    if (m == null) return "—";
    if (m >= 1000) {
      const km = m / 1000;
      return `${m} m (${Number.isInteger(km) ? km : km.toFixed(1)} km)`;
    }
    return `${m} m`;
  }

  function coloredVisHtml(m) {
    const txt = fmtVis(m);
    const st = visStyle(m);
    if (!st) return esc(txt);
    return `<span class="metar-vis" style="color:${st.color};font-weight:700">${esc(txt)}</span>`;
  }

  function cloudsText(clouds) {
    if (!Array.isArray(clouds) || !clouds.length) return "—";
    return clouds
      .map((c) => {
        const cover = c.cover || "?";
        const base = c.base != null ? `${c.base} ft` : "";
        return [cover, base].filter(Boolean).join(" ");
      })
      .join(" · ");
  }

  function hoverHtml(obs) {
    const cat = catMeta(obs.flt_cat);
    const lines = [
      `<b>${esc(obs.icao)}</b> · ${esc(obs.nombre || "")}`,
      obs.is_speci ? `<span class="speci-badge">SPECI</span>` : "",
      obs.fir ? `FIR ${esc(obs.fir)}` : "",
      `<span style="color:${cat.color}"><b>${esc(cat.label)}</b></span> · ${esc(cat.hint)}`,
      obs.obs_iso ? `Obs: ${esc(obs.obs_iso)}` : "",
      obs.temp_c != null ? `T ${obs.temp_c} °C` : "",
      obs.ceiling_ft != null ? `Techo ${obs.ceiling_ft} ft` : "Techo —",
      `Vis ${coloredVisHtml(obs.visibility_m)}`,
      `<div class="synop-line">${esc(obs.raw || "")}</div>`,
    ];
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const cat = catMeta(obs.flt_cat);
    const wind =
      obs.wind_dir != null || obs.wind_speed_kt != null
        ? `${obs.wind_dir != null ? obs.wind_dir + "°" : "—"} · ${
            obs.wind_speed_kt != null ? obs.wind_speed_kt + " kt" : "—"
          }${obs.wind_gust_kt != null ? ` G${obs.wind_gust_kt}` : ""}`
        : "—";
    const rows = [
      ["ICAO", obs.icao],
      ["Tipo", obs.is_speci ? "SPECI" : obs.metar_type || "METAR"],
      ["FIR", obs.fir || "—"],
      ["Categoría", cat.label],
      ["Observación", obs.obs_iso || "—"],
      ["Temperatura", obs.temp_c != null ? `${obs.temp_c} °C` : "—"],
      ["Rocío", obs.dewpoint_c != null ? `${obs.dewpoint_c} °C` : "—"],
      ["Viento", wind],
      ["Nubes", cloudsText(obs.clouds)],
      ["Techo", obs.ceiling_ft != null ? `${obs.ceiling_ft} ft` : "—"],
      ["QNH", obs.altim_hpa != null ? `${obs.altim_hpa} hPa` : "—"],
      ["Tiempo presente", obs.wx_string || "—"],
    ];
    const dl = rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v))}</dd>`)
      .join("");
    return `
      <h2>${esc(obs.icao)} · ${esc(obs.nombre || "")}</h2>
      <div class="meta">
        <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
        ${obs.is_speci ? `<span class="speci-badge">SPECI</span>` : ""}
        · fuente AviationWeather
      </div>
      <button type="button" class="btn primary metar-hist-btn" data-icao="${esc(obs.icao)}" data-nombre="${esc(
        obs.nombre || obs.icao
      )}">
        Ver últimas 24 h
      </button>
      <div><b>METAR</b></div>
      <pre class="raw">${esc(obs.raw || "—")}</pre>
      ${
        obs.raw_taf
          ? `<div><b>TAF</b></div><pre class="raw">${esc(obs.raw_taf)}</pre>`
          : `<div class="meta">Sin TAF en la respuesta</div>`
      }
      <dl>
        <dt>Visibilidad</dt>
        <dd>${coloredVisHtml(obs.visibility_m)}</dd>
        ${dl}
      </dl>
      <div class="vis-legend">
        Vis: <span style="color:#c62828">&#9632; &lt;1 km</span>
        <span style="color:#f9a825">&#9632; 1–3 km</span>
        <span style="color:#6d4c41">&#9632; 3–9 km</span>
        <span style="color:#2e7d32">&#9632; &gt;9 km</span>
      </div>
    `;
  }

  function historyHtml(payload) {
    const points = payload.points || [];
    if (!points.length) {
      return `<div class="ts-empty">Sin METARs en las últimas ${payload.hours || 24} h.</div>`;
    }
    const items = points
      .map((p) => {
        const cat = catMeta(p.flt_cat);
        const when = p.obs_iso || p.hour_key || "—";
        return `
          <article class="metar-hist-item${p.is_speci ? " is-speci" : ""}">
            <header>
              <time>${esc(when)}</time>
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
              ${p.is_speci ? `<span class="speci-badge">SPECI</span>` : ""}
            </header>
            <pre class="raw">${esc(p.raw || "—")}</pre>
            <div class="metar-hist-meta">
              Vis ${coloredVisHtml(p.visibility_m)}
              · Techo ${p.ceiling_ft != null ? esc(String(p.ceiling_ft)) + " ft" : "—"}
              · T ${p.temp_c != null ? esc(String(p.temp_c)) + " °C" : "—"}
            </div>
          </article>`;
      })
      .join("");
    return `
      <div class="vis-legend">
        Vis: <span style="color:#c62828">&#9632; &lt;1 km</span>
        <span style="color:#f9a825">&#9632; 1–3 km</span>
        <span style="color:#6d4c41">&#9632; 3–9 km</span>
        <span style="color:#2e7d32">&#9632; &gt;9 km</span>
      </div>
      <div class="metar-hist-list">${items}</div>`;
  }

  async function loadHistory(container, icao) {
    container.innerHTML = `<div class="ts-loading">Cargando METARs…</div>`;
    const res = await fetch(`/api/metars/${encodeURIComponent(icao)}?hours=24&taf=0`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar historial");
    container.innerHTML = historyHtml(data);
    return data;
  }

  function legendHtml() {
    return `
      <div class="flt-legend" aria-label="Categorías de vuelo">
        ${Object.keys(CAT)
          .map(
            (k) =>
              `<span class="flt-leg"><i style="background:${CAT[k].color}"></i>${CAT[k].label}</span>`
          )
          .join("")}
      </div>`;
  }

  function markerOptions(obs, selected) {
    const cat = catMeta(obs.flt_cat);
    return {
      radius: selected ? 9 : obs.is_speci ? 8 : 7,
      color: obs.is_speci ? "#111" : "#111",
      weight: selected || obs.is_speci ? 2 : 1,
      fillColor: cat.color,
      fillOpacity: 0.92,
      opacity: 0.95,
      dashArray: obs.is_speci ? "2 2" : null,
    };
  }

  global.MetarPlot = {
    CAT,
    catMeta,
    visStyle,
    fmtVis,
    coloredVisHtml,
    hoverHtml,
    detailHtml,
    historyHtml,
    loadHistory,
    legendHtml,
    markerOptions,
  };
})(window);
