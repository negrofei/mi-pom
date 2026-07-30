/**
 * Serie temporal 24 h por estación: T/Td, barbas, nubes bajas, visibilidad, ww.
 */
(function (global) {
  const S = () => global.SynopSymbols;
  const WW = () => global.PresentWeather;
  const IMG = "/img";
  const LOW_GENUS = new Set(["6", "7", "8", "9"]);

  function fmtTemp(v) {
    if (v == null || Number.isNaN(Number(v))) return null;
    return (Math.round(Number(v) * 10) / 10).toFixed(1).replace(/\.0$/, "");
  }

  function feetLabel(layer) {
    if (!layer) return null;
    if (layer.height_ft != null) return layer.height_ft;
    if (layer.height_m != null) return Math.round((layer.height_m * 3.28084) / 100) * 100;
    return null;
  }

  // Tabla 1600 (h): altura aproximada de base en pies (punto medio del rango)
  const H_BASE_FT = {
    "0": 80,
    "1": 250,
    "2": 500,
    "3": 800,
    "4": 1500,
    "5": 2600,
    "6": 4100,
    "7": 5700,
    "8": 7400,
    "9": 8200,
  };

  function lowestCloud(obs) {
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const candidates = layers.filter((l) => feetLabel(l) != null);
    const low = candidates.filter((l) => LOW_GENUS.has(String(l.genus)));
    const pool = low.length ? low : candidates;
    if (pool.length) {
      pool.sort((a, b) => feetLabel(a) - feetLabel(b));
      const best = pool[0];
      return {
        height_ft: feetLabel(best),
        cover: best.ns ?? obs.nh ?? obs.total_cloud ?? null,
        label: best.genus_name || (best.genus != null ? `C=${best.genus}` : null),
        raw: best.raw || null,
      };
    }
    // Fallback: grupo 1 (Nh + h)
    const h = obs.cloud_base_h != null ? String(obs.cloud_base_h) : null;
    const ft = h != null && H_BASE_FT[h] != null ? H_BASE_FT[h] : null;
    if (ft == null && obs.nh == null && obs.total_cloud == null) {
      return { height_ft: null, cover: null, label: null };
    }
    return {
      height_ft: ft,
      cover: obs.nh ?? obs.total_cloud ?? null,
      label: h != null ? `h=${h} (sec.1)` : "sec.1",
      raw: null,
    };
  }

  function visText(obs) {
    if (obs.visibility_m != null) {
      const m = obs.visibility_m;
      if (m >= 1000) {
        const km = m / 1000;
        const kmTxt = Number.isInteger(km) ? String(km) : km.toFixed(1);
        return `${m} m (${kmTxt} km)`;
      }
      return `${m} m`;
    }
    return obs.visibility ? `VV ${obs.visibility}` : null;
  }

  function hourLabel(obs) {
    if (obs.obs_iso) {
      const d = new Date(obs.obs_iso);
      if (!Number.isNaN(d.getTime())) {
        return `${String(d.getUTCHours()).padStart(2, "0")}z`;
      }
    }
    if (obs.utc && obs.utc.length >= 13) return `${obs.utc.slice(11, 13)}z`;
    return obs.hour != null ? `${String(obs.hour).padStart(2, "0")}z` : "—";
  }

  function tip(title, lines) {
    // &#10; mantiene saltos de línea seguros dentro de atributos HTML
    return S()
      .esc([title].concat(lines || []).filter(Boolean).join("\n"))
      .replace(/\n/g, "&#10;");
  }

  function renderSeriesChart(container, payload) {
    const points = (payload.points || []).filter((p) => !p.nil);
    container.innerHTML = "";

    if (!points.length) {
      container.innerHTML = `<div class="ts-empty">No hay observaciones en las últimas ${payload.hours || 24} h.</div>`;
      return;
    }

    const W = Math.max(720, points.length * 36 + 80);
    const padL = 58;
    const padR = 20;
    const padT = 28;
    const rowH = { temp: 120, wind: 56, cloud: 96, vis: 70, ww: 48 };
    const gap = 18;
    let y = padT;
    const rows = [
      { key: "temp", label: "T / Td", y: y, h: rowH.temp },
    ];
    y += rowH.temp + gap;
    rows.push({ key: "wind", label: "Viento", y: y, h: rowH.wind });
    y += rowH.wind + gap;
    rows.push({ key: "cloud", label: "Nubes (log)", y: y, h: rowH.cloud });
    y += rowH.cloud + gap;
    rows.push({ key: "vis", label: "Visibilidad", y: y, h: rowH.vis });
    y += rowH.vis + gap;
    rows.push({ key: "ww", label: "Tiempo presente", y: y, h: rowH.ww });
    const H = y + rowH.ww + 36;

    const xs = points.map((_, i) => padL + ((W - padL - padR) * (i + 0.5)) / points.length);
    const xAt = (i) => xs[i];

    const temps = points.map((p) => p.temp_c).filter((v) => v != null);
    const tds = points.map((p) => p.dewpoint_c).filter((v) => v != null);
    const allT = temps.concat(tds);
    let tMin = allT.length ? Math.min(...allT) : 0;
    let tMax = allT.length ? Math.max(...allT) : 1;
    if (tMin === tMax) {
      tMin -= 1;
      tMax += 1;
    }
    const tPad = (tMax - tMin) * 0.12 || 1;
    tMin -= tPad;
    tMax += tPad;
    const tempRow = rows[0];
    const ty = (v) =>
      tempRow.y + tempRow.h - ((v - tMin) / (tMax - tMin)) * tempRow.h;

    // Escala log fija 100–10000 ft: resalta bases bajas; ≥10000 ft va al tope
    const CLOUD_FLOOR_FT = 100;
    const CLOUD_CEIL_FT = 10000;
    const clouds = points.map(lowestCloud);
    const cloudRow = rows[2];
    const logCloud = (ft) => Math.log10(Math.max(CLOUD_FLOOR_FT, Math.min(CLOUD_CEIL_FT, Number(ft))));
    const logMin = Math.log10(CLOUD_FLOOR_FT);
    const logMax = Math.log10(CLOUD_CEIL_FT);
    const cy = (v) =>
      cloudRow.y + cloudRow.h - ((logCloud(v) - logMin) / (logMax - logMin)) * cloudRow.h;
    const cloudTicks = [100, 200, 500, 1000, 2000, 5000, 10000];

    const viss = points.map((p) => p.visibility_m).filter((v) => v != null);
    let vMin = viss.length ? Math.min(...viss) : 0;
    let vMax = viss.length ? Math.max(...viss) : 10000;
    if (vMin === vMax) {
      vMin = 0;
      vMax = vMax * 1.2 || 1000;
    }
    const visRow = rows[3];
    const vy = (v) =>
      visRow.y + visRow.h - ((v - vMin) / (vMax - vMin)) * visRow.h;

    function linePath(values, yFn) {
      let d = "";
      values.forEach((v, i) => {
        if (v == null) return;
        const cmd = d ? "L" : "M";
        d += `${cmd}${xAt(i).toFixed(1)},${yFn(v).toFixed(1)} `;
      });
      return d.trim();
    }

    const parts = [];
    parts.push(
      `<svg class="ts-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Serie temporal">`
    );

    // fondos de filas
    rows.forEach((r, idx) => {
      parts.push(
        `<rect class="ts-row-bg" x="${padL}" y="${r.y}" width="${W - padL - padR}" height="${r.h}" fill="${
          idx % 2 ? "rgba(11,95,138,0.04)" : "rgba(0,0,0,0.02)"
        }" />`
      );
      parts.push(
        `<text class="ts-row-label" x="8" y="${r.y + r.h / 2}" dominant-baseline="middle" font-size="11">${S().esc(
          r.label
        )}</text>`
      );
    });

    // horas
    points.forEach((p, i) => {
      const x = xAt(i);
      parts.push(
        `<text class="ts-hour" x="${x}" y="${padT - 10}" text-anchor="middle" font-size="10">${S().esc(
          hourLabel(p)
        )}</text>`
      );
      parts.push(
        `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - 28}" stroke="rgba(0,0,0,0.06)" />`
      );
    });

    // Temperatura / rocío
    const tPath = linePath(
      points.map((p) => p.temp_c),
      ty
    );
    const tdPath = linePath(
      points.map((p) => p.dewpoint_c),
      ty
    );
    if (tdPath) {
      parts.push(
        `<path d="${tdPath}" fill="none" stroke="#1565c0" stroke-width="2" class="ts-line-td" />`
      );
    }
    if (tPath) {
      parts.push(
        `<path d="${tPath}" fill="none" stroke="#c62828" stroke-width="2.2" class="ts-line-t" />`
      );
    }
    points.forEach((p, i) => {
      const x = xAt(i);
      if (p.temp_c != null) {
        parts.push(
          `<circle class="ts-hit ts-temp" cx="${x}" cy="${ty(p.temp_c)}" r="5" fill="#c62828" data-tip="${tip(
            "Temperatura",
            [`${fmtTemp(p.temp_c)} °C`, hourLabel(p), p.utc || ""]
          )}" />`
        );
      }
      if (p.dewpoint_c != null) {
        parts.push(
          `<circle class="ts-hit ts-td" cx="${x}" cy="${ty(p.dewpoint_c)}" r="4.5" fill="#1565c0" data-tip="${tip(
            "Temperatura de rocío",
            [`${fmtTemp(p.dewpoint_c)} °C`, hourLabel(p), p.utc || ""]
          )}" />`
        );
      }
    });
    // eje T
    parts.push(
      `<text x="${padL - 6}" y="${ty(tMax)}" text-anchor="end" font-size="9" fill="#666">${tMax.toFixed(
        0
      )}°</text>`
    );
    parts.push(
      `<text x="${padL - 6}" y="${ty(tMin)}" text-anchor="end" font-size="9" fill="#666">${tMin.toFixed(
        0
      )}°</text>`
    );

    // Viento
    const windRow = rows[1];
    points.forEach((p, i) => {
      const x = xAt(i);
      const barb = p.wind_barb || "0";
      const dir = p.wind_dir != null ? Number(p.wind_dir) : 0;
      const y0 = windRow.y + windRow.h / 2;
      const tipTxt = tip("Viento", [
        p.wind_dir != null ? `Dirección: ${p.wind_dir}°` : "Dirección: —",
        p.wind_speed_kt != null ? `Velocidad: ${p.wind_speed_kt} kt` : "Velocidad: —",
        hourLabel(p),
      ]);
      parts.push(
        `<g class="ts-hit ts-wind" transform="translate(${x},${y0}) rotate(${dir})" data-tip="${tipTxt}">
          <circle r="18" fill="transparent" />
          <image href="${IMG}/barbs/barb_${barb}.png" xlink:href="${IMG}/barbs/barb_${barb}.png" x="-18" y="-18" width="36" height="36" />
        </g>`
      );
    });

    // Nubes: escala log 100–10000 ft (valores >10000 se grafican en el tope)
    cloudTicks.forEach((ft) => {
      const yy = cy(ft);
      parts.push(
        `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="rgba(93,109,126,0.18)" stroke-dasharray="3 3" />`
      );
      parts.push(
        `<text x="${padL - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="#666">${ft}</text>`
      );
    });
    points.forEach((p, i) => {
      const x = xAt(i);
      const c = clouds[i];
      if (c.height_ft == null) return;
      const capped = c.height_ft > CLOUD_CEIL_FT;
      const y1 = cy(c.height_ft);
      const cover = c.cover != null ? String(c.cover) : "9999";
      const tipTxt = tip("Nubosidad más baja", [
        `Base: ${c.height_ft} ft${capped ? ` (≥${CLOUD_CEIL_FT} ft → tope del gráfico)` : ""}`,
        c.cover != null ? `Cobertura Ns/N: ${c.cover}/8` : null,
        c.label,
        hourLabel(p),
      ]);
      parts.push(
        `<g class="ts-hit ts-cloud" data-tip="${tipTxt}">
          <line x1="${x}" y1="${cloudRow.y + cloudRow.h}" x2="${x}" y2="${y1}" stroke="#5d6d7e" stroke-width="2" />
          <circle cx="${x}" cy="${y1}" r="3.5" fill="${capped ? "#9aa5b1" : "#5d6d7e"}" />
          <image href="${IMG}/simbolos/N${cover}.png" xlink:href="${IMG}/simbolos/N${cover}.png" x="${x - 8}" y="${y1 - 28}" width="16" height="16" />
          <rect x="${x - 12}" y="${y1 - 30}" width="24" height="${cloudRow.y + cloudRow.h - y1 + 32}" fill="transparent" />
        </g>`
      );
    });
    parts.push(
      `<text x="${padL - 6}" y="${cloudRow.y - 4}" text-anchor="end" font-size="8" fill="#888">ft log</text>`
    );

    // Visibilidad
    const visPath = linePath(
      points.map((p) => p.visibility_m),
      vy
    );
    if (visPath) {
      parts.push(
        `<path d="${visPath}" fill="none" stroke="#2e7d32" stroke-width="2" class="ts-line-vis" />`
      );
    }
    points.forEach((p, i) => {
      if (p.visibility_m == null) return;
      const x = xAt(i);
      parts.push(
        `<circle class="ts-hit ts-vis" cx="${x}" cy="${vy(p.visibility_m)}" r="4.5" fill="#2e7d32" data-tip="${tip(
          "Visibilidad horizontal",
          [visText(p), `VV=${p.visibility ?? "—"}`, hourLabel(p)]
        )}" />`
      );
    });

    // Tiempo presente
    const wwRow = rows[4];
    points.forEach((p, i) => {
      if (!p.present_weather) return;
      const x = xAt(i);
      const code = String(p.present_weather).padStart(2, "0");
      const decoded = WW().wwText(code) || code;
      const tipTxt = tip("Tiempo presente", [decoded, `ww=${code}`, hourLabel(p)]);
      parts.push(
        `<g class="ts-hit ts-ww" data-tip="${tipTxt}">
          <rect x="${x - 14}" y="${wwRow.y + 6}" width="28" height="28" fill="transparent" />
          <image href="${IMG}/simbolos/${code}.png" xlink:href="${IMG}/simbolos/${code}.png" x="${x - 12}" y="${wwRow.y + 8}" width="24" height="24" />
        </g>`
      );
    });

    parts.push(`</svg>`);

    const legend = `
      <div class="ts-legend">
        <span class="ts-leg t">Temperatura</span>
        <span class="ts-leg td">Rocío</span>
        <span class="ts-leg wind">Barbas de viento</span>
        <span class="ts-leg cloud">Nubes (log 100–10000 ft)</span>
        <span class="ts-leg vis">Visibilidad</span>
        <span class="ts-leg ww">Tiempo presente</span>
      </div>`;

    container.innerHTML = legend + parts.join("");

    // Hover tip dedicado
    let tipEl = document.getElementById("tsHoverTip");
    if (!tipEl) {
      tipEl = document.createElement("div");
      tipEl.id = "tsHoverTip";
      tipEl.className = "ts-hover-tip hidden";
      document.body.appendChild(tipEl);
    }

    container.querySelectorAll(".ts-hit").forEach((el) => {
      el.addEventListener("mouseenter", (e) => {
        const raw = el.getAttribute("data-tip") || "";
        tipEl.textContent = raw;
        tipEl.classList.remove("hidden");
        moveTip(e);
      });
      el.addEventListener("mousemove", moveTip);
      el.addEventListener("mouseleave", () => tipEl.classList.add("hidden"));
    });

    function moveTip(e) {
      const x = e.clientX + 12;
      const y = e.clientY + 12;
      tipEl.style.left = `${x}px`;
      tipEl.style.top = `${y}px`;
    }
  }

  async function loadAndRender(container, omm, hourParam) {
    container.innerHTML = `<div class="ts-loading">Cargando serie temporal…</div>`;
    const q = new URLSearchParams({ hours: "24", nil: "0" });
    if (hourParam) q.set("hour", hourParam);
    const res = await fetch(`/api/synops/${encodeURIComponent(omm)}?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar serie");
    renderSeriesChart(container, data);
    return data;
  }

  global.TimeSeries = { renderSeriesChart, loadAndRender, lowestCloud };
})(window);
