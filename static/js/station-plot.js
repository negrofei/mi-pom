/**
 * Ploteo de estación SYNOP usando PNGs de /img (barbs + simbolos).
 * Layout vertical: CH / CM(+ft) / barba / CL(+ft)
 */
(function (global) {
  const S = () => global.SynopSymbols;
  const WW = () => global.PresentWeather;
  const IMG = "/img";

  const LOW_GENUS = new Set(["6", "7", "8", "9"]);
  const MID_GENUS = new Set(["3", "4", "5"]);
  const HIGH_GENUS = new Set(["0", "1", "2"]);

  function fmtTemp(v) {
    if (v == null || Number.isNaN(Number(v))) return "";
    const n = Number(v);
    return (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }

  function codeOr(v, fallback) {
    if (v == null || v === "" || v === "/") return fallback;
    return String(v);
  }

  function png(path, cls, style, title) {
    const t = title ? ` title="${S().esc(title)}"` : "";
    const st = style ? ` style="${style}"` : "";
    return `<img class="${cls}" src="${IMG}/${path}" alt="" draggable="false"${st}${t} />`;
  }

  function hasImgCode(v) {
    return v != null && v !== "" && v !== "/" && v !== "0";
  }

  function hasCloudCode(v) {
    // 0 = "no clouds of that type" → no dibujar símbolo
    return v != null && v !== "" && v !== "/" && v !== "0";
  }

  function barbSrc(obs) {
    const key = obs.wind_barb || "0";
    return `barbs/barb_${key}.png`;
  }

  function feetLabel(layer) {
    if (layer.height_ft != null) return String(layer.height_ft);
    if (layer.height_m != null) {
      return String(Math.round((layer.height_m * 3.28084) / 100) * 100);
    }
    return null;
  }

  function layerLevel(layer) {
    const g = layer.genus != null ? String(layer.genus) : "";
    if (LOW_GENUS.has(g)) return "low";
    if (MID_GENUS.has(g)) return "mid";
    if (HIGH_GENUS.has(g)) return "high";
    return null;
  }

  /** Elige la altura (ft) más representativa por nivel: la más baja de ese grupo. */
  function heightsByLevel(layers) {
    const out = { low: null, mid: null, high: null };
    for (const layer of layers || []) {
      const level = layerLevel(layer);
      const ft = feetLabel(layer);
      if (!level || ft == null) continue;
      const n = Number(ft);
      if (out[level] == null || n < out[level]) out[level] = n;
    }
    return out;
  }

  function heightBadge(ft, level, layerHint) {
    if (ft == null) return "";
    const tip = `${level} · ${ft} ft${layerHint ? " · " + layerHint : ""}`;
    return `<div class="plot-layer plot-layer-${level}" title="${S().esc(tip)}">
      <span class="plot-layer-ft">${S().esc(String(ft))}</span>
    </div>`;
  }

  function buildStationHtml(obs, options) {
    const scale = Math.max(0.4, Math.min(1.5, Number(options && options.scale) || 0.75));
    if (obs.nil) {
      return `<div class="plot plot-nil">NIL</div>`;
    }

    const dir = obs.wind_dir != null ? Number(obs.wind_dir) : 0;
    const nCode = codeOr(obs.total_cloud, "9999");
    const aCode = codeOr(obs.tendency_char, "9999");
    const wwHtml = obs.present_weather ? WW().wwSymbolHtml(obs.present_weather) : "";
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const heights = heightsByLevel(layers);

    return `
      <div class="plot" style="--plot-scale:${scale}">
        <div class="plot-inner">
        ${
          hasCloudCode(obs.ch)
            ? png(`simbolos/CH${obs.ch}.png`, "plot-ch", "", S().cloudLabel("CH", obs.ch))
            : ""
        }
        ${
          hasCloudCode(obs.cm)
            ? png(`simbolos/CM${obs.cm}.png`, "plot-cm", "", S().cloudLabel("CM", obs.cm))
            : ""
        }
        ${heightBadge(heights.mid, "media", "sección 3")}
        <img class="plot-barb" src="${IMG}/${barbSrc(obs)}" alt=""
             style="transform: rotate(${dir}deg);" draggable="false" />
        ${png(`simbolos/N${nCode}.png`, "plot-n", "", `N=${nCode}`)}
        ${wwHtml}
        ${
          obs.temp_c != null
            ? `<span class="plot-temp">${S().esc(fmtTemp(obs.temp_c))}</span>`
            : ""
        }
        ${
          obs.dewpoint_c != null
            ? `<span class="plot-td">${S().esc(fmtTemp(obs.dewpoint_c))}</span>`
            : ""
        }
        ${
          obs.pressure_plot
            ? `<span class="plot-pres">${S().esc(obs.pressure_plot)}</span>`
            : ""
        }
        ${png(`simbolos/a${aCode}.png`, "plot-a", "", `a=${aCode}`)}
        ${
          obs.tendency_val
            ? `<span class="plot-app">${S().esc(obs.tendency_val)}</span>`
            : ""
        }
        ${
          obs.visibility
            ? `<span class="plot-vis">${S().esc(obs.visibility)}</span>`
            : ""
        }
        ${
          obs.cloud_base_h
            ? `<span class="plot-h">${S().esc(obs.cloud_base_h)}</span>`
            : ""
        }
        ${
          hasImgCode(obs.nh)
            ? `<span class="plot-nh">${S().esc(obs.nh)}</span>`
            : ""
        }
        ${
          hasCloudCode(obs.cl)
            ? png(`simbolos/CL${obs.cl}.png`, "plot-cl", "", S().cloudLabel("CL", obs.cl))
            : ""
        }
        ${heightBadge(heights.low, "baja", "sección 3")}
        </div>
      </div>
    `;
  }

  function cloudSectionHtml(obs) {
    const lines = [];
    lines.push(
      `<b>Cobertura N:</b> ${S().esc(obs.total_cloud ?? "—")} oktas · <b>h:</b> ${S().esc(obs.cloud_base_h ?? "—")}`
    );
    if (obs.nh || obs.cl || obs.cm || obs.ch) {
      lines.push(
        `<b>Sección 1 · 8NhCLCMCH:</b> Nh=${S().esc(obs.nh ?? "/")} CL=${S().esc(obs.cl ?? "/")} CM=${S().esc(obs.cm ?? "/")} CH=${S().esc(obs.ch ?? "/")}`
      );
      if (obs.cl && obs.cl !== "0") lines.push(S().cloudLabel("CL", obs.cl));
      if (obs.cm && obs.cm !== "0") lines.push(S().cloudLabel("CM", obs.cm));
      if (obs.ch && obs.ch !== "0") lines.push(S().cloudLabel("CH", obs.ch));
    } else {
      lines.push("<b>Sección 1 · 8NhCLCMCH:</b> (ausente)");
    }

    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const heights = heightsByLevel(layers);
    if (heights.high != null || heights.mid != null || heights.low != null) {
      lines.push("<b>Alturas sec.3 (ft):</b>");
      if (heights.high != null) lines.push(`&nbsp;&nbsp;Alta: ${heights.high} ft`);
      if (heights.mid != null) lines.push(`&nbsp;&nbsp;Media: ${heights.mid} ft`);
      if (heights.low != null) lines.push(`&nbsp;&nbsp;Baja: ${heights.low} ft`);
    }
    if (layers.length) {
      lines.push(`<b>Capas 8NsChshs (${layers.length}):</b>`);
      layers.forEach((layer, i) => {
        const ft = feetLabel(layer);
        const bits = [
          ft != null ? `${ft} ft` : null,
          layer.genus_name || (layer.genus != null ? `C=${layer.genus}` : null),
          layer.ns != null ? `Ns=${layer.ns}` : null,
        ];
        lines.push(`&nbsp;&nbsp;${i + 1}. ${S().esc(bits.filter(Boolean).join(" · "))}`);
      });
    } else {
      lines.push("<b>Sección 3 · capas:</b> (ausente)");
    }
    return lines.join("<br/>");
  }

  function fmtVisibility(obs) {
    if (obs.visibility_m != null) {
      const m = obs.visibility_m;
      if (m >= 1000) {
        const km = m / 1000;
        const kmTxt = Number.isInteger(km) ? String(km) : km.toFixed(1);
        return `${m} m (${kmTxt} km)`;
      }
      return `${m} m`;
    }
    if (obs.visibility) return `código VV ${obs.visibility}`;
    return null;
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
    const vis = fmtVisibility(obs);
    if (vis) lines.push(`<b>Visibilidad horizontal:</b> ${S().esc(vis)}`);
    if (obs.present_weather) {
      const decoded = WW().wwText(obs.present_weather);
      lines.push(`<b>Tiempo presente:</b> ${S().esc(decoded || obs.present_weather)}`);
    }
    lines.push(cloudSectionHtml(obs));
    lines.push(`<div class="synop-line">${S().esc(obs.raw)}</div>`);
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const layerRows = layers.length
      ? layers.map((layer, i) => {
          const ft = feetLabel(layer);
          const val = [
            ft != null ? `${ft} ft` : "altura —",
            layer.genus_name || (layer.genus != null ? `C=${layer.genus}` : null),
            layer.ns != null ? `Ns=${layer.ns}` : null,
            layer.raw || "",
          ]
            .filter(Boolean)
            .join(" · ");
          return [`Capa sec.3 #${i + 1}`, val];
        })
      : [["Capas sec.3", "(ausente)"]];

    const wwDecoded = obs.present_weather
      ? WW().wwText(obs.present_weather) || obs.present_weather
      : "—";

    const rows = [
      ["Estación", `${obs.omm} — ${obs.nombre || ""}`],
      ["UTC", obs.utc || "—"],
      ["Temperatura", obs.temp_c != null ? `${fmtTemp(obs.temp_c)} °C` : "—"],
      ["Punto de rocío", obs.dewpoint_c != null ? `${fmtTemp(obs.dewpoint_c)} °C` : "—"],
      ["Presión MSL", obs.msl_pressure != null ? `${obs.msl_pressure.toFixed(1)} hPa` : "—"],
      ["Presión estación", obs.station_pressure != null ? `${obs.station_pressure.toFixed(1)} hPa` : "—"],
      [
        "Viento",
        `${obs.wind_dir != null ? obs.wind_dir + "°" : "—"} · ${
          obs.wind_speed_kt != null ? obs.wind_speed_kt + " kt" : "—"
        }`,
      ],
      ["N (cobertura)", obs.total_cloud ?? "—"],
      ["Visibilidad VV", obs.visibility ?? "—"],
      ["Visibilidad horizontal", fmtVisibility(obs) || "—"],
      ["h (base, sec.1)", obs.cloud_base_h ?? "—"],
      ["Tiempo presente", wwDecoded],
      ["Nh / CL / CM / CH (sec.1)", `${obs.nh ?? "/"} ${obs.cl ?? "/"} ${obs.cm ?? "/"} ${obs.ch ?? "/"}`],
      ...layerRows,
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

  global.StationPlot = {
    buildStationHtml,
    buildStationSvg: buildStationHtml,
    hoverHtml,
    detailHtml,
    cloudSectionHtml,
    fmtTemp,
  };
})(window);
