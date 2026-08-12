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
    if (v < 1000) return { color: "#6a1b9a", label: "< 1 km", key: "v1" };
    if (v < 3000) return { color: "#c62828", label: "1–3 km", key: "v2" };
    if (v < 5000) return { color: "#ef6c00", label: "3–5 km", key: "v3" };
    if (v < 10000) return { color: "#f9a825", label: "5–9 km", key: "v4" };
    return { color: "#2e7d32", label: "≥ 10 km", key: "v5" };
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

  /** Color por altura de base (ft) cuando hay techo BKN/OVC. */
  function baseHeightStyle(ft) {
    if (ft == null || Number.isNaN(Number(ft))) return null;
    const h = Number(ft);
    if (h < 200) return { color: "#6a1b9a", label: "< 200 ft", key: "vlifr" };
    if (h < 500) return { color: "#c62828", label: "200–500 ft", key: "lifr" };
    if (h < 1000) return { color: "#ef6c00", label: "500–1000 ft", key: "ifr" };
    if (h <= 2000) return { color: "#f9a825", label: "1000–2000 ft", key: "mvfr" };
    return { color: "#2e7d32", label: "> 2000 ft", key: "vfr" };
  }

  // Verdes distintos: cielo despejado vs nubosidad poco significativa (FEW/SCT)
  const SKY_CLEAR_GREEN = "#00c853"; // brillante: sin nubes / CAVOK / SKC
  const SKY_FEW_GREEN = "#9ccc65"; // oliváceo: FEW/SCT sin techo

  /**
   * Estado de cielo para colorear por bases.
   * clear | few | ceiling
   */
  function skyState(obs) {
    const a = obs || {};
    const raw = String(a.raw || "").toUpperCase();
    const bases = Array.isArray(a.cloud_bases) ? a.cloud_bases : [];
    const clouds = Array.isArray(a.clouds) ? a.clouds : [];
    const hasCeiling =
      a.ceiling_ft != null ||
      bases.some((b) => b && b.is_ceiling) ||
      clouds.some((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        return cover === "BKN" || cover === "OVC" || cover === "VV" || cover === "OVX";
      });
    if (hasCeiling) return "ceiling";

    const clearToken =
      /\bCAVOK\b/.test(raw) ||
      /\bSKC\b/.test(raw) ||
      /\bCLR\b/.test(raw) ||
      /\bNCD\b/.test(raw) ||
      /\bNSC\b/.test(raw);
    const hasAnyCloud =
      bases.length > 0 ||
      clouds.some((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        return cover && cover !== "SKC" && cover !== "CLR" && cover !== "NCD" && cover !== "NSC";
      });
    if (!hasAnyCloud || clearToken) return "clear";
    return "few";
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
    if (n <= 7) return { code: "BKN", oktas: n, significant: true, tone: "bkn" };
    return { code: "OVC", oktas: n >= 9 ? 9 : 8, significant: true, tone: "ovc" };
  }

  function enrichLayer(layer) {
    const amount = coverAmount(layer.cover);
    const heightStyle = baseHeightStyle(layer.height_ft);
    const convective = convectiveFromSynopLayer(layer);
    return {
      ...layer,
      amount,
      height_style: heightStyle,
      is_ceiling: !!(amount && amount.significant),
      convective,
    };
  }

  /** CB (género 9 / Cumulonimbus) o TCU si aparece en el texto. */
  function convectiveFromSynopLayer(layer) {
    const code = layer.genus_code != null ? String(layer.genus_code) : "";
    const name = String(layer.genus || layer.genus_name || "");
    if (code === "9" || /\bCb\b|Cumulonimbus/i.test(name)) return "CB";
    if (/\bTCU\b|Towering/i.test(name)) return "TCU";
    return null;
  }

  function convectiveBadgeHtml(kind) {
    if (!kind) return "";
    const k = String(kind).toUpperCase();
    if (k !== "CB" && k !== "TCU") return "";
    return `<span class="cloud-convective ${k.toLowerCase()}" title="${
      k === "CB" ? "Cumulonimbus" : "Towering Cumulus"
    }">${esc(k)}</span>`;
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
          genus_code: l.genus,
          source: "sec.3",
        })
      )
      .sort((a, b) => a.height_ft - b.height_ft);
    if (fromLayers.length) return fromLayers;
    const h = obs.cloud_base_h != null ? String(obs.cloud_base_h) : null;
    if (h != null && H_BASE_FT[h] != null) {
      const cl = obs.cl != null ? String(obs.cl) : null;
      return [
        enrichLayer({
          height_ft: H_BASE_FT[h],
          cover: obs.nh ?? obs.total_cloud,
          genus: cl === "9" ? "Cb — Cumulonimbus (CL)" : `h=${h}`,
          genus_code: cl === "9" ? "9" : null,
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
    const cls = `cloud-amt ${amount.tone || "muted"}`;
    const oktas =
      amount.oktas != null ? ` title="${amount.oktas}/8 oktas"` : "";
    return `<span class="${cls}"${oktas}>${esc(amount.code)}</span>`;
  }

  function formatBaseLine(b) {
    // Como antes: badge BKN/OVC con tono + pies coloreados por altura
    const amt = b.amount || coverAmount(b.cover) || amountFromAwCover(b.cover);
    const heightFt =
      b.height_ft != null ? Number(b.height_ft) : b.base != null ? Number(b.base) : null;
    const height = coloredBaseHtml(heightFt);
    const badge = amountBadgeHtml(amt);
    const conv = convectiveBadgeHtml(b.convective);
    const genus = b.genus && !b.convective ? ` · ${esc(b.genus)}` : "";
    const oktas =
      amt && amt.oktas != null
        ? ` <small class="cloud-oktas">${esc(String(amt.oktas))}/8</small>`
        : "";
    return `${badge}${badge ? " " : ""}${height}${oktas}${conv ? " " + conv : ""}${genus}`;
  }

  /** Token METAR compacto para el plot del mapa: COVER + height/100 + CB/TCU. */
  function metarCloudToken(b) {
    if (!b) return "";
    const amt = b.amount || coverAmount(b.cover) || amountFromAwCover(b.cover);
    const code = (amt && amt.code) || String(b.cover || "").toUpperCase() || "///";
    let h = b.height_ft != null ? Number(b.height_ft) : b.base != null ? Number(b.base) : null;
    let hh = "";
    if (h != null && !Number.isNaN(h)) {
      hh = String(Math.max(0, Math.round(h / 100))).padStart(3, "0");
    }
    const conv = b.convective ? String(b.convective).toUpperCase() : "";
    const convOk = conv === "CB" || conv === "TCU" ? conv : "";
    if (code === "VV") return `VV${hh || "///"}${convOk}`;
    return `${code}${hh}${convOk}`;
  }

  /** Capas ordenadas (más altas arriba) para plot/hover. */
  function metarCloudLayers(obs) {
    const bases = Array.isArray(obs.cloud_bases) ? obs.cloud_bases.slice() : [];
    if (bases.length) {
      return bases.sort((a, b) => (b.height_ft || 0) - (a.height_ft || 0));
    }
    if (!Array.isArray(obs.clouds)) return [];
    return (obs.clouds || [])
      .filter((c) => c && (c.base != null || c.cover))
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        const amount = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        return {
          height_ft: c.base != null ? Number(c.base) : null,
          cover,
          amount,
          convective: conv,
          is_ceiling: !!(amount && amount.significant),
          source: "METAR",
        };
      })
      .sort((a, b) => (b.height_ft || 0) - (a.height_ft || 0));
  }

  function metarCloudLines(obs) {
    return metarCloudLayers(obs).map(metarCloudToken).filter(Boolean);
  }

  function barbKeyFromObs(obs) {
    if (obs && obs.wind_barb) return String(obs.wind_barb);
    const spd = obs && obs.wind_speed_kt != null ? Number(obs.wind_speed_kt) : null;
    const dir = obs && obs.wind_dir != null ? Number(obs.wind_dir) : null;
    if ((dir == null || Number.isNaN(dir)) && spd != null && spd >= 1) return "v";
    if (spd == null || spd < 0.5) return "0";
    if (spd < 2.5) return "1";
    const rounded = Math.max(5, Math.min(150, Math.round(spd / 5) * 5));
    return String(rounded);
  }

  /**
   * Plot METAR estilo SYNOP: barba + capas (badge BKN/OVC + pies coloreados).
   * El disco de color refleja flight/base/vis.
   */
  function buildMetarStationHtml(obs, options) {
    const gap = Math.max(0.4, Math.min(1.5, Number(options && options.gap) || 0.75));
    const colorBy = (options && options.colorBy) || "flight";
    const fill = markerFillColor(obs, colorBy);
    const dir = obs.wind_dir != null ? Number(obs.wind_dir) : 0;
    const barb = barbKeyFromObs(obs);
    const layers = metarCloudLayers(obs);
    const cloudHtml = layers
      .map((b) => `<div class="plot-metar-cloud">${formatBaseLine(b)}</div>`)
      .join("");
    const staleCls = obs.stale ? " is-stale" : "";
    const speciCls = obs.has_speci || obs.product === "SPECI" || obs.is_speci ? " has-speci" : "";
    return `
      <div class="plot plot-metar${staleCls}${speciCls}" style="--plot-gap:${gap};--metar-fill:${fill}">
        <div class="plot-anchor">
          <div class="plot-metar-disc" title="${esc(obs.flt_cat || colorBy)}"></div>
          <div class="plot-metar-clouds">${cloudHtml}</div>
          <img class="plot-barb" src="/img/barbs/barb_${esc(barb)}.png" alt=""
               style="transform: rotate(${dir}deg);" draggable="false" />
          ${
            obs.icao
              ? `<span class="plot-metar-icao">${esc(obs.icao)}</span>`
              : obs.omm
                ? `<span class="plot-metar-icao">${esc(obs.omm)}</span>`
                : ""
          }
        </div>
      </div>
    `;
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
    const hasCb = bases.some((b) => b.convective === "CB" || b.convective === "TCU");
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
      has_convective: hasCb,
      is_speci: false,
    };
  }

  /** Extrae CB/TCU del texto METAR/SPECI (p.ej. FEW045CB, SCT030TCU). */
  function parseConvectiveFromRaw(raw) {
    const out = [];
    if (!raw) return out;
    const re = /\b(FEW|SCT|BKN|OVC|VV)(\d{3})?(CB|TCU)\b/gi;
    let m;
    while ((m = re.exec(String(raw)))) {
      out.push({
        cover: m[1].toUpperCase(),
        base: m[2] != null ? Number(m[2]) * 100 : null,
        convective: m[3].toUpperCase(),
      });
    }
    return out;
  }

  function amountFromAwCover(cover) {
    const c = String(cover || "").toUpperCase();
    if (!c) return null;
    if (c === "FEW") return { code: "FEW", significant: false, tone: "muted" };
    if (c === "SCT") return { code: "SCT", significant: false, tone: "soft" };
    if (c === "BKN") return { code: "BKN", significant: true, tone: "bkn" };
    if (c === "OVC" || c === "OVX") return { code: "OVC", significant: true, tone: "ovc" };
    if (c === "VV") return { code: "VV", significant: true, tone: "ovc" };
    if (c === "SKC" || c === "CLR" || c === "NSC" || c === "NCD") {
      return { code: c, significant: false, tone: "muted" };
    }
    return { code: c, significant: false, tone: "muted" };
  }

  function formatCloudsAw(clouds, raw) {
    const fromRaw = parseConvectiveFromRaw(raw);
    const list = Array.isArray(clouds) ? clouds.slice() : [];
    const items = list.length
      ? list
      : fromRaw.map((c) => ({
          cover: c.cover,
          base: c.base,
          type: c.convective,
          convective: c.convective,
        }));
    if (!items.length) {
      if (/\bCAVOK\b/i.test(String(raw || ""))) return "CAVOK";
      return "—";
    }
    if (!list.length) {
      if (/\bCAVOK\b/i.test(String(raw || ""))) return "CAVOK";
      return "—";
    }
    return list
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        const base = c.base != null ? Number(c.base) : null;
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        if (!conv) {
          const match = fromRaw.find(
            (r) =>
              r.cover === cover &&
              (base == null || r.base == null || Math.abs(r.base - base) < 50)
          );
          if (match) conv = match.convective;
        }
        if (!conv && /CB$/.test(cover)) conv = "CB";
        if (!conv && /TCU$/.test(cover)) conv = "TCU";
        const amt = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        const badge = amountBadgeHtml(amt);
        const height = base != null ? coloredBaseHtml(base) : "";
        const convBadge = convectiveBadgeHtml(conv);
        return (
          `${badge}${badge && height ? " " : ""}${height}${
            convBadge ? " " + convBadge : ""
          }`.trim() || "—"
        );
      })
      .join(" · ");
  }

  /** Epoch ms de un obs_iso / utc SYNOP. */
  function obsTimeMs(obs) {
    if (!obs) return null;
    if (obs.obs_iso) {
      const t = Date.parse(obs.obs_iso);
      if (!Number.isNaN(t)) return t;
    }
    // Fallback display SYNOP: dd/mm/yyyy HH:MM
    if (obs.utc) {
      const m = String(obs.utc).match(
        /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/
      );
      if (m) {
        const t = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
        if (!Number.isNaN(t)) return t;
      }
    }
    return null;
  }

  /**
   * SPECI válido solo si es posterior al METAR de la estación.
   * Un METAR nuevo (p.ej. xx:00) cierra el período del SPECI.
   */
  function isSpeciActive(speci, metar) {
    if (!speci) return false;
    const speciT = obsTimeMs(speci);
    const metarT = obsTimeMs(metar);
    if (speciT == null) return true;
    if (metarT == null) return true;
    return speciT > metarT;
  }

  /** Elige el SPECI más reciente vigente respecto del METAR. */
  function pickActiveSpeci(candidates, metar) {
    const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(
      Boolean
    );
    let best = null;
    for (const s of list) {
      if (!isSpeciActive(s, metar)) continue;
      if (!best || (obsTimeMs(s) || 0) > (obsTimeMs(best) || 0)) best = s;
    }
    return best;
  }

  function layersFromAwClouds(clouds, raw) {
    const fromRaw = parseConvectiveFromRaw(raw);
    const list = Array.isArray(clouds) ? clouds : [];
    return list
      .filter((c) => c.base != null)
      .map((c) => {
        const cover = String(c.cover || c.amount || "").toUpperCase();
        let conv =
          String(c.type || c.cloudType || c.convective || "").toUpperCase() || null;
        if (conv !== "CB" && conv !== "TCU") conv = null;
        if (!conv) {
          const match = fromRaw.find(
            (r) =>
              r.cover === cover &&
              (c.base == null || r.base == null || Math.abs(r.base - c.base) < 50)
          );
          if (match) conv = match.convective;
        }
        const amount = amountFromAwCover(cover.replace(/(CB|TCU)$/, ""));
        return {
          height_ft: c.base,
          cover: amount ? amount.oktas : null,
          amount,
          convective: conv,
          is_ceiling: !!(amount && amount.significant),
          genus: conv || null,
          source: "METAR",
        };
      })
      .sort((a, b) => a.height_ft - b.height_ft);
  }

  /** Normaliza un punto de /api/surveillance para el front. */
  function fromSurveillance(point) {
    if (!point) return point;
    if (point.nil) return null;
    if (point.product === "SYNOP" || (point.omm && !point.clouds && point.cloud_layers)) {
      if (point.nil) return null;
      const a = fromSynop(point);
      return {
        ...a,
        ...point,
        cloud_bases: a.cloud_bases,
        ceiling_ft: a.ceiling_ft ?? point.ceiling_ft,
        flt_cat: a.flt_cat || point.flt_cat,
        stale: !!point.stale,
        product: "SYNOP",
        source: point.source || a.source || "SYNOP",
        wind_barb: point.wind_barb || a.wind_barb || barbKeyFromObs(point),
      };
    }
    const bases = layersFromAwClouds(point.clouds, point.raw);
    const ceilingLayer = bases.find((b) => b.is_ceiling) || null;
    const ceiling_ft =
      point.ceiling_ft != null
        ? point.ceiling_ft
        : ceilingLayer
          ? ceilingLayer.height_ft
          : null;
    const hasConv = bases.some((b) => b.convective === "CB" || b.convective === "TCU");
    const product = point.product || (point.is_speci ? "SPECI" : "METAR");
    return {
      ...point,
      cloud_bases: bases,
      ceiling_ft,
      ceiling_amount: ceilingLayer ? ceilingLayer.amount : null,
      flt_cat: point.flt_cat || flightCategory(ceiling_ft, point.visibility_m),
      flt_cat_color: catMeta(point.flt_cat).color,
      has_convective: hasConv,
      stale: !!point.stale,
      product,
      source: point.source || product,
      has_speci: !!(point.has_speci || point.speci || product === "SPECI" || point.is_speci),
      is_speci: !!(point.is_speci || product === "SPECI"),
      wind_barb: point.wind_barb || barbKeyFromObs(point),
    };
  }

  function playSpeciSound() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = playSpeciSound._ctx || new Ctx();
      playSpeciSound._ctx = ctx;
      const now = ctx.currentTime;
      const beep = (t0, freq, dur) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.02);
      };
      beep(now, 880, 0.16);
      beep(now + 0.2, 1175, 0.22);
    } catch (_) {
      /* autoplay / contexto no disponible */
    }
  }

  function speciPanelHtml(speci) {
    if (!speci) return "";
    const cat = catMeta(speci.flt_cat);
    const wind =
      speci.wind_dir != null || speci.wind_speed_kt != null
        ? `${speci.wind_dir != null ? speci.wind_dir + "°" : "—"} · ${
            speci.wind_speed_kt != null ? speci.wind_speed_kt + " kt" : "—"
          }${speci.wind_gust_kt != null ? ` · ráfaga ${speci.wind_gust_kt} kt` : ""}`
        : "—";
    return `
      <section class="speci-panel">
        <div class="meta">
          <span class="speci-badge">SPECI</span>
          <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
          ${speci.icao ? `· ${esc(speci.icao)}` : ""}
          ${speci.obs_iso ? `· ${esc(speci.obs_iso)}` : ""}
        </div>
        <pre class="raw speci-raw">${esc(speci.raw || "—")}</pre>
        <div class="av-grid">
          <div class="av-card">
            <div class="av-label">Visibilidad</div>
            <div class="av-value">${coloredVisHtml(speci.visibility_m)}</div>
          </div>
          <div class="av-card">
            <div class="av-label">Techo</div>
            <div class="av-value">${
              speci.ceiling_ft != null ? coloredBaseHtml(speci.ceiling_ft) : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Ráfagas</div>
            <div class="av-value${speci.wind_gust_kt != null ? " av-gust" : ""}">${
              speci.wind_gust_kt != null ? esc(String(speci.wind_gust_kt)) + " kt" : "—"
            }</div>
          </div>
          <div class="av-card">
            <div class="av-label">Fenómeno</div>
            <div class="av-value">${esc(speci.wx_string || "—")}</div>
          </div>
        </div>
        <div><b>Nubes</b> ${formatCloudsAw(speci.clouds, speci.raw)}</div>
        <div><b>Viento</b> ${esc(wind)}</div>
        ${
          speci.icao
            ? `<button type="button" class="btn ghost metar-hist-btn" data-icao="${esc(
                speci.icao
              )}" data-nombre="${esc(speci.nombre || speci.icao)}">Historial METAR/SPECI 24 h</button>`
            : ""
        }
      </section>`;
  }

  function hoverHtml(obs) {
    const a = obs.cloud_bases || obs.product ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const layers = metarCloudLayers(a);
    const bases = layers.length
      ? layers.map((b) => formatBaseLine(b)).join("<br/>")
      : "—";
    const speci = a.speci;
    const product = a.product || "SYNOP";
    const lines = [
      `<b>${esc(a.icao || a.omm)}</b> · ${esc(a.nombre || "")}`,
      a.fir ? `FIR ${esc(a.fir)}` : "",
      a.stale ? `<span class="stale-badge">Dato hora anterior</span>` : "",
      speci
        ? `<span class="speci-badge">SPECI</span> ${esc(speci.obs_iso || "")}`
        : "",
      speci ? `<div class="synop-line speci-line">${esc(speci.raw || "")}</div>` : "",
      `<span style="color:${cat.color}"><b>${esc(cat.label)}</b></span> · ${esc(product)}${
        a.source ? ` · ${esc(a.source)}` : ""
      }`,
      a.obs_iso ? `UTC ${esc(a.obs_iso)}` : a.utc ? `UTC ${esc(a.utc)}` : "",
      `Vis ${coloredVisHtml(a.visibility_m)}`,
      bases !== "—"
        ? `<div class="hover-bases"><b>Bases</b><br/>${bases}</div>`
        : "Bases —",
      a.wind_gust_kt != null ? `<b>Ráfaga ${esc(String(a.wind_gust_kt))} kt</b>` : "",
      a.significant
        ? `<span class="wx-tag ${a.significant.tone}">${esc(a.significant.label)}</span> ${esc(
            a.ww_text || ""
          )}`
        : a.ww_text
          ? esc(a.ww_text)
          : a.wx_string
            ? esc(a.wx_string)
            : "",
      !speci ? `<div class="synop-line">${esc(a.raw || "")}</div>` : "",
    ];
    return lines.filter(Boolean).join("<br/>");
  }

  function detailHtml(obs) {
    const a = obs.cloud_bases || obs.product ? obs : fromSynop(obs);
    const cat = catMeta(a.flt_cat);
    const wind =
      a.wind_dir != null || a.wind_speed_kt != null
        ? `${a.wind_dir != null ? a.wind_dir + "°" : "—"} · ${
            a.wind_speed_kt != null ? a.wind_speed_kt + " kt" : "—"
          }${a.wind_gust_kt != null ? ` · ráfaga ${a.wind_gust_kt} kt` : ""}`
        : "—";
    const layers = metarCloudLayers(a);
    const basesHtml = layers.length
      ? layers
          .map((b) => {
            const cls = b.is_ceiling ? "av-base-row is-ceiling" : "av-base-row";
            return `<li class="${cls}">${formatBaseLine(b)}${
              b.source ? ` <small>(${esc(b.source)})</small>` : ""
            }</li>`;
          })
          .join("")
      : "<li>—</li>";

    const ceilAmt = a.ceiling_amount ? amountBadgeHtml(a.ceiling_amount) + " " : "";
    const hasSpeci = !!(a.speci || a.has_speci || a.product === "SPECI");
    const product = a.product || "SYNOP";

    return `
      <h2>${esc(a.nombre || a.icao || a.omm)}</h2>
      <div class="meta">
        ${hasSpeci ? `<span class="speci-badge">SPECI activo</span> · ` : ""}
        ${a.stale ? `<span class="stale-badge">Dato hora anterior</span> · ` : ""}
        ${a.icao ? `${esc(a.icao)} · ` : ""}
        ${a.omm ? `${esc(a.omm)}` : ""}
        ${a.fir ? `· FIR ${esc(a.fir)}` : ""}
      </div>
      ${speciPanelHtml(a.speci)}
      <section class="synop-panel${hasSpeci ? " synop-secondary" : ""}">
        <div class="meta">
          <span class="flt-pill" style="background:${cat.color}">${esc(cat.label)}</span>
          · ${esc(product)}
          ${a.source ? `· ${esc(a.source)}` : ""}
          ${a.obs_iso ? `· ${esc(a.obs_iso)}` : a.utc ? `· ${esc(a.utc)}` : ""}
        </div>
        ${
          a.omm
            ? `<button type="button" class="btn primary ts-open-btn" data-omm="${esc(
                a.omm
              )}" data-nombre="${esc(a.nombre || a.omm)}">Ver serie temporal SYNOP</button>`
            : ""
        }
        ${
          a.icao
            ? `<button type="button" class="btn ghost metar-hist-btn" data-icao="${esc(
                a.icao
              )}" data-nombre="${esc(a.nombre || a.icao)}">Historial METAR/SPECI 24 h</button>`
            : ""
        }
        <div class="av-grid">
          <div class="av-card">
            <div class="av-label">Visibilidad</div>
            <div class="av-value">${coloredVisHtml(a.visibility_m)}</div>
          </div>
          <div class="av-card">
            <div class="av-label">Techo (BKN/OVC)</div>
            <div class="av-value">${
              a.ceiling_ft != null
                ? esc(
                    metarCloudToken({
                      cover: (a.ceiling_amount && a.ceiling_amount.code) || "BKN",
                      height_ft: a.ceiling_ft,
                      amount: a.ceiling_amount,
                    })
                  )
                : "—"
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
                  : a.wx_string
                    ? esc(a.wx_string)
                    : "—"
              }
              <div class="av-sub">${esc(a.ww_text || a.wx_string || "Sin fenómeno")}</div>
            </div>
          </div>
        </div>
        <div><b>Bases de nubes</b></div>
        <ul class="av-bases">${basesHtml}</ul>
        <div><b>Viento</b> ${esc(wind)}</div>
        <pre class="raw">${esc(a.raw || "—")}</pre>
      </section>
    `;
  }

  function markerFillColor(obs, colorBy) {
    const a = obs.flt_cat != null || obs.cloud_bases || obs.clouds ? obs : fromSynop(obs);
    const mode = colorBy || "flight";
    if (mode === "vis") {
      return (visStyle(a.visibility_m) || {}).color || "#888888";
    }
    if (mode === "base") {
      const state = skyState(a);
      if (state === "clear") return SKY_CLEAR_GREEN;
      if (state === "few") return SKY_FEW_GREEN;
      const ft =
        a.ceiling_ft != null
          ? a.ceiling_ft
          : a.cloud_bases && a.cloud_bases.length
            ? a.cloud_bases[0].height_ft
            : null;
      return (baseHeightStyle(ft) || {}).color || SKY_CLEAR_GREEN;
    }
    return catMeta(a.flt_cat).color;
  }

  function legendHtml(colorBy) {
    const mode = colorBy || "flight";
    if (mode === "vis") {
      return `
        <div class="flt-legend" aria-label="Visibilidad">
          <span class="flt-leg flt-note">Vis ·</span>
          <span class="flt-leg"><i style="background:#6a1b9a"></i>&lt;1 km</span>
          <span class="flt-leg"><i style="background:#c62828"></i>1–3</span>
          <span class="flt-leg"><i style="background:#ef6c00"></i>3–5</span>
          <span class="flt-leg"><i style="background:#f9a825"></i>5–9</span>
          <span class="flt-leg"><i style="background:#2e7d32"></i>≥10 km</span>
        </div>`;
    }
    if (mode === "base") {
      return `
        <div class="flt-legend" aria-label="Base de nubes">
          <span class="flt-leg flt-note">Base ·</span>
          <span class="flt-leg"><i style="background:#6a1b9a"></i>&lt;200</span>
          <span class="flt-leg"><i style="background:#c62828"></i>200–500</span>
          <span class="flt-leg"><i style="background:#ef6c00"></i>500–1k</span>
          <span class="flt-leg"><i style="background:#f9a825"></i>1–2k</span>
          <span class="flt-leg"><i style="background:#2e7d32"></i>&gt;2k</span>
          <span class="flt-leg"><i style="background:${SKY_FEW_GREEN}"></i>FEW/SCT</span>
          <span class="flt-leg"><i style="background:${SKY_CLEAR_GREEN}"></i>despejado</span>
        </div>`;
    }
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

  function markerOptions(obs, selected, colorBy) {
    const a = obs.flt_cat != null || obs.cloud_bases ? obs : fromSynop(obs);
    const danger = a.significant && a.significant.tone === "danger";
    const hasSpeci = !!(a.has_speci || a.speci);
    const hasConv = !!a.has_convective;
    const stale = !!a.stale;
    return {
      radius: selected ? 9 : hasSpeci || a.significant ? 8 : 7,
      color: hasSpeci ? "#b71c1c" : danger ? "#7f0000" : hasConv ? "#e65100" : "#111",
      weight: selected || hasSpeci || a.significant || hasConv ? 2.5 : 1,
      fillColor: markerFillColor(a, colorBy),
      fillOpacity: stale ? (selected ? 0.5 : 0.32) : 0.92,
      opacity: stale ? 0.55 : 0.95,
      className: stale ? "av-marker-stale" : "av-marker-fresh",
    };
  }

  function speciWarnIcon() {
    return L.divIcon({
      className: "speci-warn-icon",
      html: '<span class="speci-warn-badge" title="SPECI vigente">⚠</span>',
      iconSize: [22, 22],
      iconAnchor: [-8, 20],
    });
  }

  function speciListHtml(items) {
    if (!items || !items.length) {
      return `<div class="speci-list-empty">No hay SPECI vigentes respecto del SYNOP actual.</div>`;
    }
    return items
      .map((s, idx) => {
        const cat = catMeta(s.flt_cat);
        const name = esc(s.nombre || s.station_nombre || s.icao || s.omm || "—");
        const icao = esc(s.icao || "—");
        const omm = s.omm ? esc(String(s.omm)) : "";
        const when = esc(s.obs_iso || "—");
        const raw = esc(s.raw || "");
        const clouds = formatCloudsAw(s.clouds, s.raw);
        const key = esc(String(s.icao || s.omm || idx));
        return `
          <button type="button" class="speci-list-item" data-speci-key="${key}" data-omm="${omm}" data-icao="${icao}">
            <div class="speci-list-item-top">
              <span class="speci-warn-inline" aria-hidden="true">⚠</span>
              <strong>${icao}</strong>
              <span class="speci-list-name">${name}</span>
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label || "—")}</span>
            </div>
            <div class="speci-list-when">${when}${omm ? ` · OMM ${omm}` : ""}</div>
            <div class="speci-list-meta">Vis ${coloredVisHtml(s.visibility_m)} · Nubes ${clouds}</div>
            <code class="speci-list-raw">${raw}</code>
          </button>`;
      })
      .join("");
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
        const cloudsHtml = formatCloudsAw(p.clouds, p.raw);
        const ceilFallback =
          (!p.clouds || !p.clouds.length) && p.ceiling_ft != null
            ? `${amountBadgeHtml(amountFromAwCover(p.cover)) || ""} ${coloredBaseHtml(
                p.ceiling_ft
              )}`.trim()
            : null;
        return `
          <article class="metar-hist-item${p.is_speci ? " is-speci" : ""}">
            <header>
              <time>${esc(p.obs_iso || "—")}</time>
              <span class="flt-pill" style="background:${cat.color}">${esc(cat.label || "—")}</span>
              ${p.is_speci ? `<span class="speci-badge">SPECI</span>` : `<span class="metar-badge">METAR</span>`}
            </header>
            <pre class="raw">${esc(p.raw || "—")}</pre>
            <div class="metar-hist-meta">
              <div>Vis ${coloredVisHtml(p.visibility_m)}</div>
              <div class="metar-hist-clouds">Nubes ${
                cloudsHtml !== "—" ? cloudsHtml : ceilFallback || "—"
              }</div>
              ${
                p.wind_gust_kt != null
                  ? `<div class="av-gust">Ráfaga ${esc(String(p.wind_gust_kt))} kt</div>`
                  : ""
              }
            </div>
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
    skyState,
    coverAmount,
    amountFromAwCover,
    coloredBaseHtml,
    formatCloudsAw,
    metarCloudToken,
    metarCloudLines,
    buildMetarStationHtml,
    convectiveBadgeHtml,
    fromSynop,
    fromSurveillance,
    hoverHtml,
    detailHtml,
    legendHtml,
    markerOptions,
    markerFillColor,
    speciWarnIcon,
    speciListHtml,
    historyHtml,
    loadHistory,
    significantWx,
    isSpeciActive,
    pickActiveSpeci,
    obsTimeMs,
    playSpeciSound,
  };
})(window);
