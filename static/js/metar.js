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

  function fmtVis(m) {
    if (m == null) return "—";
    if (m >= 1000) {
      const km = m / 1000;
      return `${m} m (${Number.isInteger(km) ? km : km.toFixed(1)} km)`;
    }
    return `${m} m`;
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
      obs.fir ? `FIR ${esc(obs.fir)}` : "",
      `<span style="color:${cat.color}"><b>${esc(cat.label)}</b></span> · ${esc(cat.hint)}`,
      obs.obs_iso ? `Obs: ${esc(obs.obs_iso)}` : "",
      obs.temp_c != null ? `T ${obs.temp_c} °C` : "",
      obs.ceiling_ft != null ? `Techo ${obs.ceiling_ft} ft` : "Techo —",
      `Vis ${esc(fmtVis(obs.visibility_m))}`,
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
      ["FIR", obs.fir || "—"],
      ["Categoría", cat.label],
      ["Observación", obs.obs_iso || "—"],
      ["Temperatura", obs.temp_c != null ? `${obs.temp_c} °C` : "—"],
      ["Rocío", obs.dewpoint_c != null ? `${obs.dewpoint_c} °C` : "—"],
      ["Viento", wind],
      ["Visibilidad", fmtVis(obs.visibility_m)],
      ["Techo", obs.ceiling_ft != null ? `${obs.ceiling_ft} ft` : "—"],
      ["Nubes", cloudsText(obs.clouds)],
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
        · fuente AviationWeather
      </div>
      <div><b>METAR</b></div>
      <pre class="raw">${esc(obs.raw || "—")}</pre>
      ${
        obs.raw_taf
          ? `<div><b>TAF</b></div><pre class="raw">${esc(obs.raw_taf)}</pre>`
          : `<div class="meta">Sin TAF en la respuesta</div>`
      }
      <dl>${dl}</dl>
    `;
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
      radius: selected ? 9 : 7,
      color: "#111",
      weight: selected ? 2 : 1,
      fillColor: cat.color,
      fillOpacity: 0.92,
      opacity: 0.95,
    };
  }

  global.MetarPlot = {
    CAT,
    catMeta,
    hoverHtml,
    detailHtml,
    legendHtml,
    markerOptions,
  };
})(window);
