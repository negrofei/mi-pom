/**
 * Pestaña Consulta: METAR/SPECI/TAF por ICAO (estilo AviationWeather).
 */
(function (global) {
  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTaf(raw) {
    if (global.MetarPlot && typeof global.MetarPlot.formatTafDisplay === "function") {
      return global.MetarPlot.formatTafDisplay(raw);
    }
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s+(?=BECMG\b)/gi, "\n")
      .replace(/\s+(?=PROB\d{2}\b)/gi, "\n")
      .replace(/(?<!PROB\d{2})\s+(?=TEMPO\b)/gi, "\n");
  }

  function parseIdsInput(value) {
    return String(value || "")
      .toUpperCase()
      .split(/[\s,;]+/)
      .map((t) => t.replace(/[^A-Z]/g, ""))
      .filter((t) => t.length === 4)
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 40);
  }

  function catPill(cat) {
    if (!cat) return "";
    const meta =
      (global.MetarPlot && global.MetarPlot.catMeta && global.MetarPlot.catMeta(cat)) || {
        color: "#888",
        label: cat,
      };
    return `<span class="flt-pill" style="background:${meta.color}">${esc(meta.label || cat)}</span>`;
  }

  function stationHtml(st) {
    const taf = st.taf;
    const msgs = st.messages || [];
    const msgsHtml = msgs.length
      ? msgs
          .map((m) => {
            const kind = m.is_speci || m.metar_type === "SPECI" ? "SPECI" : "METAR";
            return `
            <article class="lookup-msg${kind === "SPECI" ? " is-speci" : ""}">
              <header>
                <span class="lookup-msg-kind">${esc(kind)}</span>
                <time>${esc(m.obs_iso || "—")}</time>
                ${catPill(m.flt_cat)}
              </header>
              <pre class="raw">${esc(m.raw || "—")}</pre>
            </article>`;
          })
          .join("")
      : `<div class="lookup-empty">Sin METAR/SPECI en la ventana pedida.</div>`;

    const tafHtml = taf && taf.raw
      ? `<div class="lookup-taf">
          <div class="lookup-taf-meta">
            <span class="lookup-badge taf">TAF</span>
            ${taf.issue_iso ? `<span>emisión ${esc(taf.issue_iso)}</span>` : ""}
            ${
              taf.valid_from_iso || taf.valid_to_iso
                ? `<span>válido ${esc(taf.valid_from_iso || "—")} → ${esc(
                    taf.valid_to_iso || "—"
                  )}</span>`
                : ""
            }
          </div>
          <pre class="raw taf-raw">${esc(formatTaf(taf.raw))}</pre>
        </div>`
      : `<div class="lookup-empty">Sin TAF disponible.</div>`;

    return `
      <section class="lookup-station" data-icao="${esc(st.icao)}">
        <header class="lookup-station-head">
          <h2><strong>${esc(st.icao)}</strong> ${esc(st.nombre || "")}</h2>
          <div class="lookup-station-meta">
            ${st.fir ? `FIR ${esc(st.fir)} · ` : ""}
            ${msgs.length} obs
            ${taf && taf.raw ? " · TAF" : ""}
          </div>
        </header>
        ${tafHtml}
        <div class="lookup-msg-list">${msgsHtml}</div>
      </section>`;
  }

  function resultsHtml(payload) {
    const stations = payload.stations || [];
    if (!stations.length) {
      return `<div class="lookup-empty">Sin resultados.</div>`;
    }
    return stations.map(stationHtml).join("");
  }

  async function runLookup({ ids, hours, includeTaf }) {
    const list = Array.isArray(ids) ? ids : parseIdsInput(ids);
    if (!list.length) {
      throw new Error("Indicá al menos un ICAO de 4 letras");
    }
    const q = new URLSearchParams({
      ids: list.join(","),
      hours: String(hours || 6),
      taf: includeTaf ? "1" : "0",
    });
    const res = await fetch(`/api/lookup?${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Error de consulta");
    return data;
  }

  global.AwLookup = {
    parseIdsInput,
    resultsHtml,
    runLookup,
    stationHtml,
  };
})(window);
