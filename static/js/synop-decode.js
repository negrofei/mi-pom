/**
 * Anotación hover del mensaje SYNOP crudo (FM-12 AAXX): cada grupo se explica
 * campo a campo (tablas WMO usadas en el ploteo).
 */
(function (global) {
  const WW = () => global.PresentWeather;

  const N_TEXT = {
    "0": "0 octas (cielo despejado)",
    "1": "1 octa o menos, pero no cero",
    "2": "2 octas",
    "3": "3 octas",
    "4": "4 octas",
    "5": "5 octas",
    "6": "6 octas",
    "7": "7 octas o más, pero no ocho",
    "8": "8 octas (cielo cubierto)",
    "9": "cielo obscurecido / no observable",
    "/": "no observado",
  };

  const H_TEXT = {
    "0": "0–50 m",
    "1": "50–100 m",
    "2": "100–200 m",
    "3": "200–300 m",
    "4": "300–600 m",
    "5": "600–1000 m",
    "6": "1000–1500 m",
    "7": "1500–2000 m",
    "8": "2000–2500 m",
    "9": "≥2500 m o sin nubes",
    "/": "altura de base desconocida",
  };

  const IR_TEXT = {
    "0": "en grupos 6 y/o 7 de las secciones 1 y 3",
    "1": "en el grupo 6 de la sección 1",
    "2": "en el grupo 6 de la sección 3",
    "3": "en el grupo 6 de la sección 1 (omitido = nada)",
    "4": "en el grupo 6 de la sección 1 (omitido = nada medible)",
    "/": "no se informa",
  };

  const IX_TEXT = {
    "1": "estación automática, grupo 7 incluido",
    "2": "estación automática, grupo 7 omitido (sin fenómeno significativo)",
    "3": "estación automática, grupo 7 omitido (no disponible)",
    "4": "estación tripulada, grupo 7 incluido",
    "5": "estación tripulada, grupo 7 omitido (sin fenómeno significativo)",
    "6": "estación tripulada, grupo 7 omitido (no disponible)",
    "/": "no se informa",
  };

  const IW_TEXT = {
    "0": "viento en m/s, estimado",
    "1": "viento en m/s, anemómetro",
    "3": "viento en kt, estimado",
    "4": "viento en kt, anemómetro",
  };

  const CL_TEXT = [
    "Cumulus humilis / Cumulus fractus de buen tiempo",
    "Cumulus mediocris o congestus",
    "Cumulonimbus calvus",
    "Stratocumulus cumulogenitus",
    "Stratocumulus (no cumulogenitus)",
    "Stratus nebulosus o Stratus fractus",
    "Stratus fractus / Cumulus fractus de mal tiempo (pannus)",
    "Cumulus y Stratocumulus a distintos niveles",
    "Cumulonimbus capillatus (con o sin Cu/Sc/St)",
  ];
  const CM_TEXT = [
    "Altostratus translucidus",
    "Altostratus opacus o Nimbostratus",
    "Altocumulus translucidus a un solo nivel",
    "Bancos de Altocumulus (a menudo lenticular)",
    "Altocumulus translucidus en bandas / invadiendo el cielo",
    "Altocumulus cumulogenitus",
    "Altocumulus en capas / con Altostratus o Nimbostratus",
    "Altocumulus castellanus o floccus",
    "Altocumulus de cielo caótico",
  ];
  const CH_TEXT = [
    "Cirrus fibratus / uncinus, no invadiendo el cielo",
    "Cirrus spissatus en bancos o en penachos",
    "Cirrus spissatus cumulonimbogenitus",
    "Cirrus uncinus / fibratus invadiendo el cielo",
    "Cirrus y Cirrostratus, con borde <45° sobre el horizonte",
    "Cirrus y Cirrostratus, con borde >45° sobre el horizonte",
    "Cirrostratus cubriendo todo el cielo",
    "Cirrostratus no cubriendo todo el cielo",
    "Cirrocumulus solo o predominante",
  ];

  const CLOUD_GENUS = {
    "0": "Ci — Cirrus",
    "1": "Cc — Cirrocumulus",
    "2": "Cs — Cirrostratus",
    "3": "Ac — Altocumulus",
    "4": "As — Altostratus",
    "5": "Ns — Nimbostratus",
    "6": "Sc — Stratocumulus",
    "7": "St — Stratus",
    "8": "Cu — Cumulus",
    "9": "Cb — Cumulonimbus",
  };

  const A_TEXT = {
    "0": "creciente, luego decreciente (o estable luego decreciente)",
    "1": "creciente, luego estable (o creciente luego creciente más lento)",
    "2": "creciente (regular o irregular)",
    "3": "decreciente o estable, luego creciente (o creciente más rápido)",
    "4": "estable",
    "5": "decreciente, luego creciente (o estable luego creciente)",
    "6": "decreciente, luego estable (o decreciente luego decreciente más lento)",
    "7": "decreciente (regular o irregular)",
    "8": "creciente o estable, luego decreciente (o decreciente más rápido)",
  };

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tipAttr(lines) {
    return esc(lines.filter(Boolean).join("\n")).replace(/\n/g, "&#10;");
  }

  function heightFromHs(hs) {
    if (!hs || hs.includes("/")) return null;
    const code = Number(hs);
    if (Number.isNaN(code)) return null;
    let m = null;
    if (code >= 0 && code <= 50) m = code * 30;
    else if (code >= 56 && code <= 80) m = (code - 50) * 300;
    else if (code >= 81 && code <= 88) m = (code - 80) * 1500 + 9000;
    else if (code === 89) m = 21000;
    if (m == null) return null;
    const ft = Math.round((m * 3.28084) / 100) * 100;
    return { m, ft };
  }

  function visText(vv) {
    if (!vv || vv === "//") return "no observada";
    const code = Number(vv);
    if (Number.isNaN(code)) return `código ${vv}`;
    if (code === 0) return "<100 m";
    if (code >= 1 && code <= 50) return `${code * 100} m`;
    if (code >= 56 && code <= 80) return `${(code - 50) * 1000} m (${code - 50} km)`;
    if (code >= 81 && code <= 89) {
      const km = { 81: 35, 82: 40, 83: 45, 84: 50, 85: 60, 86: 70, 87: 80, 88: 90, 89: 100 }[
        code
      ];
      return `≥${km} km`;
    }
    const special = {
      90: "<50 m",
      91: "50 m",
      92: "200 m",
      93: "500 m",
      94: "1 km",
      95: "2 km",
      96: "4 km",
      97: "10 km",
      98: "20 km",
      99: "≥50 km",
    };
    return special[code] || `código ${vv}`;
  }

  function tempFromGroup(g) {
    if (!g || g.length < 5 || g[1] === "/") return null;
    const raw = Number(g.slice(2, 5));
    if (Number.isNaN(raw)) return null;
    const val = raw / 10;
    if (g[1] === "0") return val;
    if (g[1] === "1") return -val;
    return null;
  }

  function pressureFromPppp(pppp) {
    if (!pppp || pppp.length !== 4 || pppp.includes("/")) return null;
    const n = Number(pppp);
    if (Number.isNaN(n)) return null;
    if (n < 5000) return (n + 10000) / 10;
    return n / 10;
  }

  function windDirText(dd) {
    if (dd === "//" || dd == null) return "dirección no observada";
    const n = Number(dd);
    if (Number.isNaN(n)) return `dd=${dd}`;
    if (n === 0) return "calma (sin dirección)";
    if (n === 99) return "variable / dirección indefinida";
    const center = (n * 10) % 360;
    const lo = (center - 5 + 360) % 360;
    const hi = (center + 4) % 360;
    return `Dirección verdadera, en decenas de grados, de donde sopla el viento : ${center}° (${String(lo).padStart(3, "0")}°–${String(hi).padStart(3, "0")}°)`;
  }

  function windSpeedText(ff, units) {
    if (ff === "//" || ff == null) return "velocidad no observada";
    const n = Number(ff);
    if (Number.isNaN(n)) return `ff=${ff}`;
    const u = units === "kt" ? "kt" : "m/s";
    return `Velocidad del viento : ${n} ${u}`;
  }

  function explainYYGGi(tok) {
    const dd = tok.slice(0, 2);
    const gg = tok.slice(2, 4);
    const iw = tok[4];
    return [
      `Grupo YYGGiᵥ — fecha/hora del mensaje`,
      `${dd} Día del mes (UTC) : ${Number(dd)}`,
      `${gg} Hora (UTC) : ${Number(gg)}:00`,
      `${iw} Indicador de unidades/origen del viento (iᵥ) : ${IW_TEXT[iw] || iw}`,
    ];
  }

  function explainIrIxHV(tok) {
    const ir = tok[0];
    const ix = tok[1];
    const h = tok[2];
    const vv = tok.slice(3, 5);
    return [
      `Grupo iᵣiₓhVV — precipitación / tipo de estación / base / visibilidad`,
      `${ir} Indicador de inclusión del grupo 6 (iᵣ) : ${IR_TEXT[ir] || ir}`,
      `${ix} Tipo de estación / grupo 7 (iₓ) : ${IX_TEXT[ix] || ix}`,
      `${h} Altura de la base de las nubes más bajas (h) : ${H_TEXT[h] || h}`,
      `${vv} Visibilidad horizontal (VV) : ${visText(vv)}`,
    ];
  }

  function explainNddff(tok, units) {
    const n = tok[0];
    const dd = tok.slice(1, 3);
    const ff = tok.slice(3, 5);
    return [
      `Grupo Nddff — nubosidad total y viento`,
      `${n} Nubosidad total (N) : ${N_TEXT[n] || n}`,
      `${dd} ${windDirText(dd)}`,
      `${ff} ${windSpeedText(ff, units)}`,
    ];
  }

  function explain1sTTT(tok) {
    const t = tempFromGroup(tok);
    return [
      `Grupo 1sTTT — temperatura del aire`,
      `${tok[1]} Signo (s) : ${tok[1] === "0" ? "positiva o cero" : tok[1] === "1" ? "negativa" : tok[1]}`,
      `${tok.slice(2, 5)} Temperatura (TTT) : ${t != null ? `${t.toFixed(1)} °C` : "no observada"}`,
    ];
  }

  function explain2sTTT(tok) {
    const t = tempFromGroup(tok);
    return [
      `Grupo 2sTTT — temperatura del punto de rocío`,
      `${tok[1]} Signo (s) : ${tok[1] === "0" ? "positiva o cero" : tok[1] === "1" ? "negativa" : tok[1]}`,
      `${tok.slice(2, 5)} Rocío (TTT) : ${t != null ? `${t.toFixed(1)} °C` : "no observada"}`,
    ];
  }

  function explain3PPPP(tok) {
    const p = pressureFromPppp(tok.slice(1, 5));
    return [
      `Grupo 3P₀P₀P₀P₀ — presión a nivel de la estación`,
      `${tok.slice(1, 5)} Presión : ${p != null ? `${p.toFixed(1)} hPa` : "no observada"}`,
    ];
  }

  function explain4PPPP(tok) {
    const p = pressureFromPppp(tok.slice(1, 5));
    return [
      `Grupo 4PPPP — presión a nivel medio del mar`,
      `${tok.slice(1, 5)} Presión MSL : ${p != null ? `${p.toFixed(1)} hPa` : "no observada"}`,
    ];
  }

  function explain5appp(tok) {
    const a = tok[1];
    const ppp = tok.slice(2, 5);
    let tendency = "no observada";
    if (ppp && !ppp.includes("/")) {
      const n = Number(ppp);
      if (!Number.isNaN(n)) tendency = `${(n / 10).toFixed(1)} hPa / 3 h`;
    }
    return [
      `Grupo 5appp — tendencia barométrica`,
      `${a} Características (a) : ${A_TEXT[a] || a}`,
      `${ppp} Cantidad de la tendencia (ppp) : ${tendency}`,
    ];
  }

  function explain7wwW1W2(tok) {
    const ww = tok.slice(1, 3);
    const w1 = tok[3];
    const w2 = tok[4];
    const wwTxt =
      ww.includes("/") ? "no observado" : (WW() && WW().wwText(ww)) || `código ${ww}`;
    return [
      `Grupo 7wwW₁W₂ — tiempo presente y pasado`,
      `${ww} Tiempo presente (ww) : ${wwTxt}`,
      `${w1} Tiempo pasado W₁ : ${w1 === "/" ? "no observado" : w1}`,
      `${w2} Tiempo pasado W₂ : ${w2 === "/" ? "no observado" : w2}`,
    ];
  }

  function explain8NhCLCMCH(tok) {
    const nh = tok[1];
    const cl = tok[2];
    const cm = tok[3];
    const ch = tok[4];
    const clTxt =
      cl === "/" || cl === "0"
        ? cl === "0"
          ? "sin nubes bajas"
          : "no observado"
        : CL_TEXT[Number(cl)] || cl;
    const cmTxt =
      cm === "/" || cm === "0"
        ? cm === "0"
          ? "sin nubes medias"
          : "no observado"
        : CM_TEXT[Number(cm)] || cm;
    const chTxt =
      ch === "/" || ch === "0"
        ? ch === "0"
          ? "sin nubes altas"
          : "no observado"
        : CH_TEXT[Number(ch)] || ch;
    return [
      `Grupo 8NhCLCMCH — nubes de la sección 1`,
      `${nh} Nubosidad de nubes bajas/medias (Nh) : ${N_TEXT[nh] || nh}`,
      `${cl} Nubes bajas (CL) : ${clTxt}`,
      `${cm} Nubes medias (CM) : ${cmTxt}`,
      `${ch} Nubes altas (CH) : ${chTxt}`,
    ];
  }

  function explain8NsChshs(tok) {
    const ns = tok[1];
    const c = tok[2];
    const hs = tok.slice(3, 5);
    const h = heightFromHs(hs);
    return [
      `Grupo 8NsChₛhₛ — capa de nube (sección 3)`,
      `${ns} Cantidad de esa capa (Ns) : ${N_TEXT[ns] || ns}`,
      `${c} Género (C) : ${CLOUD_GENUS[c] || (c === "/" ? "no observado" : c)}`,
      `${hs} Altura de la base (hₛhₛ) : ${
        h ? `≈ ${h.m} m (≈ ${h.ft} ft)` : hs.includes("/") ? "no observada" : `código ${hs}`
      }`,
    ];
  }

  function explain910ff(tok, units) {
    const ff = tok.slice(3, 5);
    return [
      `Grupo 910ff — ráfaga máxima en la hora precedente`,
      `${ff} ${windSpeedText(ff, units)}`,
    ];
  }

  function explainGroup(tok, ctx) {
    const t = String(tok || "").toUpperCase();
    if (!t) return ["(vacío)"];
    if (t === "AAXX") {
      return ["AAXX — boletín SYNOP de estación terrestre (FM-12)"];
    }
    if (t === "333") {
      return ["333 — inicio de la sección 3 (datos regionales / capas de nube)"];
    }
    if (t === "555") {
      return ["555 — inicio de la sección 5 (grupos nacionales)"];
    }
    if (t === "NIL") {
      return ["NIL — sin observación"];
    }
    if (ctx.expect === "yyggi" && /^\d{5}$/.test(t)) {
      return explainYYGGi(t);
    }
    if (ctx.expect === "omm" && /^\d{5}$/.test(t)) {
      return [`Indicativo OMM (IIiii) : estación ${t}`];
    }
    if (ctx.section === 1 && ctx.idxInSection === 0 && /^[\d/]{5}$/.test(t)) {
      return explainIrIxHV(t);
    }
    if (ctx.section === 1 && ctx.idxInSection === 1 && /^[\d/]{5}$/.test(t)) {
      return explainNddff(t, ctx.units);
    }
    if (ctx.section === 1 && /^1[\d/]{4}$/.test(t)) return explain1sTTT(t);
    if (ctx.section === 1 && /^2[\d/]{4}$/.test(t)) return explain2sTTT(t);
    if (ctx.section === 1 && /^3[\d/]{4}$/.test(t)) return explain3PPPP(t);
    if (ctx.section === 1 && /^4[\d/]{4}$/.test(t)) return explain4PPPP(t);
    if (ctx.section === 1 && /^5[\d/]{4}$/.test(t)) return explain5appp(t);
    if (ctx.section === 1 && /^7[\d/]{4}$/.test(t)) return explain7wwW1W2(t);
    if (ctx.section === 1 && /^8[\d/]{4}$/.test(t)) return explain8NhCLCMCH(t);
    if (ctx.section === 3 && /^8[\d/]{4}$/.test(t)) return explain8NsChshs(t);
    if (ctx.section === 3 && /^910[\d/]{2}$/.test(t)) return explain910ff(t, ctx.units);
    if (/^[\d/]{5}$/.test(t)) {
      return [`Grupo ${t} — sin decodificación específica en este contexto`];
    }
    return [`Token ${t}`];
  }

  function hazardClassForGroup(tok, local, opts) {
    const classes = [];
    const t = String(tok || "").toUpperCase();
    // Capas 8NsChshs: C=9 → CB rojo
    if (local.section === 3 && /^8[\d/]{4}$/.test(t) && t[2] === "9") {
      classes.push("synop-g--cb");
    }
    // Sección 1: 8NhCLCMCH — CL=3/9 CB, CL=2 ≈ TCU (Cu congestus)
    if (local.section === 1 && /^8[\d/]{4}$/.test(t)) {
      if (t[2] === "3" || t[2] === "9") classes.push("synop-g--cb");
      else if (t[2] === "2") classes.push("synop-g--tcu");
    }
    // Nddff — color por viento
    if (local.section === 1 && local.idxInSection === 1 && /^[\d/]{5}$/.test(t)) {
      const ff = t.slice(3, 5);
      let kt = null;
      if (ff !== "//") {
        const n = Number(ff);
        if (!Number.isNaN(n)) {
          kt = local.units === "kt" ? n : Math.round(n * 1.94384);
        }
      }
      if (opts && opts.wind_speed_kt != null) kt = Number(opts.wind_speed_kt);
      if (kt >= 30) classes.push("synop-g--wind-red");
      else if (kt >= 20) classes.push("synop-g--wind-orange");
      else if (kt >= 15) classes.push("synop-g--wind-yellow");
    }
    // iRixhVV — color por visibilidad
    if (local.section === 1 && local.idxInSection === 0 && /^[\d/]{5}$/.test(t)) {
      let vm = opts && opts.visibility_m != null ? Number(opts.visibility_m) : null;
      if (vm == null) {
        // aproximación desde VV si no hay metros
        const vv = t.slice(3, 5);
        if (vv !== "//") {
          const code = Number(vv);
          if (!Number.isNaN(code)) {
            if (code >= 1 && code <= 50) vm = code * 100;
            else if (code >= 56 && code <= 80) vm = (code - 50) * 1000;
          }
        }
      }
      if (vm != null) {
        if (vm < 1000) classes.push("synop-g--vis-violet");
        else if (vm <= 2000) classes.push("synop-g--vis-red");
        else if (vm >= 3000 && vm < 5000) classes.push("synop-g--vis-orange");
        else if (vm >= 5000 && vm <= 7000) classes.push("synop-g--vis-yellow");
      }
    }
    return classes;
  }

  /**
   * Devuelve HTML con cada grupo envuelto en <span class="synop-g" data-tip="...">.
   * opts: { wind_speed_kt, visibility_m } para resaltar umbrales.
   */
  function annotateRawHtml(raw, opts) {
    const msg = String(raw || "")
      .replace(/=/g, " ")
      .trim();
    if (!msg) return esc("—");

    const tokens = msg.toUpperCase().split(/\s+/).filter(Boolean);
    const ctx = {
      expect: null,
      section: 1,
      idxInSection: -1,
      units: "mps",
      pastHeader: false,
    };
    const parts = [];

    tokens.forEach((tok, i) => {
      if (i > 0) parts.push(" ");

      let local = { ...ctx };
      if (!ctx.pastHeader) {
        if (tok === "AAXX") {
          local.expect = "aaxx";
          ctx.expect = "yyggi";
        } else if (ctx.expect === "yyggi") {
          local.expect = "yyggi";
          if (tok.length >= 5) {
            const iw = tok[4];
            ctx.units = iw === "3" || iw === "4" ? "kt" : "mps";
          }
          ctx.expect = "omm";
        } else if (ctx.expect === "omm" && /^\d{5}$/.test(tok)) {
          local.expect = "omm";
          ctx.expect = null;
          ctx.pastHeader = true;
          ctx.section = 1;
          ctx.idxInSection = -1;
        } else {
          // sin AAXX: primer grupo numérico = OMM o ya sección 1
          ctx.pastHeader = true;
          if (/^\d{5}$/.test(tok) && ctx.idxInSection < 0) {
            local.expect = "omm";
          } else {
            ctx.idxInSection += 1;
            local.section = 1;
            local.idxInSection = ctx.idxInSection;
            local.units = ctx.units;
          }
        }
      } else if (tok === "333") {
        local.section = 3;
        ctx.section = 3;
        ctx.idxInSection = -1;
      } else if (tok === "555") {
        local.section = 5;
        ctx.section = 5;
        ctx.idxInSection = -1;
      } else if (tok !== "NIL") {
        ctx.idxInSection += 1;
        local.section = ctx.section;
        local.idxInSection = ctx.idxInSection;
        local.units = ctx.units;
      }

      const lines = explainGroup(tok, local);
      const extra = hazardClassForGroup(tok, local, opts || {}).join(" ");
      const cls = extra ? `synop-g ${extra}` : "synop-g";
      parts.push(
        `<span class="${cls}" tabindex="0" data-tip="${tipAttr(lines)}">${esc(tok)}</span>`
      );
    });

    return parts.join("");
  }

  global.SynopDecode = {
    annotateRawHtml,
    explainGroup,
    N_TEXT,
  };
})(window);
