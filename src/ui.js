// src/ui.js — full file (with Python backend toggle + JS worker fallback)
import { parseFile, normalizeData, sampleData } from './data.js';
import { MetricsRunner } from './metrics.js';

const runner = new MetricsRunner();

export function mountUI(graph) {
  // ===== Menu / data loading =====
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const closeMenu = document.getElementById('closeMenu');

  menuBtn.onclick = () => {
    menu.classList.toggle('open');
    menu.setAttribute('aria-hidden', String(!menu.classList.contains('open')));
  };
  closeMenu.onclick = () => {
    menu.classList.remove('open');
    menu.setAttribute('aria-hidden', 'true');
  };
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && e.target.id !== 'menuBtn') {
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
    }
  });

  // Load sample
  document.getElementById('loadSample').onclick = () => {
    graph.setData(sampleData.nodes, sampleData.links);
  };

  // Load files (nodes + links)
  document.getElementById('btnLoadFiles').onclick = async () => {
    const fNodes = document.getElementById('fileNodes').files[0];
    const fLinks = document.getElementById('fileLinks').files[0];
    if (!fNodes || !fLinks) {
      alert('Please select both nodes and links files (CSV or JSON).');
      return;
    }
    try {
      let nodes = await parseFile(fNodes);
      let links = await parseFile(fLinks);
      if (!Array.isArray(nodes) && nodes.nodes) nodes = nodes.nodes;
      if (!Array.isArray(links) && links.links) links = links.links;
      const data = normalizeData(nodes, links);
      graph.setData(data.nodes, data.links);
      menu.classList.remove('open');
      menu.setAttribute('aria-hidden', 'true');
      ui.refreshAttrDropdowns();
    } catch (e) {
      console.error(e);
      alert('Failed to parse files. Check the console for details.');
    }
  };

  // ===== Search / focus =====
  document.getElementById('btnClearSearch').onclick = () => {
    document.getElementById('search').value = '';
    d3.selectAll('g.node circle').classed('highlight', false);
  };
  document.getElementById('btnFocusSelected').onclick = () => {
    const q = document.getElementById('search').value.trim();
    if (!q) return;
    const ok = graph.focusOnNodeByName(q);
    if (!ok) alert('No matching node found.');
  };
  document.getElementById('search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnFocusSelected').click();
  });

  // ===== Reset =====
  document.getElementById('btnResetVis').onclick = () => graph.reset();

  // ===== Color / Filter dropdowns =====
  const colorSel = document.getElementById('colorAttr');
  const filterSel = document.getElementById('filterAttr');

  function refreshAttrDropdowns() {
    const attrs = Array.from(new Set(graph.getNodes().flatMap(n => Object.keys(n))))
      .filter(k => !['id','name','x','y','vx','vy','fx','fy','index'].includes(k));
    colorSel.innerHTML = '';
    filterSel.innerHTML = '';

    if (!attrs.length) {
      const opt = document.createElement('option'); 
      opt.value = ''; 
      opt.textContent = 'No attributes';
      colorSel.appendChild(opt.cloneNode(true));
      filterSel.appendChild(opt);
      return;
    }

    attrs.forEach(a => {
      const o1 = document.createElement('option'); o1.value = a; o1.textContent = a; colorSel.appendChild(o1);
      const o2 = document.createElement('option'); o2.value = a; o2.textContent = a; filterSel.appendChild(o2);
    });

    // Keep current selections if possible; otherwise default to first attr
    colorSel.value = attrs.includes(graph.colorAttr) ? graph.colorAttr : attrs[0];
    filterSel.value = attrs.includes(graph.filterAttr) ? graph.filterAttr : attrs[0];
  }

  colorSel.onchange = () => graph.recolor(colorSel.value);
  filterSel.onchange = () => graph.setFilterAttr(filterSel.value);

  // ===== Analyze (metrics) panel =====
  const badge = document.getElementById('metricsBadge');
  const spinner = document.getElementById('metricsSpinner');
  const progressEl = document.getElementById('metricsProgress'); // optional (may not exist if you didn't add it)
  const btnCompute = document.getElementById('btnComputeMetrics');
  const btnCancel = document.getElementById('btnCancelMetrics'); // optional
  const resSlider = document.getElementById('resSlider');
  const resVal = document.getElementById('resVal');
  const chkUseWeights = document.getElementById('chkUseWeights');
  const chkUsePython = document.getElementById('chkUsePython'); // new toggle
  const summary = document.getElementById('metricsSummary');

  const PY_METRICS_URL = 'http://127.0.0.1:8000/metrics';

  // Internal metrics state (for sizing domains)
  const MetricsState = {
    computed: false,
    useWeights: true,
    resolution: 1.0,
    domains: {} // degree domains for sizing
  };

  const setSpin = (b) => {
    spinner.style.display = b ? 'inline' : 'none';
    btnCompute.disabled = b;
    if (btnCancel) btnCancel.disabled = !b;
    if (progressEl) {
      progressEl.style.display = b ? 'block' : 'none';
      if (!b) progressEl.textContent = '';
    }
  };
  const updateBadge = () => {
    badge.style.display = MetricsState.computed ? 'inline-flex' : 'none';
  };

  resVal.textContent = resSlider.value;
  resSlider.oninput = () => resVal.textContent = resSlider.value;
  resSlider.onchange = () => MetricsState.resolution = +resSlider.value;
  chkUseWeights.onchange = () => MetricsState.useWeights = chkUseWeights.checked;

  // Listen to worker progress (if available)
  if (runner.worker && progressEl) {
    runner.worker.onmessage = (ev) => {
      const m = ev.data || ev;
      if (!m) return;
      if (m.type === 'metrics_progress') {
        progressEl.textContent = `${m.phase}${m.detail ? ': ' + JSON.stringify(m.detail) : ''}`;
      } else if (m.type === 'metrics_error') {
        alert('Metrics error: ' + m.error);
        setSpin(false);
      }
    };
  }
  if (btnCancel && runner.worker) {
    btnCancel.onclick = () => runner.worker.postMessage({ type: 'cancel_metrics' });
  }

 btnCompute.onclick = async () => {
  setSpin(true);
  try {
    const payload = {
      nodes: graph.getNodes().map(n => ({ id: n.id })), // minimal payload
      links: graph.getLinks().map(l => ({
        source: (l.source.id ?? l.source),
        target: (l.target.id ?? l.target),
        weight: l.weight
      })),
      useWeights: chkUseWeights.checked,
      louvainResolution: +resSlider.value,
    };

    let out;
    if (chkUsePython && chkUsePython.checked) {
      // ---- Python backend path ----
      const resp = await fetch(PY_METRICS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error('Backend error: ' + resp.status + ' ' + text);
      }
      out = await resp.json();
    } else {
      // ---- JS worker fallback ----
      out = await runner.compute(payload);
    }

    // === 1) Annotate nodes with metrics ===
    const nm = out.nodeMetrics || {};
    graph.getNodes().forEach(n => {
      const m = nm[n.id];
      if (!m) return;
      n.degree_in_w     = m.degree_in_w;
      n.degree_out_w    = m.degree_out_w;
      n.degree_total_w  = m.degree_total_w;
      n.eigenvector_raw = m.eigenvector_raw;
      n.eigenvector     = m.eigenvector;
      n.community_id    = (out.communities || {})[n.id];
    });

    // === 2) Annotate edges with flags ===
    graph.getLinks().forEach((l, i) => {
      const f = (out.edgeFlags || {})[i];
      if (!f) return;
      l.intraCommunity = f.intraCommunity;
      l.bridgeEdge     = f.bridgeEdge;
    });

    // >>> IMPORTANT: mark metrics as available *before* sizing logic runs
    MetricsState.computed = true;

    // === 3) Force repaint for current color + prep for size ===
    graph.recolor(graph.colorAttr); // repaint with current color attribute

    // === 4) (Re)build degree domains for sizing & apply size provider now ===
    const keys = ['degree_total_w','degree_in_w','degree_out_w'];
    keys.forEach(k => {
      const vals = graph.getNodes().map(n => Number(n[k]) || 0);
      MetricsState.domains[k] = { min: Math.min(...vals), max: Math.max(...vals) };
    });
    graph.setRadiusProvider(buildRadiusProvider()); // now MetricsState.computed === true

    // === 5) Update dropdowns & explicitly switch to community coloring ===
    refreshAttrDropdowns();
    const colorSel = document.getElementById('colorAttr');
    const filterSel = document.getElementById('filterAttr');
    if ([...colorSel.options].some(o => o.value === 'community_id')) {
      colorSel.value = 'community_id';
      filterSel.value = 'community_id';
      graph.setFilterAttr('community_id');
      graph.recolor('community_id'); // direct call avoids event race
    } else {
      graph.recolor(graph.colorAttr);
    }

    // === 6) Summary ===
    const commCount = new Set(graph.getNodes().map(n => n.community_id)).size;
    const top = (out.topEigenvector || [])
      .map(t => `${t.id}: ${Number(t.score).toFixed(3)}`)
      .join('<br/>');
    summary.innerHTML =
      `communities: <b>${commCount}</b><br/>` +
      `modularity Q: <b>${Number(out.modularityQ || 0).toFixed(3)}</b><br/>` +
      `top eigenvector:<br/>${top}`;

    updateBadge();
  } catch (e) {
    console.error(e);
    alert('Metrics computation failed. ' + (e.message || e));
  } finally {
    setSpin(false);
  }
};


  // ===== Sizing controls =====
  const sizeSel = document.getElementById('sizeMetric');
  const minR = document.getElementById('minRadius');
  const maxR = document.getElementById('maxRadius');
  const minRVal = document.getElementById('minRadiusVal');
  const maxRVal = document.getElementById('maxRadiusVal');

  const syncRLabels = () => { minRVal.textContent = minR.value; maxRVal.textContent = maxR.value; };

 function buildRadiusProvider() {
  // Current UI selections
  const metric = sizeSel.value;                // "none" | "eigenvector" | "degree_total_w" | "degree_in_w" | "degree_out_w"
  const minRv = +minR.value;                   // lower bound (slider)
  const maxRv = +maxR.value;                   // upper bound (slider)

  // Helper: clamp to [minRv, maxRv]
  const clamp = (r) => Math.max(minRv, Math.min(maxRv, r));

  // If no metric, use a uniform size that still respects min slider
  if (metric === 'none') {
    return () => clamp(minRv);
  }

  // If metrics haven’t been computed yet, fall back to uniform (prevents NaN when user picks a size metric first)
  if (!MetricsState || !MetricsState.computed) {
    return () => clamp(minRv);
  }

  // Eigenvector: already normalized to [0,1]
  if (metric === 'eigenvector') {
    return (d) => {
      const v = Number.isFinite(d.eigenvector) ? d.eigenvector : 0;  // 0..1
      return clamp(minRv + v * (maxRv - minRv));
    };
  }

  // Degree metrics (raw) — rescale to [minRv, maxRv] using observed domain
  const dom = MetricsState.domains && MetricsState.domains[metric];
  if (!dom || !Number.isFinite(dom.min) || !Number.isFinite(dom.max) || dom.max <= dom.min) {
    // Domain missing or flat — show minimal variation
    return () => clamp(minRv);
  }

  const span = dom.max - dom.min;
  return (d) => {
    const raw = Number.isFinite(d[metric]) ? d[metric] : 0;
    const t = (raw - dom.min) / span;          // 0..1
    return clamp(minRv + t * (maxRv - minRv));
  };
}


  sizeSel.onchange = () => graph.setRadiusProvider(buildRadiusProvider());
  minR.oninput = () => { syncRLabels(); graph.setRadiusProvider(buildRadiusProvider()); };
  maxR.oninput = () => { syncRLabels(); graph.setRadiusProvider(buildRadiusProvider()); };
  syncRLabels();

  // ===== Public API for main.js =====
  const ui = {
    refreshAttrDropdowns: () => refreshAttrDropdowns()
  };

  return ui;
}
