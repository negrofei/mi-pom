/**
 * Pestaña Consulta (/consulta): METAR/SPECI | TAF + enmienda.
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

  function highlight(raw, reasons, side) {
    if (global.MetarPlot && typeof global.MetarPlot.highlightRawHtml === "function") {
      return global.MetarPlot.highlightRawHtml(raw, reasons || [], side);
    }
    const text = side === "taf" ? formatTaf(raw) : String(raw || "");
    return esc(text || "—");
  }

  function amendBlock(alert, tafRaw) {
    if (!alert) {
      return `<div class="lookup-amend-ok">Sin diferencia por umbrales de enmienda vs la obs. más reciente.</div>`;
    }
    if (global.MetarPlot && typeof global.MetarPlot.tafAmendPanelHtml === "function") {
      // Panel completo ya incluye Obs+TAF; en layout partido solo queremos motivos
      const reasons = Array.isArray(alert.reasons) ? alert.reasons : [];
      if (!reasons.length && alert.reason_labels) {
        return `<ul class="taf-amend-reasons">${alert.reason_labels
          .map((r) => `<li>${esc(String(r))}</li>`)
          .join("")}</ul>`;
      }
      const colorFn = global.MetarPlot.amendReasonColor || (() => "#1565c0");
      return `
        <div class="lookup-amend-head">
          <span class="taf-amend-badge">Posible enmienda TAF</span>
          ${alert.obs_product ? `· ${esc(alert.obs_product)}` : ""}
          ${alert.obs_iso ? `· ${esc(alert.obs_iso)}` : ""}
        </div>
        <ul class="taf-amend-reasons">${reasons
          .map((r) => {
            const color = colorFn(r.key);
            return `<li class="taf-amend-reason" style="--amend-hl:${color};border-left-color:${color}">
              <span class="taf-amend-reason-swatch" style="background:${color}" aria-hidden="true"></span>
              <span>${esc(String(r.label || r))}</span>
            </li>`;
          })
          .join("")}</ul>`;
    }
    const labels = alert.reason_labels || [];
    return `<ul class="taf-amend-reasons">${labels
      .map((r) => `<li>${esc(String(r))}</li>`)
      .join("")}</ul>`;
  }

  function stationHtml(st) {
    const taf = st.taf;
    const msgs = st.messages || [];
    const alert = st.taf_amend || null;
    const reasons = (alert && alert.reasons) || [];
    const latestIso = msgs[0] && msgs[0].obs_iso;

    const msgsHtml = msgs.length
      ? msgs
          .map((m, idx) => {
            const kind = m.is_speci || m.metar_type === "SPECI" ? "SPECI" : "METAR";
            const isLatest = idx === 0;
            const rawHtml =
              isLatest && reasons.length
                ? highlight(m.raw || "", reasons, "obs")
                : esc(m.raw || "—");
            return `
            <article class="lookup-msg${kind === "SPECI" ? " is-speci" : ""}${
              isLatest ? " is-latest" : ""
            }">
              <header>
                <span class="lookup-msg-kind">${esc(kind)}</span>
                <time>${esc(m.obs_iso || "—")}</time>
                ${catPill(m.flt_cat)}
                ${isLatest ? `<span class="lookup-latest-tag">vs TAF</span>` : ""}
              </header>
              <pre class="raw taf-amend-raw">${rawHtml}</pre>
            </article>`;
          })
          .join("")
      : `<div class="lookup-empty">Sin METAR/SPECI en la ventana pedida.</div>`;

    const tafBody =
      taf && taf.raw
        ? `<div class="lookup-taf-meta">
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
          <pre class="raw taf-raw taf-amend-raw">${highlight(taf.raw, reasons, "taf")}</pre>`
        : `<div class="lookup-empty">Sin TAF disponible.</div>`;

    const amendHtml =
      taf && taf.raw
        ? `<div class="lookup-amend">${amendBlock(alert, taf.raw)}</div>`
        : "";

    return `
      <section class="lookup-station${st.has_taf_amend ? " has-amend" : ""}" data-icao="${esc(
        st.icao
      )}">
        <header class="lookup-station-head">
          <h2><strong>${esc(st.icao)}</strong> ${esc(st.nombre || "")}
            ${st.has_taf_amend ? `<span class="taf-amend-badge">TAF AMD?</span>` : ""}
          </h2>
          <div class="lookup-station-meta">
            ${st.fir ? `FIR ${esc(st.fir)} · ` : ""}
            ${msgs.length} obs
            ${taf && taf.raw ? " · TAF" : ""}
            ${latestIso ? ` · ref ${esc(latestIso)}` : ""}
          </div>
        </header>
        <div class="lookup-split">
          <div class="lookup-col lookup-col-obs">
            <div class="lookup-col-title">METAR / SPECI</div>
            <div class="lookup-msg-list">${msgsHtml}</div>
          </div>
          <div class="lookup-col lookup-col-taf">
            <div class="lookup-col-title">TAF</div>
            <div class="lookup-taf">${tafBody}</div>
            ${amendHtml}
          </div>
        </div>
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
      amend: "1",
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
