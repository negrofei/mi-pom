/**
 * Serie temporal 24 h por estación: T/Td, barbas, nubes (contourf), visibilidad, ww.
 */
(function (global) {
  const S = () => global.SynopSymbols;
  const WW = () => global.PresentWeather;
  const IMG = "/img";

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

  // Espesores típicos (m) para renderizar — media del rango operativo
  const THICKNESS_M = {
    St: 300,
    Sc: 600,
    Cu_hum: 300,
    Cu_med: 1000,
    Cu_con: 3000,
    Ac: 500,
    As: 1800,
    Ns: 5000,
    Ci: 500,
    Cc: 500,
    Cs: 1000,
    Cb: 9000,
  };

  const M_TO_FT = 3.28084;

  /** Espesor (m) desde género sec.3 (C = 0..9). */
  function thicknessFromGenus(genus) {
    const g = genus != null ? String(genus) : "";
    const map = {
      "0": THICKNESS_M.Ci,
      "1": THICKNESS_M.Cc,
      "2": THICKNESS_M.Cs,
      "3": THICKNESS_M.Ac,
      "4": THICKNESS_M.As,
      "5": THICKNESS_M.Ns,
      "6": THICKNESS_M.Sc,
      "7": THICKNESS_M.St,
      "8": THICKNESS_M.Cu_med, // Cu sin más detalle → mediocris
      "9": THICKNESS_M.Cb,
    };
    return map[g] != null ? map[g] : THICKNESS_M.Sc;
  }

  /** Espesor (m) desde códigos sec.1 CL / CM / CH. */
  function thicknessFromSection1(kind, code) {
    const c = code != null ? String(code) : "";
    if (!c || c === "/" || c === "0") return null;
    if (kind === "CL") {
      if (c === "1") return THICKNESS_M.Cu_hum;
      if (c === "2") return THICKNESS_M.Cu_med; // congestus → Cu_con si se distingue luego
      if (c === "3" || c === "9") return THICKNESS_M.Cb;
      if (c === "4" || c === "5" || c === "8") return THICKNESS_M.Sc;
      if (c === "6" || c === "7") return THICKNESS_M.St;
    }
    if (kind === "CM") {
      if (c === "1") return THICKNESS_M.As;
      if (c === "2") return THICKNESS_M.Ns; // As opacus / Ns
      if (c === "3" || c === "4" || c === "5" || c === "7") return THICKNESS_M.Ac;
      if (c === "6") return THICKNESS_M.Ac;
      if (c === "8" || c === "9") return THICKNESS_M.Ac;
    }
    if (kind === "CH") {
      if (c === "1" || c === "2" || c === "3" || c === "4") return THICKNESS_M.Ci;
      if (c === "5" || c === "6" || c === "7" || c === "8") return THICKNESS_M.Cs;
      if (c === "9") return THICKNESS_M.Cc;
    }
    return null;
  }

  function metersToFeet(m) {
    return Math.round((Number(m) * M_TO_FT) / 50) * 50; // redondeo a 50 ft
  }

  /** cb | tcu | null a partir de género sec.3 / CL sec.1 / nombre. */
  function convectiveKind({ genus, genus_name, cl, label, raw }) {
    const name = String(genus_name || label || "").toLowerCase();
    const tok = String(raw || "").toUpperCase();
    if (
      String(genus) === "9" ||
      cl === "3" ||
      cl === "9" ||
      /\bcb\b|cumulonimbus/.test(name) ||
      /\bCB\b/.test(tok)
    ) {
      return "cb";
    }
    if (
      cl === "2" ||
      /\btcu\b|towering|torre|congestus/.test(name) ||
      /\bTCU\b/.test(tok)
    ) {
      return "tcu";
    }
    return null;
  }

  function makeCloudBand({ base_ft, thickness_m, cover, label, raw, ns, kind, convective }) {
    const thickFt = Math.max(100, metersToFeet(thickness_m));
    return {
      height_ft: base_ft,
      top_ft: base_ft + thickFt,
      thickness_m,
      thickness_ft: thickFt,
      cover: Math.max(0, Math.min(8, cover)),
      label,
      raw: raw || null,
      ns,
      kind: kind || null,
      convective: convective || null,
    };
  }

  /**
   * Capas con base + tope (base + espesor típico según tipo).
   * Prioridad: grupos 8NsChshs (sec.3); si no hay, sec.1 Nh+h+CL.
   */
  function allCloudLayers(obs) {
    if (!obs || obs.missing) return [];
    const out = [];
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    layers.forEach((l) => {
      const ft = feetLabel(l);
      if (ft == null) return;
      const cover = l.ns != null && l.ns !== "/" ? Number(l.ns) : null;
      if (cover == null || Number.isNaN(cover)) return;
      const thick = thicknessFromGenus(l.genus);
      const label = l.genus_name || (l.genus != null ? `C=${l.genus}` : null);
      out.push(
        makeCloudBand({
          base_ft: ft,
          thickness_m: thick,
          cover,
          label,
          raw: l.raw || null,
          ns: l.ns,
          kind: "sec.3",
          convective: convectiveKind({
            genus: l.genus,
            genus_name: l.genus_name,
            label,
            raw: l.raw,
          }),
        })
      );
    });

    if (!out.length) {
      const h = obs.cloud_base_h != null ? String(obs.cloud_base_h) : null;
      const ft = h != null && H_BASE_FT[h] != null ? H_BASE_FT[h] : null;
      const coverRaw = obs.nh ?? obs.total_cloud;
      const cover =
        coverRaw != null && coverRaw !== "/" ? Number(coverRaw) : null;
      const thick =
        thicknessFromSection1("CL", obs.cl) ||
        thicknessFromSection1("CM", obs.cm) ||
        THICKNESS_M.Sc;
      if (ft != null && cover != null && !Number.isNaN(cover)) {
        const cl = obs.cl != null ? String(obs.cl) : null;
        const label =
          cl != null
            ? `CL=${cl} · h=${h} (sec.1)`
            : h != null
              ? `h=${h} (sec.1)`
              : "sec.1";
        out.push(
          makeCloudBand({
            base_ft: ft,
            thickness_m: thick,
            cover,
            label,
            raw: null,
            ns: String(coverRaw),
            kind: "sec.1",
            convective: convectiveKind({ cl, label }),
          })
        );
      }
    }
    out.sort((a, b) => a.height_ft - b.height_ft);
    return out;
  }

  function lowestCloud(obs) {
    const layers = allCloudLayers(obs);
    if (!layers.length) return { height_ft: null, cover: null, label: null };
    const best = layers[0];
    return {
      height_ft: best.height_ft,
      cover: best.ns ?? best.cover,
      label: best.label,
      raw: best.raw,
      top_ft: best.top_ft,
      thickness_m: best.thickness_m,
    };
  }

  // Escala vertical: Cb puede superar 10 kft (base + ~9 km)
  const CLOUD_FLOOR_FT = 0;
  const CLOUD_CEIL_FT = 35000;

  /**
   * Campo 2D suavizado: cada capa pinta [base, base+espesor] con oktas.
   * Suavizado leve en el tiempo; bordes verticales suaves (±1 bin).
   */
  function buildCloudField(points, { ny = 96, sigmaX = 0.7 } = {}) {
    const nx = points.length;
    const field = Array.from({ length: ny }, () => new Float32Array(nx));
    if (!nx) return field;

    function yIndex(ft) {
      const clamped = Math.max(CLOUD_FLOOR_FT, Math.min(CLOUD_CEIL_FT, Number(ft)));
      const t = (clamped - CLOUD_FLOOR_FT) / (CLOUD_CEIL_FT - CLOUD_FLOOR_FT);
      return Math.max(0, Math.min(ny - 1, Math.round(t * (ny - 1))));
    }

    const tmp = Array.from({ length: ny }, () => new Float32Array(nx));
    points.forEach((p, i) => {
      allCloudLayers(p).forEach((layer) => {
        const yLo = yIndex(layer.height_ft);
        const yHi = yIndex(layer.top_ft != null ? layer.top_ft : layer.height_ft);
        const lo = Math.min(yLo, yHi);
        const hi = Math.max(yLo, yHi);
        const cover = layer.cover;
        for (let y = lo; y <= hi; y++) {
          // Soft-edge vertical (1 bin) para que no se vea pixelado
          let edge = 1;
          if (hi > lo) {
            if (y === lo || y === hi) edge = 0.65;
          }
          tmp[y][i] = Math.max(tmp[y][i], cover * edge);
        }
      });
    });

    const rx = Math.ceil(sigmaX * 3);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let acc = 0;
        let wsum = 0;
        for (let dx = -rx; dx <= rx; dx++) {
          const xi = x + dx;
          if (xi < 0 || xi >= nx) continue;
          const w = Math.exp(-(dx * dx) / (2 * sigmaX * sigmaX));
          acc += tmp[y][xi] * w;
          wsum += w;
        }
        field[y][x] = wsum ? Math.min(8, acc / wsum) : 0;
      }
    }
    return field;
  }

  function cloudFieldToDataUrl(field, widthPx, heightPx) {
    const ny = field.length;
    const nx = field[0] ? field[0].length : 0;
    if (!nx || !ny) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(widthPx));
    canvas.height = Math.max(1, Math.round(heightPx));
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(canvas.width, canvas.height);
    const data = img.data;

    for (let py = 0; py < canvas.height; py++) {
      // y=0 arriba (nubes altas); field[0] = piso (abajo) → invertir
      const fy = ((canvas.height - 1 - py) / Math.max(1, canvas.height - 1)) * (ny - 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(ny - 1, y0 + 1);
      const ty = fy - y0;
      for (let px = 0; px < canvas.width; px++) {
        const fx = (px / Math.max(1, canvas.width - 1)) * (nx - 1);
        const x0 = Math.floor(fx);
        const x1 = Math.min(nx - 1, x0 + 1);
        const tx = fx - x0;
        const v00 = field[y0][x0];
        const v10 = field[y0][x1];
        const v01 = field[y1][x0];
        const v11 = field[y1][x1];
        const v =
          v00 * (1 - tx) * (1 - ty) +
          v10 * tx * (1 - ty) +
          v01 * (1 - tx) * ty +
          v11 * tx * ty;
        const oktas = Math.max(0, Math.min(8, v));
        const i = (py * canvas.width + px) * 4;
        if (oktas < 0.08) {
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 0;
        } else {
          // Escala de grises: más oktas → más oscuro
          const g = Math.round(245 - (oktas / 8) * 200);
          const a = Math.round(40 + (oktas / 8) * 200);
          data[i] = g;
          data[i + 1] = g;
          data[i + 2] = g;
          data[i + 3] = a;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
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
    if (obs && obs.slot_label) return obs.slot_label;
    if (obs && obs.obs_iso) {
      const d = new Date(obs.obs_iso);
      if (!Number.isNaN(d.getTime())) {
        return `${String(d.getUTCHours()).padStart(2, "0")}z`;
      }
    }
    if (obs && obs.utc && obs.utc.length >= 13) return `${obs.utc.slice(11, 13)}z`;
    return obs && obs.hour != null ? `${String(obs.hour).padStart(2, "0")}z` : "—";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function parseHourKey(key) {
    if (!key || String(key).length < 10) return null;
    const s = String(key);
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const h = Number(s.slice(8, 10));
    if ([y, m, d, h].some((v) => Number.isNaN(v))) return null;
    return new Date(Date.UTC(y, m - 1, d, h));
  }

  function formatHourKey(dt) {
    return (
      String(dt.getUTCFullYear()) +
      pad2(dt.getUTCMonth() + 1) +
      pad2(dt.getUTCDate()) +
      pad2(dt.getUTCHours())
    );
  }

  /** 24 (o N) horas fijas hasta `until`; sin dato = hueco vacío. */
  function alignPointsToSlots(rawPoints, untilKey, hours) {
    const n = Math.max(1, Math.min(Number(hours) || 24, 72));
    let end = parseHourKey(untilKey);
    if (!end || Number.isNaN(end.getTime())) {
      const now = new Date();
      end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours())
      );
    }
    const byKey = new Map();
    (rawPoints || []).forEach((p) => {
      if (!p || p.nil) return;
      let key = p.hour_key;
      if (!key && p.obs_iso) {
        const dt = new Date(p.obs_iso);
        if (!Number.isNaN(dt.getTime())) key = formatHourKey(dt);
      }
      if (!key) return;
      byKey.set(key, p);
    });

    const slots = [];
    for (let i = n - 1; i >= 0; i--) {
      const dt = new Date(end.getTime() - i * 3600 * 1000);
      const hour_key = formatHourKey(dt);
      const slot_label = `${pad2(dt.getUTCHours())}z`;
      const obs = byKey.get(hour_key);
      if (!obs) {
        slots.push({
          missing: true,
          hour_key,
          slot_label,
          obs_iso: dt.toISOString().replace(/\.\d{3}Z$/, "Z"),
        });
      } else {
        slots.push({ ...obs, missing: false, slot_label, hour_key });
      }
    }
    return slots;
  }

  function tip(title, lines) {
    // &#10; mantiene saltos de línea seguros dentro de atributos HTML
    return S()
      .esc([title].concat(lines || []).filter(Boolean).join("\n"))
      .replace(/\n/g, "&#10;");
  }

  function renderSeriesChart(container, payload) {
    const observed = (payload.points || []).filter((p) => !p.nil);
    const hours = payload.hours || 24;
    const points = alignPointsToSlots(observed, payload.until, hours);
    container.innerHTML = "";

    const themeCss = getComputedStyle(document.documentElement);
    const axisInk = (themeCss.getPropertyValue("--ink-muted") || "#666").trim() || "#666";
    const hourInk = (themeCss.getPropertyValue("--ink") || "#556").trim() || "#556";
    const hourMiss = (themeCss.getPropertyValue("--ink-muted") || "#b0b6bd").trim() || "#b0b6bd";
    const gridStroke = (themeCss.getPropertyValue("--chart-grid") || "rgba(0,0,0,0.08)").trim();

    const W = Math.max(720, points.length * 36 + 90);
    const labelX = 14;
    const padL = 72;
    const padR = 20;
    const padT = 28;
    const rowH = { temp: 130, wind: 56, cloud: 150, vis: 96, ww: 48 };
    const gap = 18;
    let y = padT;
    const rows = [
      { key: "temp", label: "T / Td", y: y, h: rowH.temp },
    ];
    y += rowH.temp + gap;
    rows.push({ key: "wind", label: "Viento", y: y, h: rowH.wind });
    y += rowH.wind + gap;
    rows.push({ key: "cloud", label: "Nubes (ft)", y: y, h: rowH.cloud });
    y += rowH.cloud + gap;
    rows.push({ key: "vis", label: "Visibilidad", y: y, h: rowH.vis });
    y += rowH.vis + gap;
    rows.push({ key: "ww", label: "Tiempo presente", y: y, h: rowH.ww });
    const H = y + rowH.ww + 36;

    const xs = points.map((_, i) => padL + ((W - padL - padR) * (i + 0.5)) / points.length);
    const xAt = (i) => xs[i];
    const colW = points.length > 1 ? (W - padL - padR) / points.length : 28;

    const temps = points.map((p) => (p.missing ? null : p.temp_c)).filter((v) => v != null);
    const tds = points.map((p) => (p.missing ? null : p.dewpoint_c)).filter((v) => v != null);
    const allT = temps.concat(tds);
    const dataTMin = allT.length ? Math.min(...allT) : 0;
    const dataTMax = allT.length ? Math.max(...allT) : 1;
    let tMin = dataTMin;
    let tMax = dataTMax;
    if (tMin === tMax) {
      tMin -= 1;
      tMax += 1;
    }
    // Amplitud térmica (solo T) define el paso de marcas; el eje cubre T y Td
    const tOnlyMin = temps.length ? Math.min(...temps) : dataTMin;
    const tOnlyMax = temps.length ? Math.max(...temps) : dataTMax;
    const tAmpThermal = tOnlyMax - tOnlyMin;
    const tMajorStep = tAmpThermal < 10 ? 1 : 2;
    const tPad = (tMax - tMin) * 0.12 || 1;
    tMin -= tPad;
    tMax += tPad;
    const tempRow = rows[0];
    const ty = (v) =>
      tempRow.y + tempRow.h - ((v - tMin) / (tMax - tMin)) * tempRow.h;

    // Escala lineal 0–35000 ft (Cb puede subir mucho); bandas base→base+espesor
    const cloudRow = rows[2];
    const cy = (v) => {
      const clamped = Math.max(CLOUD_FLOOR_FT, Math.min(CLOUD_CEIL_FT, Number(v)));
      return (
        cloudRow.y +
        cloudRow.h -
        ((clamped - CLOUD_FLOOR_FT) / (CLOUD_CEIL_FT - CLOUD_FLOOR_FT)) * cloudRow.h
      );
    };
    const cloudTicks = [0, 5000, 10000, 15000, 20000, 25000, 30000, 35000];
    const cloudField = buildCloudField(points);
    const cloudImgW = Math.max(1, W - padL - padR);
    const cloudDataUrl = cloudFieldToDataUrl(cloudField, cloudImgW * 2, cloudRow.h * 2);

    // Visibilidad: lineal 0–10000 m + color por umbral
    const VIS_FLOOR_M = 0;
    const VIS_CEIL_M = 10000;
    const visRow = rows[3];
    const vy = (v) => {
      const clamped = Math.max(VIS_FLOOR_M, Math.min(VIS_CEIL_M, Number(v)));
      return (
        visRow.y +
        visRow.h -
        ((clamped - VIS_FLOOR_M) / (VIS_CEIL_M - VIS_FLOOR_M)) * visRow.h
      );
    };
    const visTicks = [0, 1000, 2000, 3000, 5000, 7000, 10000];
    function visColor(m) {
      const st = global.MetarPlot && global.MetarPlot.visStyle(m);
      if (st) return st.color;
      if (m == null) return "#90a4ae";
      return "#26a69a"; // >7000 m / sin umbral: teal
    }

    // Rompe la línea en huecos (horas sin dato)
    function linePath(values, yFn) {
      let d = "";
      let drawing = false;
      values.forEach((v, i) => {
        if (v == null) {
          drawing = false;
          return;
        }
        const cmd = drawing ? "L" : "M";
        d += `${cmd}${xAt(i).toFixed(1)},${yFn(v).toFixed(1)} `;
        drawing = true;
      });
      return d.trim();
    }

    const parts = [];
    parts.push(
      `<svg class="ts-svg" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Serie temporal">`
    );

    // fondos de filas + labels rotados 90° CCW
    rows.forEach((r, idx) => {
      parts.push(
        `<rect class="ts-row-bg" x="${padL}" y="${r.y}" width="${W - padL - padR}" height="${r.h}" fill="${
          idx % 2 ? "rgba(11,95,138,0.04)" : "rgba(0,0,0,0.02)"
        }" />`
      );
      const midY = r.y + r.h / 2;
      parts.push(
        `<text class="ts-row-label" x="${labelX}" y="${midY}" text-anchor="middle" dominant-baseline="middle" font-size="11" transform="rotate(-90 ${labelX} ${midY})">${S().esc(
          r.label
        )}</text>`
      );
    });

    // horas (siempre N slots; huecos sin dato quedan vacíos)
    points.forEach((p, i) => {
      const x = xAt(i);
      parts.push(
        `<text class="ts-hour${p.missing ? " ts-hour-missing" : ""}" x="${x}" y="${padT - 10}" text-anchor="middle" font-size="10" fill="${
          p.missing ? hourMiss : hourInk
        }" opacity="${p.missing ? "0.45" : "0.85"}">${S().esc(hourLabel(p))}</text>`
      );
      parts.push(
        `<line x1="${x}" y1="${padT}" x2="${x}" y2="${H - 28}" stroke="${gridStroke}" opacity="${
          p.missing ? "0.35" : "0.7"
        }" />`
      );
    });

    // Temperatura / rocío — marcas según amplitud térmica
    const tLo = Math.ceil(tMin);
    const tHi = Math.floor(tMax);
    for (let t = tLo; t <= tHi; t++) {
      const yy = ty(t);
      const isMajor = ((t % tMajorStep) + tMajorStep) % tMajorStep === 0;
      if (isMajor) {
        parts.push(
          `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${gridStroke}" />`
        );
        parts.push(
          `<line x1="${padL - 5}" y1="${yy}" x2="${padL}" y2="${yy}" stroke="${axisInk}" stroke-width="1.2" />`
        );
        parts.push(
          `<text x="${padL - 7}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${axisInk}">${t}°</text>`
        );
      } else if (tMajorStep > 1) {
        parts.push(
          `<line x1="${padL - 3}" y1="${yy}" x2="${padL}" y2="${yy}" stroke="#999" stroke-width="1" />`
        );
      }
    }

    const tPath = linePath(
      points.map((p) => (p.missing ? null : p.temp_c)),
      ty
    );
    const tdPath = linePath(
      points.map((p) => (p.missing ? null : p.dewpoint_c)),
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
      if (p.missing) return;
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

    // Viento
    const windRow = rows[1];
    points.forEach((p, i) => {
      if (p.missing) return;
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

    // Nubes: contourf en escala de grises (oktas) + marcas de capas
    if (cloudDataUrl) {
      parts.push(
        `<image class="ts-cloud-field" href="${cloudDataUrl}" xlink:href="${cloudDataUrl}" x="${padL}" y="${cloudRow.y}" width="${cloudImgW}" height="${cloudRow.h}" preserveAspectRatio="none" />`
      );
    }
    cloudTicks.forEach((ft) => {
      const yy = cy(ft);
      parts.push(
        `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${gridStroke}" stroke-dasharray="3 3" />`
      );
      parts.push(
        `<line x1="${padL - 5}" y1="${yy}" x2="${padL}" y2="${yy}" stroke="${axisInk}" stroke-width="1.2" />`
      );
      parts.push(
        `<text x="${padL - 7}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${axisInk}">${ft}</text>`
      );
    });
    points.forEach((p, i) => {
      if (p.missing) return;
      const layers = allCloudLayers(p);
      if (!layers.length) return;
      const x = xAt(i);
      const tipLines = layers.map((c) => {
        const top = c.top_ft != null ? c.top_ft : c.height_ft;
        return `${c.height_ft}–${top} ft · espesor ≈${c.thickness_m} m · ${c.cover}/8${
          c.label ? ` · ${c.label}` : ""
        }`;
      });
      const tipTxt = tip("Nubosidad (base + espesor típico)", tipLines.concat([hourLabel(p)]));
      // Marcas: espesor (rayita) + círculo de oktas SYNOP (N) en la base
      const marks = layers
        .map((c) => {
          const yBase = cy(c.height_ft);
          const yTop = cy(c.top_ft != null ? c.top_ft : c.height_ft);
          const yLo = Math.min(yBase, yTop);
          const yHi = Math.max(yBase, yTop);
          const nRaw =
            c.ns != null && c.ns !== "/" && !Number.isNaN(Number(c.ns))
              ? Number(c.ns)
              : Number(c.cover);
          const nCode =
            nRaw != null && !Number.isNaN(nRaw)
              ? String(Math.max(0, Math.min(9, Math.round(nRaw))))
              : "9999";
          const r = 5.5;
          const ink =
            c.convective === "cb"
              ? "#c62828"
              : c.convective === "tcu"
                ? "#ef6c00"
                : "#111";
          const oktas =
            S() && typeof S().cloudCoverSymbol === "function"
              ? S().cloudCoverSymbol(nCode === "9999" ? null : nCode, x, yBase, r, ink)
              : `<image href="${IMG}/simbolos/N${nCode}.png" xlink:href="${IMG}/simbolos/N${nCode}.png" x="${
                  x - r
                }" y="${yBase - r}" width="${r * 2}" height="${r * 2}" />`;
          return (
            `<line x1="${x}" y1="${yLo}" x2="${x}" y2="${yHi}" stroke="rgba(30,30,30,0.35)" stroke-width="1.2" />` +
            oktas
          );
        })
        .join("");
      parts.push(
        `<g class="ts-hit ts-cloud" data-tip="${tipTxt}">
          ${marks}
          <rect x="${x - 14}" y="${cloudRow.y}" width="28" height="${cloudRow.h}" fill="transparent" />
        </g>`
      );
    });

    // Bandas de umbral de visibilidad (fondo)
    const visBands = [
      { lo: 0, hi: 1000, color: "rgba(106,27,154,0.12)" },
      { lo: 1000, hi: 2000, color: "rgba(198,40,40,0.10)" },
      { lo: 3000, hi: 5000, color: "rgba(239,108,0,0.10)" },
      { lo: 5000, hi: 7000, color: "rgba(249,168,37,0.12)" },
    ];
    visBands.forEach((b) => {
      const yTop = vy(b.hi);
      const yBot = vy(b.lo);
      parts.push(
        `<rect x="${padL}" y="${yTop}" width="${W - padL - padR}" height="${Math.max(
          0,
          yBot - yTop
        )}" fill="${b.color}" />`
      );
    });
    visTicks.forEach((m) => {
      const yy = vy(m);
      parts.push(
        `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="${gridStroke}" stroke-dasharray="3 3" />`
      );
      parts.push(
        `<line x1="${padL - 5}" y1="${yy}" x2="${padL}" y2="${yy}" stroke="${axisInk}" stroke-width="1.2" />`
      );
      parts.push(
        `<text x="${padL - 7}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="9" fill="${axisInk}">${m}</text>`
      );
    });
    // Barras de color + línea
    points.forEach((p, i) => {
      if (p.missing || p.visibility_m == null) return;
      const x = xAt(i);
      const y1 = vy(p.visibility_m);
      const y0 = visRow.y + visRow.h;
      const bw = Math.max(8, colW * 0.55);
      const color = visColor(p.visibility_m);
      parts.push(
        `<rect class="ts-vis-bar" x="${x - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(
          1,
          y0 - y1
        )}" fill="${color}" opacity="0.55" rx="2" />`
      );
    });
    const visPath = linePath(
      points.map((p) => (p.missing ? null : p.visibility_m)),
      vy
    );
    if (visPath) {
      parts.push(
        `<path d="${visPath}" fill="none" stroke="#455a64" stroke-width="1.6" class="ts-line-vis" />`
      );
    }
    points.forEach((p, i) => {
      if (p.missing || p.visibility_m == null) return;
      const x = xAt(i);
      const capped = p.visibility_m > VIS_CEIL_M;
      const color = visColor(p.visibility_m);
      parts.push(
        `<circle class="ts-hit ts-vis" cx="${x}" cy="${vy(p.visibility_m)}" r="5" fill="${color}" stroke="#fff" stroke-width="1.2" data-tip="${tip(
          "Visibilidad horizontal",
          [
            visText(p),
            capped ? `(≥${VIS_CEIL_M} m → tope del gráfico)` : null,
            `VV=${p.visibility ?? "—"}`,
            hourLabel(p),
          ]
        )}" />`
      );
    });

    // Tiempo presente
    const wwRow = rows[4];
    points.forEach((p, i) => {
      if (p.missing || !p.present_weather) return;
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
        <span class="ts-leg cloud">Nubes (oktas · base+espesor, 0–35000 ft)</span>
        <span class="ts-leg vis">Visibilidad (color por umbral, 0–10000 m)</span>
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

  global.TimeSeries = {
    renderSeriesChart,
    loadAndRender,
    lowestCloud,
    allCloudLayers,
    thicknessFromGenus,
    thicknessFromSection1,
  };
})(window);
