/**
 * Tiempo presente (ww) — textos WMO 4677 (ES) y símbolos SVG
 * cuando no hay PNG en /img/simbolos/XX.png (hoy: 56–99).
 */
(function (global) {
  // Descripciones abreviadas (español) — tabla 4677
  const WW_TEXT = {
    "00": "No hay nubes en desarrollo",
    "01": "Nubes en disolución o menos desarrolladas",
    "02": "Estado del cielo sin cambios",
    "03": "Nubes en formación o desarrollo",
    "04": "Humo o ceniza volcánica",
    "05": "Neblina (calima)",
    "06": "Polvo en suspensión, no levantado por el viento",
    "07": "Polvo o arena levantados por el viento",
    "08": "Torbellinos de polvo/arena bien desarrollados",
    "09": "Tempestad de polvo o arena a la vista",
    "10": "Neblina / bruma húmeda",
    "11": "Bancos de niebla o hielo en parches",
    "12": "Capa continua de niebla o hielo",
    "13": "Relámpago visible, sin trueno",
    "14": "Precipitación a la vista, no alcanza el suelo",
    "15": "Precipitación a la vista, alcanza el suelo lejos (>5 km)",
    "16": "Precipitación a la vista, cerca (<5 km)",
    "17": "Tormenta sin precipitación en la estación",
    "18": "Turbonada(s)",
    "19": "Tromba o tornado",
    "20": "Llovizna (no helada) o nieve granulada en la hora precedente",
    "21": "Lluvia (no helada) en la hora precedente",
    "22": "Nieve en la hora precedente",
    "23": "Lluvia y nieve o aguanieve en la hora precedente",
    "24": "Llovizna o lluvia helada en la hora precedente",
    "25": "Chubasco(s) de lluvia en la hora precedente",
    "26": "Chubasco(s) de nieve o de lluvia y nieve",
    "27": "Chubasco(s) de granizo o de lluvia y granizo",
    "28": "Niebla o niebla de hielo en la hora precedente",
    "29": "Tormenta (con o sin precipitación) en la hora precedente",
    "30": "Tempestad de polvo/arena leve o moderada, disminuyendo",
    "31": "Tempestad de polvo/arena leve o moderada, sin cambios",
    "32": "Tempestad de polvo/arena leve o moderada, aumentando",
    "33": "Tempestad de polvo/arena intensa, disminuyendo",
    "34": "Tempestad de polvo/arena intensa, sin cambios",
    "35": "Tempestad de polvo/arena intensa, aumentando",
    "36": "Ventisca baja de nieve leve/moderada",
    "37": "Ventisca baja de nieve intensa",
    "38": "Ventisca alta de nieve leve/moderada",
    "39": "Ventisca alta de nieve intensa",
    "40": "Niebla a distancia",
    "41": "Niebla en bancos",
    "42": "Niebla, cielo visible, más delgada",
    "43": "Niebla, cielo invisible, más delgada",
    "44": "Niebla, cielo visible, sin cambios",
    "45": "Niebla, cielo invisible, sin cambios",
    "46": "Niebla, cielo visible, más espesa",
    "47": "Niebla, cielo invisible, más espesa",
    "48": "Niebla con escarcha, cielo visible",
    "49": "Niebla con escarcha, cielo invisible",
    "50": "Llovizna ligera intermitente",
    "51": "Llovizna ligera continua",
    "52": "Llovizna moderada intermitente",
    "53": "Llovizna moderada continua",
    "54": "Llovizna fuerte intermitente",
    "55": "Llovizna fuerte continua",
    "56": "Llovizna helada ligera",
    "57": "Llovizna helada moderada o fuerte",
    "58": "Llovizna y lluvia ligera",
    "59": "Llovizna y lluvia moderada o fuerte",
    "60": "Lluvia ligera intermitente",
    "61": "Lluvia ligera continua",
    "62": "Lluvia moderada intermitente",
    "63": "Lluvia moderada continua",
    "64": "Lluvia fuerte intermitente",
    "65": "Lluvia fuerte continua",
    "66": "Lluvia helada ligera",
    "67": "Lluvia helada moderada o fuerte",
    "68": "Lluvia o llovizna y nieve, ligera",
    "69": "Lluvia o llovizna y nieve, moderada o fuerte",
    "70": "Nieve ligera intermitente",
    "71": "Nieve ligera continua",
    "72": "Nieve moderada intermitente",
    "73": "Nieve moderada continua",
    "74": "Nieve fuerte intermitente",
    "75": "Nieve fuerte continua",
    "76": "Prisma de hielo (diamante)",
    "77": "Nieve granulada",
    "78": "Cristales de nieve aislados",
    "79": "Granos de hielo",
    "80": "Chubasco(s) de lluvia ligera",
    "81": "Chubasco(s) de lluvia moderada o fuerte",
    "82": "Chubasco(s) de lluvia violenta",
    "83": "Chubasco(s) de lluvia y nieve ligera",
    "84": "Chubasco(s) de lluvia y nieve moderada/fuerte",
    "85": "Chubasco(s) de nieve ligera",
    "86": "Chubasco(s) de nieve moderada o fuerte",
    "87": "Chubasco(s) de granizo menudo / nieve granulada, ligero",
    "88": "Chubasco(s) de granizo menudo / nieve granulada, moderado/fuerte",
    "89": "Chubasco(s) de granizo, ligero",
    "90": "Chubasco(s) de granizo, moderado o fuerte",
    "91": "Lluvia ligera actual; tormenta en la hora precedente",
    "92": "Lluvia moderada/fuerte; tormenta en la hora precedente",
    "93": "Nieve o lluvia/nieve/granizo ligero; tormenta precedente",
    "94": "Nieve o lluvia/nieve/granizo moderado/fuerte; tormenta precedente",
    "95": "Tormenta leve o moderada, con lluvia y/o nieve",
    "96": "Tormenta leve o moderada, con granizo",
    "97": "Tormenta fuerte, con lluvia y/o nieve",
    "98": "Tormenta con tempestad de polvo/arena",
    "99": "Tormenta fuerte con granizo",
  };

  const PNG_WW = new Set(
    Array.from({ length: 44 }, (_, i) => String(i + 56).padStart(2, "0")).concat(["9999"])
  );

  function wwCode(ww) {
    if (ww == null || ww === "" || ww === "/") return null;
    return String(ww).padStart(2, "0");
  }

  function wwText(ww) {
    const code = wwCode(ww);
    if (!code) return null;
    return WW_TEXT[code] || `Código ww ${code}`;
  }

  function svgBox(inner, title) {
    return `<svg class="plot-ww plot-ww-svg" width="27" height="27" viewBox="0 0 27 27" xmlns="http://www.w3.org/2000/svg" title="${title || ""}">
      <rect width="27" height="27" fill="#000"/>
      ${inner}
    </svg>`;
  }

  /** Símbolos esquemáticos WMO (blanco sobre negro) para ww 00–55. */
  function wwSvg(ww) {
    const code = wwCode(ww);
    if (!code) return "";
    const t = wwText(code) || code;
    const ink = 'stroke="#fff" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    const fill = 'fill="#fff" stroke="none"';

    const map = {
      "00": `<circle cx="13.5" cy="13.5" r="5" ${ink}/>`,
      "01": `<path d="M8 16 Q13.5 8 19 16" ${ink}/>`,
      "02": `<path d="M7 13.5 H20 M13.5 7 V20" ${ink}/>`,
      "03": `<path d="M8 18 Q13.5 7 19 18" ${ink}/><path d="M10 14 L13.5 8 L17 14" ${ink}/>`,
      "04": `<path d="M9 8 Q7 13.5 9 19 M13.5 7 V20 M18 8 Q20 13.5 18 19" ${ink}/>`,
      "05": `<text x="13.5" y="18" text-anchor="middle" font-size="16" fill="#fff" font-family="serif">∞</text>`,
      "06": `<circle cx="13.5" cy="13.5" r="3.5" ${fill}/><circle cx="13.5" cy="13.5" r="7" ${ink}/>`,
      "07": `<path d="M7 9 L20 9 M9 13.5 H18 M7 18 H20" ${ink}/>`,
      "08": `<path d="M13.5 6 L16 12 L22 13.5 L16 15 L13.5 21 L11 15 L5 13.5 L11 12 Z" ${ink}/>`,
      "09": `<path d="M6 14 H21 M8 10 H19 M8 18 H19" ${ink}/><path d="M18 8 L22 13.5 L18 19" ${ink}/>`,
      "10": `<path d="M6 10 H21 M6 13.5 H21 M6 17 H21" ${ink}/>`,
      "11": `<path d="M6 11 H21 M6 16 H21" ${ink}/><circle cx="9" cy="13.5" r="1.4" ${fill}/>`,
      "12": `<path d="M6 11 H21 M6 16 H21" ${ink}/>`,
      "13": `<path d="M12 6 L10 14 H15 L12 21" fill="#fff" stroke="#fff" stroke-width="0.5"/>`,
      "14": `<path d="M8 8 L13.5 14 L19 8" ${ink}/><circle cx="13.5" cy="18" r="1.5" ${fill}/>`,
      "15": `<path d="M7 9 L13.5 15 L20 9" ${ink}/><circle cx="10" cy="19" r="1.3" ${fill}/><circle cx="17" cy="19" r="1.3" ${fill}/>`,
      "16": `<path d="M7 8 L13.5 14 L20 8" ${ink}/><circle cx="9" cy="18" r="1.2" ${fill}/><circle cx="13.5" cy="20" r="1.2" ${fill}/><circle cx="18" cy="18" r="1.2" ${fill}/>`,
      "17": `<path d="M12 5 L9 13 H14 L11 22" fill="#fff"/><path d="M16 8 L19 12" ${ink}/>`,
      "18": `<path d="M7 14 L13.5 7 L20 14 M10 14 L13.5 20 L17 14" ${ink}/>`,
      "19": `<path d="M13.5 5 L16 12 L22 14 L16 16 L13.5 23 L11 16 L5 14 L11 12 Z" fill="#fff"/>`,
      "20": `<circle cx="10" cy="12" r="1.4" ${fill}/><circle cx="17" cy="12" r="1.4" ${fill}/><circle cx="13.5" cy="18" r="1.4" ${fill}/>`,
      "21": `<circle cx="9" cy="11" r="1.5" ${fill}/><circle cx="15" cy="11" r="1.5" ${fill}/><circle cx="12" cy="17" r="1.5" ${fill}/><circle cx="18" cy="17" r="1.5" ${fill}/>`,
      "22": `<text x="8" y="12" font-size="9" fill="#fff">*</text><text x="15" y="12" font-size="9" fill="#fff">*</text><text x="11.5" y="20" font-size="9" fill="#fff">*</text>`,
      "23": `<circle cx="9" cy="12" r="1.3" ${fill}/><text x="15" y="15" font-size="10" fill="#fff">*</text>`,
      "24": `<circle cx="10" cy="11" r="1.3" ${fill}/><circle cx="17" cy="11" r="1.3" ${fill}/><path d="M8 18 H19" ${ink}/>`,
      "25": `<path d="M8 8 L13.5 14" ${ink}/><circle cx="15" cy="17" r="1.5" ${fill}/><circle cx="19" cy="12" r="1.5" ${fill}/>`,
      "26": `<path d="M8 8 L13.5 14" ${ink}/><text x="14" y="20" font-size="10" fill="#fff">*</text>`,
      "27": `<path d="M8 8 L13.5 14" ${ink}/><path d="M14 16 L17 20 L20 16 Z" fill="#fff"/>`,
      "28": `<path d="M6 11 H21 M6 16 H21" ${ink}/><path d="M18 8 L20 10" ${ink}/>`,
      "29": `<path d="M11 5 L8 13 H13 L10 22" fill="#fff"/><path d="M16 9 L19 13" ${ink}/>`,
      "40": `<path d="M6 11 H16 M6 16 H16" ${ink}/><path d="M18 9 L21 13.5 L18 18" ${ink}/>`,
      "41": `<path d="M6 11 H21 M6 16 H21" ${ink}/><circle cx="9" cy="13.5" r="1.2" ${fill}/><circle cx="18" cy="13.5" r="1.2" ${fill}/>`,
      "42": `<path d="M6 11 H21 M6 16 H21" ${ink}/><path d="M19 8 L19 19" ${ink}/>`,
      "43": `<path d="M6 10 H21 M6 13.5 H21 M6 17 H21" ${ink}/><path d="M19 7 L19 20" ${ink}/>`,
      "44": `<path d="M6 11 H21 M6 16 H21" ${ink}/>`,
      "45": `<path d="M6 10 H21 M6 13.5 H21 M6 17 H21" ${ink}/>`,
      "46": `<path d="M6 11 H21 M6 16 H21" ${ink}/><path d="M19 20 L19 9" ${ink}/>`,
      "47": `<path d="M6 10 H21 M6 13.5 H21 M6 17 H21" ${ink}/><path d="M19 20 L19 9" ${ink}/>`,
      "48": `<path d="M6 11 H21 M6 16 H21" ${ink}/><path d="M9 8 L11 10 M16 8 L18 10" ${ink}/>`,
      "49": `<path d="M6 10 H21 M6 13.5 H21 M6 17 H21" ${ink}/><path d="M9 7 L11 9 M16 7 L18 9" ${ink}/>`,
      "50": `<circle cx="10" cy="13.5" r="1.5" ${fill}/><circle cx="17" cy="13.5" r="1.5" ${fill}/>`,
      "51": `<circle cx="9" cy="11" r="1.5" ${fill}/><circle cx="18" cy="11" r="1.5" ${fill}/><circle cx="13.5" cy="18" r="1.5" ${fill}/>`,
      "52": `<circle cx="8" cy="11" r="1.5" ${fill}/><circle cx="13.5" cy="11" r="1.5" ${fill}/><circle cx="19" cy="11" r="1.5" ${fill}/><circle cx="11" cy="18" r="1.5" ${fill}/><circle cx="16" cy="18" r="1.5" ${fill}/>`,
      "53": `<circle cx="8" cy="10" r="1.4" ${fill}/><circle cx="13.5" cy="10" r="1.4" ${fill}/><circle cx="19" cy="10" r="1.4" ${fill}/><circle cx="10" cy="16" r="1.4" ${fill}/><circle cx="17" cy="16" r="1.4" ${fill}/><circle cx="13.5" cy="21" r="1.4" ${fill}/>`,
      "54": `<circle cx="7" cy="9" r="1.3" ${fill}/><circle cx="12" cy="9" r="1.3" ${fill}/><circle cx="17" cy="9" r="1.3" ${fill}/><circle cx="22" cy="9" r="1.3" ${fill}/><circle cx="9" cy="15" r="1.3" ${fill}/><circle cx="14.5" cy="15" r="1.3" ${fill}/><circle cx="20" cy="15" r="1.3" ${fill}/><circle cx="12" cy="21" r="1.3" ${fill}/><circle cx="18" cy="21" r="1.3" ${fill}/>`,
      "55": `<circle cx="7" cy="8" r="1.2" ${fill}/><circle cx="12" cy="8" r="1.2" ${fill}/><circle cx="17" cy="8" r="1.2" ${fill}/><circle cx="22" cy="8" r="1.2" ${fill}/><circle cx="9" cy="13.5" r="1.2" ${fill}/><circle cx="14.5" cy="13.5" r="1.2" ${fill}/><circle cx="20" cy="13.5" r="1.2" ${fill}/><circle cx="7" cy="19" r="1.2" ${fill}/><circle cx="12" cy="19" r="1.2" ${fill}/><circle cx="17" cy="19" r="1.2" ${fill}/><circle cx="22" cy="19" r="1.2" ${fill}/>`,
    };

    // Reutilizar familia por rangos
    const aliases = {
      "30": "09",
      "31": "09",
      "32": "09",
      "33": "09",
      "34": "09",
      "35": "09",
      "36": "22",
      "37": "22",
      "38": "22",
      "39": "22",
    };
    const key = aliases[code] || code;
    const inner =
      map[key] ||
      `<text x="13.5" y="17" text-anchor="middle" font-size="9" fill="#fff" font-family="monospace">${code}</text>`;
    return svgBox(inner, t);
  }

  function hasPng(ww) {
    const code = wwCode(ww);
    return code != null && PNG_WW.has(code);
  }

  function wwSymbolHtml(ww) {
    const code = wwCode(ww);
    if (!code) return "";
    const title = wwText(code) || code;
    if (hasPng(code)) {
      return `<img class="plot-ww" src="/img/simbolos/${code}.png" alt="${title}" title="${title}" draggable="false" />`;
    }
    return wwSvg(code);
  }

  global.PresentWeather = {
    WW_TEXT,
    wwCode,
    wwText,
    hasPng,
    wwSvg,
    wwSymbolHtml,
  };
})(window);
