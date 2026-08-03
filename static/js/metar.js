/**
 * Pestaña METAR / aviación:
 * - Mapa: resumen operativo desde SYNOP (vis, bases, fenómenos, ráfagas)
 * - Alertas SPECI desde AviationWeather
 */
(function (global) {
  const CAT = {
    VFR: { color: "#00aa00", label: "VFR", hint: "Techo > 3000 ft y vis > 8000 m" },
    MVFR: { color: "#0066ff", label: "MVFR", hint: "Techo 1000–3000 ft o vis 5000–8000 m" },
    IFR: { color: "#ff0000", label: "IFR", hint: "Techo 500–999 ft o vis 1500–5000 m" },
    LIFR: { color: "#ff00ff", label: "LIFR", hint: "Techo < 500 ft o vis < 1500 m" },
  };

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

  const WW = () => global.PresentWeather;

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

  function flightCategory(ceilingFt, visM) {
    const cats = [];
    if (ceilingFt != null) {
      if (ceilingFt < 500) cats.push("LIFR");
      else if (ceilingFt < 1000) cats.push("IFR");
      else if (ceilingFt <= 3000) cats.push("MVFR");
      else cats.push("VFR");
    }
    if (visM != null) {
      if (visM < 1500) cats.push("LIFR");
      else if (visM < 5000) cats.push("IFR");
      else if (visM <= 8000) cats.push("MVFR");
      else cats.push("VFR");
    }
    if (!cats.length) return null;
    const rank = { LIFR: 0, IFR: 1, MVFR: 2, VFR: 3 };
    return cats.reduce((a, b) => (rank[a] < rank[b] ? a : b));
  }

  /** Color por altura de base (ft). */
  function baseHeightStyle(ft) {
    if (ft == null || Number.isNaN(Number(ft))) return null;
    const h = Number(ft);
    if (h < 200) return { color: "#6a1b9a", label: "< 200 ft", key: "vlifr" };
    if (h < 500) return { color: "#c62828", label: "200–500 ft", key: "lifr" };
    if (h < 1000) return { color: "#ef6c00", label: "500–1000 ft", key: "ifr" };
    if (h <= 2000) return { color: "#f9a825", label: "1000–2000 ft", key: "mvfr" };
    return { color: "#2e7d32", label: "> 2000 ft", key: "vfr" };
  }

  /**
   * Cantidad de nube estilo METAR a partir de oktas SYNOP (Ns/Nh/N).
   * FEW 1–2 · SCT 3–4 · BKN 5–7 · OVC 8 (9 = cielo oscurecido → OVC).
   */
  function coverAmount(cover) {
    if (cover == null || cover === "" || cover === "/") return null;
    const n = Number(String(cover));
    if (Number.isNaN(n)) return null;
    if (n <= 0) return { code: "SKC", oktas: 0, significant: false, tone: "muted" };
    if (n <= 2) return { code: "FEW", oktas: n, significant: false, tone: "muted" };
    if (n <= 4) return { code: "SCT", oktas: n, significant: false, tone: "soft" };
    if (n <= 7) return { code: "BKN", oktas: n, significant: true, tone: "strong" };
    return { code: "OVC", oktas: n >= 9 ? 9 : 8, significant: true, tone: "strong" };
  }

  function enrichLayer(layer) {
    const amount = coverAmount(layer.cover);
    const heightStyle = baseHeightStyle(layer.height_ft);
    return {
      ...layer,
      amount,
      height_style: heightStyle,
      is_ceiling: !!(amount && amount.significant),
    };
  }

  function cloudBases(obs) {
    const layers = Array.isArray(obs.cloud_layers) ? obs.cloud_layers : [];
    const fromLayers = layers
      .filter((l) => l.height_ft != null)
      .map((l) =>
        enrichLayer({
          height_ft: l.height_ft,
          cover: l.ns ?? obs.nh ?? obs.total_cloud,
          genus: l.genus_name || (l.genus != null ? `C=${l.genus}` : null),
          source: "sec.3",
        })
      )
      .sort((a, b) => a.height_ft - b.height_ft);
    if (fromLayers.length) return fromLayers;
    const h = obs.cloud_base_h != null ? String(obs.cloud_base_h) : null;
    if (h != null && H_BASE_FT[h] != null) {
      return [
        enrichLayer({
          height_ft: H_BASE_FT[h],
          cover: obs.nh ?? obs.total_cloud,
          genus: `h=${h}`,
          source: "sec.1",
        }),
      ];
    }
    return [];
  }

  function coloredBaseHtml(ft, opts) {
    const compact = opts && opts.compact;
    const st = baseHeightStyle(ft);
    if (ft == null) return "—";
    const txt = `${ft} ft`;
    if (!st) return esc(txt);
    return `<span class="cloud-base-h" style="color:${st.color};font-weight:700">${esc(txt)}</span>${
      compact ? "" : ""
    }`;
  }

  function amountBadgeHtml(amount) {
    if (!amount) return "";
    const cls = amount.significant ? "cloud-amt strong" : `cloud-amt ${amount.tone || "muted"}`;
    const oktas =
      amount.oktas != null ? ` title="${amount.oktas}/8 oktas"` : "";
    return `<span class="${cls}"${oktas}>${esc(amount.code)}</span>`;
  }

  function formatBaseLine(b) {
    const amt = b.amount || coverAmount(b.cover);
    const height = coloredBaseHtml(b.height_ft);
    const badge = amountBadgeHtml(amt);
    const genus = b.genus ? ` · ${esc(b.genus)}` : "";
    const oktas =
      amt && amt.oktas != null ? ` <small class="cloud-oktas">${esc(String(amt.oktas))}/8</small>` : "";
    return `${badge}${badge ? " " : ""}${height}${oktas}${genus}`;
  }

  function significantWx(ww) {
    if (ww == null || ww === "" || ww === "/") return null;
    const code = Number(String(ww).padStart(2, "0"));
    if (Number.isNaN(code)) return null;
    if ([17, 29, 91, 92, 93, 94, 95, 96, 97, 98, 99].includes(code)) {
      return { key: "ts", label: "Tormenta", tone: "danger" };
    }
    if (code >= 40 && code <= 49) return { key: "fg", label: "Niebla", tone: "warn" };
    if ([10, 11, 12, 28].includes(code)) return { key: "br", label: "Neblina", tone: "warn" };
    if (code >= 50 && code <= 59) return { key: "dz", label: "Llovizna", tone: "info" };
    if (code >= 60 && code <= 69) return { key: "ra", label: "Lluvia", tone: "info" };
    if (code >= 70 && code <= 79) return { key: "sn", label: "Nieve", tone: "info" };
    if (code >= 80 && code <= 90) return { key: "sh", label: "Chubascos", tone: "info" };
    if ([18, 19].includes(code)) return { key: "sq", label: "Turbonada/Tromba", tone: "danger" };
    if (code >= 30 && code <= 35) return { key: "du", label: "Polvo/Arena", tone: "warn" };
    return null;
  }

  /** Enriquece un SYNOP con campos de resumen aviación. */
  function fromSynop(obs) {
    const bases = cloudBases(obs);
    // Techo operativo = base más baja BKN/OVC (FEW/SCT no definen techo)
    const ceilingLayer = bases.find((b) => b.is_ceiling) || null;
    const ceiling_ft = ceilingLayer ? ceilingLayer.height_ft : null;
    const ceiling_amount = ceilingLayer ? ceilingLayer.amount : null;
    const vis = obs.visibility_m;
    const flt = flightCategory(ceiling_ft, vis);
    const sig = significantWx(obs.present_weather);
    const wwText = obs.present_weather ? WW().wwText(obs.present_weather) : null;
    return {
      ...obs,
      source: "SYNOP/OGIMET",
      cloud_bases: bases,
      ceiling_ft,
      ceiling_amount,
      flt_cat: flt,
      flt_cat_color: catMeta(flt).color,
      significant: sig,
      ww_text: wwText,
      is_speci: false,
    };
  }

  function hoverHtml(obs) {
    const a = obs.cloud_bases ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const bases = (a.cloud_bases || [])
      .slice(0, 3)
      .map((b) => formatBaseLine(b))
      .join("<br/>");
    const lines = [
      `<b>${esc(a.omm)}</b> · ${esc(a.nombre || "")}`,
      a.fir ? `FIR ${esc(a.fir)}` : "",
      `<span style="color:${cat.color}"><b>${esc(cat.label)}</b></span>`,
      a.utc ? `UTC ${esc(a.utc)}` : "",
      a.has_speci ? `<span class="speci-badge">SPECI reciente</span>` : "",
      `Vis ${coloredVisHtml(a.visibility_m)}`,
      bases
        ? `<div class="hover-bases"><b>Bases</b><br/>${bases}</div>`
        : "Bases —",
      a.wind_gust_kt != null ? `<b>Ráfaga ${esc(String(a.wind_gust_kt))} kt</b>` : "",
      a.significant
        ? `<span class="wx-tag ${a.significant.tone}">${esc(a.significant.label)}</span> ${esc(
            a.ww_text || ""
          )}`
        : a.ww_text
          ? esc(a.ww_text)
          : "",
      `<div class="synop-line">${esc(a.raw || "")}</div>`,
    ];
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const a = obs.cloud_bases ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const wind =
      a.wind_dir != null || a.wind_speed_kt != null
        ? `${a.wind_dir != null ? a.wind_dir + "°" : "—"} · ${
            a.wind_speed_kt != null ? a.wind_speed_kt + " kt" : "—"
          }${a.wind_gust_kt != null ? ` · ráfaga ${a.wind_gust_kt} kt` : ""}`
        : "—";
    const basesHtml = (a.cloud_bases || []).length
      ? (a.cloud_bases || [])
          .map((b) => {
            const cls = b.is_ceiling ? "av-base-row is-ceiling" : "av-base-row";
            return `<li class="${cls}">${formatBaseLine(b)} <small>(${esc(b.source)})</small></li>`;
          })
          .join("")
      : "<li>—</li>";

    const ceilAmt = a.ceiling_amount ? amountBadgeHtml(a.ceiling_amount) + " " : "";

    return `
      <h2>${esc(a.nombre || a.omm)}</h2>
      <div class="meta">
        <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
        ${a.omm ? `· ${esc(a.omm)}` : ""}
        ${a.fir ? `· FIR ${esc(a.fir)}` : ""}
        · SYNOP
        ${a.has_speci ? `· <span class="speci-badge">SPECI</span>` : ""}
      </div>
      <button type="button" class="btn primary ts-open-btn" data-omm="${esc(a.omm)}" data-nombre="${esc(
        a.nombre || a.omm
      )}">
        Ver serie temporal SYNOP
      </button>
      <div class="av-grid">
        <div class="av-card">
          <div class="av-label">Visibilidad</div>
          <div class="av-value">${coloredVisHtml(a.visibility_m)}</div>
        </div>
        <div class="av-card">
          <div class="av-label">Techo (BKN/OVC)</div>
          <div class="av-value">${ceilAmt}${
            a.ceiling_ft != null ? coloredBaseHtml(a.ceiling_ft) : "—"
          }</div>
        </div>
        <div class="av-card">
          <div class="av-label">Ráfagas</div>
          <div class="av-value${a.wind_gust_kt != null ? " av-gust" : ""}">${
            a.wind_gust_kt != null ? esc(String(a.wind_gust_kt)) + " kt" : "—"
          }</div>
        </div>
        <div class="av-card">
          <div class="av-label">Fenómeno</div>
          <div class="av-value">
            ${
              a.significant
                ? `<span class="wx-tag ${a.significant.tone}">${esc(a.significant.label)}</span>`
                : "—"
            }
            <div class="av-sub">${esc(a.ww_text || "Sin ww")}</div>
          </div>
        </div>
      </div>
      <div><b>Bases de nubes</b></div>
      <ul class="av-bases">${basesHtml}</ul>
      <div><b>Viento</b> ${esc(wind)}</div>
      <div><b>SYNOP</b></div>
      <pre class="raw">${esc(a.raw || "—")}</pre>
      <div class="vis-legend">
        Vis: <span style="color:#c62828">&#9632; &lt;1 km</span>
        <span style="color:#f9a825">&#9632; 1–3 km</span>
        <span style="color:#6d4c41">&#9632; 3–9 km</span>
        <span style="color:#2e7d32">&#9632; &gt;9 km</span>
      </div>
      <div class="vis-legend">
        Base: <span style="color:#6a1b9a">&#9632; &lt;200</span>
        <span style="color:#c62828">&#9632; 200–500</span>
        <span style="color:#ef6c00">&#9632; 500–1000</span>
        <span style="color:#f9a825">&#9632; 1000–2000</span>
        <span style="color:#2e7d32">&#9632; &gt;2000 ft</span>
      </div>
      <div class="vis-legend">
        Nubosidad: <span class="cloud-amt muted">FEW</span>
        <span class="cloud-amt soft">SCT</span>
        <span class="cloud-amt strong">BKN</span>
        <span class="cloud-amt strong">OVC</span>
        <small>(techo = BKN/OVC)</small>
      </div>
    `;
  }

  function legendHtml() {
    return `
      <div class="flt-legend" aria-label="Categorías de vuelo (desde SYNOP)">
        ${Object.keys(CAT)
          .map(
            (k) =>
              `<span class="flt-leg"><i style="background:${CAT[k].color}"></i>${CAT[k].label}</span>`
          )
          .join("")}
        <span class="flt-leg flt-note">bases ·</span>
        <span class="flt-leg"><i style="background:#6a1b9a"></i>&lt;200</span>
        <span class="flt-leg"><i style="background:#c62828"></i>200–500</span>
        <span class="flt-leg"><i style="background:#ef6c00"></i>500–1k</span>
        <span class="flt-leg"><i style="background:#f9a825"></i>1–2k</span>
        <span class="flt-leg flt-note">BKN/OVC = techo · SPECI vía AW</span>
      </div>`;
  }

  function markerOptions(obs, selected) {
    const a = obs.flt_cat != null || obs.cloud_bases ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const danger = a.significant && a.significant.tone === "danger";
    const hasSpeci = !!a.has_speci;
    return {
      radius: selected ? 9 : hasSpeci || a.significant ? 8 : 7,
      color: hasSpeci ? "#b71c1c" : danger ? "#7f0000" : "#111",
      weight: selected || hasSpeci || a.significant ? 2.5 : 1,
      fillColor: cat.color,
      fillOpacity: 0.92,
      opacity: 0.95,
    };
  }

  // Historial METAR AW (solo si se pide explícitamente para un ICAO)
  function historyHtml(payload) {
    const points = payload.points || [];
    if (!points.length) {
      return `<div class="ts-empty">Sin METARs/SPECI en las últimas ${payload.hours || 24} h.</div>`;
    }
    const items = points
      .map((p) => {
        const cat = catMeta(p.flt_cat);
        return `
          <article class="metar-hist-item${p.is_speci ? " is-speci" : ""}">
            <header>
              <time>${esc(p.obs_iso || "—")}</time>
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
              ${p.is_speci ? `<span class="speci-badge">SPECI</span>` : ""}
            </header>
            <pre class="raw">${esc(p.raw || "—")}</pre>
            <div class="metar-hist-meta">Vis ${coloredVisHtml(p.visibility_m)}</div>
          </article>`;
      })
      .join("");
    return `<div class="metar-hist-list">${items}</div>`;
  }

  async function loadHistory(container, icao) {
    container.innerHTML = `<div class="ts-loading">Cargando METARs…</div>`;
    const res = await fetch(`/api/metars/${encodeURIComponent(icao)}?hours=24&taf=0`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error al cargar historial");
    container.innerHTML = historyHtml(data);
    return data;
  }

  global.MetarPlot = {
    CAT,
    catMeta,
    visStyle,
    fmtVis,
    coloredVisHtml,
    baseHeightStyle,
    coverAmount,
    coloredBaseHtml,
    fromSynop,
    hoverHtml,
    detailHtml,
    legendHtml,
    markerOptions,
    historyHtml,
    loadHistory,
    significantWx,
  };
})(window);
