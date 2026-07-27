/**
 * Ploteo de estación SYNOP (modelo de estación) como SVG para Leaflet.
 */
(function (global) {
  const S = () => global.SynopSymbols;

  function fmtTemp(v) {
    if (v == null || Number.isNaN(Number(v))) return "";
    const n = Number(v);
    return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }

  function buildStationSvg(obs) {
    const size = 110;
    const cx = size / 2;
    const cy = size / 2;
    const parts = [];

    // Barbas de viento (atrás)
    parts.push(S().windBarb(obs.wind_speed_kt, obs.wind_dir, cx, cy, 36));

    // Cobertura nubosa central
    parts.push(S().cloudCoverSymbol(obs.total_cloud, cx, cy, 8));

    // Temperatura (roja, arriba-izquierda)
    if (obs.temp_c != null) {
      parts.push(
        `<text x="${cx - 28}" y="${cy - 14}" text-anchor="end" font-size="11" fill="#c62828">${S().esc(fmtTemp(obs.temp_c))}</text>`
      );
    }

    // Rocío (marrón, abajo-izquierda)
    if (obs.dewpoint_c != null) {
      parts.push(
        `<text x="${cx - 28}" y="${cy + 22}" text-anchor="end" font-size="11" fill="#6d4c41">${S().esc(fmtTemp(obs.dewpoint_c))}</text>`
      );
    }

    // Presión (azul, arriba-derecha)
    if (obs.pressure_plot) {
      parts.push(
        `<text x="${cx + 28}" y="${cy - 14}" text-anchor="start" font-size="11" fill="#1565c0">${S().esc(obs.pressure_plot)}</text>`
      );
    }

    // Tendencia
    parts.push(S().tendencySymbol(obs.tendency_char, cx + 34, cy + 2));
    if (obs.tendency_val) {
      parts.push(
        `<text x="${cx + 46}" y="${cy + 5}" text-anchor="start" font-size="9" fill="#1565c0">${S().esc(obs.tendency_val)}</text>`
      );
    }

    // Visibilidad (izquierda del círculo)
    if (obs.visibility) {
      parts.push(
        `<text x="${cx - 30}" y="${cy + 4}" text-anchor="end" font-size="9" fill="#111">${S().esc(obs.visibility)}</text>`
      );
    }

    // Tiempo presente (izquierda del N)
    parts.push(S().presentWeather(obs.present_weather, cx - 18, cy - 1));

    // Nh
    if (obs.nh) {
      parts.push(
        `<text x="${cx + 14}" y="${cy + 20}" text-anchor="middle" font-size="9" fill="#333366">${S().esc(obs.nh)}</text>`
      );
    }

    // h (base nubes bajas) bajo el círculo un poco a la izquierda
    if (obs.cloud_base_h) {
      parts.push(
        `<text x="${cx - 2}" y="${cy + 24}" text-anchor="middle" font-size="9" fill="#333366">${S().esc(obs.cloud_base_h)}</text>`
      );
    }

    // CL / CM / CH
    parts.push(S().cloudType("CL", obs.cl, cx + 2, cy + 34));
    parts.push(S().cloudType("CM", obs.cm, cx + 2, cy + 46));
    parts.push(S().cloudType("CH", obs.ch, cx + 2, cy + 56));

    return `<svg class="station-svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
  }

  function hoverHtml(obs) {
    const name = obs.nombre || obs.omm;
    const lines = [
      `<b>${S().esc(obs.omm)}</b> · ${S().esc(name)}`,
      obs.utc ? `Fecha: ${S().esc(obs.utc)} UTC` : "",
    ];
    if (obs.nil) {
      lines.push("Sin observación (NIL)");
      lines.push(`<div class="synop-line">${S().esc(obs.raw)}</div>`);
      return lines.filter(Boolean).join("<br/>");
    }
    if (obs.temp_c != null) lines.push(`Temp: ${fmtTemp(obs.temp_c)} °C`);
    if (obs.dewpoint_c != null) lines.push(`Rocío: ${fmtTemp(obs.dewpoint_c)} °C`);
    if (obs.msl_pressure != null) lines.push(`Presión: ${obs.msl_pressure.toFixed(1)} hPa`);
    if (obs.wind_dir != null || obs.wind_speed_kt != null) {
      lines.push(
        `Viento: ${obs.wind_dir != null ? obs.wind_dir + "°" : "—"} / ${
          obs.wind_speed_kt != null ? obs.wind_speed_kt + " kt" : "—"
        }`
      );
    }
    if (obs.present_weather) lines.push(`Tiempo presente (ww): ${S().esc(obs.present_weather)}`);
    if (obs.cl) lines.push(S().cloudLabel("CL", obs.cl));
    if (obs.cm) lines.push(S().cloudLabel("CM", obs.cm));
    if (obs.ch) lines.push(S().cloudLabel("CH", obs.ch));
    lines.push(`<div class="synop-line">${S().esc(obs.raw)}</div>`);
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const rows = [
      ["Estación", `${obs.omm} — ${obs.nombre || ""}`],
      ["UTC", obs.utc || "—"],
      ["Temperatura", obs.temp_c != null ? `${fmtTemp(obs.temp_c)} °C` : "—"],
      ["Punto de rocío", obs.dewpoint_c != null ? `${fmtTemp(obs.dewpoint_c)} °C` : "—"],
      ["Presión MSL", obs.msl_pressure != null ? `${obs.msl_pressure.toFixed(1)} hPa` : "—"],
      ["Presión estación", obs.station_pressure != null ? `${obs.station_pressure.toFixed(1)} hPa` : "—"],
      ["Viento", `${obs.wind_dir != null ? obs.wind_dir + "°" : "—"} · ${obs.wind_speed_kt != null ? obs.wind_speed_kt + " kt" : "—"}`],
      ["N (oktas)", obs.total_cloud ?? "—"],
      ["Visibilidad VV", obs.visibility ?? "—"],
      ["h (base)", obs.cloud_base_h ?? "—"],
      ["ww", obs.present_weather ?? "—"],
      ["Nh / CL / CM / CH", `${obs.nh ?? "/"} ${obs.cl ?? "/"} ${obs.cm ?? "/"} ${obs.ch ?? "/"}`],
      ["Tendencia", `${obs.tendency_char ?? "—"} ${obs.tendency_val ?? ""}`],
    ];
    const dl = rows
      .map(([k, v]) => `<dt>${S().esc(k)}</dt><dd>${S().esc(String(v))}</dd>`)
      .join("");
    return `
      <h2>${S().esc(obs.nombre || obs.omm)}</h2>
      <div class="meta">${S().esc(obs.omm)} · fuente OGIMET</div>
      <div><b>SYNOP</b></div>
      <pre class="raw">${S().esc(obs.raw)}</pre>
      <dl>${dl}</dl>
    `;
  }

  global.StationPlot = { buildStationSvg, hoverHtml, detailHtml, fmtTemp };
})(window);
