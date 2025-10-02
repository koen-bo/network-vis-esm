// Wire DOM to graph methods + metrics
import { parseFile, normalizeData, sampleData } from './data.js';
import { MetricsRunner } from './metrics.js';

const runner = new MetricsRunner();

export function mountUI(graph) {
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const closeMenu = document.getElementById('closeMenu');

  // Hamburger
  menuBtn.onclick = () => { menu.classList.toggle('open'); menu.setAttribute('aria-hidden', String(!menu.classList.contains('open'))); };
  closeMenu.onclick = () => { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target.id !== 'menuBtn') { menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); } });

  // Export buttons are not included in this build to keep UI minimal

  // Load sample
  document.getElementById('loadSample').onclick = () => { graph.setData(sampleData.nodes, sampleData.links); };

  // Load files
  document.getElementById('btnLoadFiles').onclick = async () => {
    const fNodes = document.getElementById('fileNodes').files[0];
    const fLinks = document.getElementById('fileLinks').files[0];
    if (!fNodes || !fLinks) { alert('Please select both nodes and links files (CSV or JSON).'); return; }
    try {
      let nodes = await parseFile(fNodes);
      let links = await parseFile(fLinks);
      if (!Array.isArray(nodes) && nodes.nodes) nodes = nodes.nodes;
      if (!Array.isArray(links) && links.links) links = links.links;
      const data = normalizeData(nodes, links);
      graph.setData(data.nodes, data.links);
      menu.classList.remove('open');
    } catch (e) { console.error(e); alert('Failed to parse files. Check the console for details.'); }
  };

  // Search
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

  // Reset visualization
  document.getElementById('btnResetVis').onclick = () => graph.reset();

  // Attr dropdowns
  const colorSel = document.getElementById('colorAttr');
  const filterSel = document.getElementById('filterAttr');
  function refreshAttrDropdowns() {
    const attrs = Array.from(new Set(graph.getNodes().flatMap(n => Object.keys(n))))
      .filter(k => !['id','name','x','y','vx','vy','fx','fy','index'].includes(k));
    colorSel.innerHTML = ''; filterSel.innerHTML = '';
    if (!attrs.length) {
      const opt = document.createElement('option'); opt.value = ''; opt.textContent = 'No attributes';
      colorSel.appendChild(opt.cloneNode(true)); filterSel.appendChild(opt);
      return;
    }
    attrs.forEach(a => {
      const o1 = document.createElement('option'); o1.value = a; o1.textContent = a; colorSel.appendChild(o1);
      const o2 = document.createElement('option'); o2.value = a; o2.textContent = a; filterSel.appendChild(o2);
    });
    colorSel.value = graph.colorAttr || attrs[0];
    filterSel.value = graph.filterAttr || attrs[0];
  }
  colorSel.onchange = () => graph.recolor(colorSel.value);
  filterSel.onchange = () => graph.setFilterAttr(filterSel.value);

  // Metrics UI
  let MetricsState = {
    computed: false, useWeights: true, resolution: 1.0,
    sizeMetric: 'none', minRadius: 6, maxRadius: 16, domains: {}
  };
  const badge = document.getElementById('metricsBadge');
  const spinner = document.getElementById('metricsSpinner');
  const btnCompute = document.getElementById('btnComputeMetrics');
  const resSlider = document.getElementById('resSlider');
  const resVal = document.getElementById('resVal');
  const chkUseWeights = document.getElementById('chkUseWeights');
  const summary = document.getElementById('metricsSummary');
  const sizeSel = document.getElementById('sizeMetric');
  const minR = document.getElementById('minRadius');
  const maxR = document.getElementById('maxRadius');
  const minRVal = document.getElementById('minRadiusVal');
  const maxRVal = document.getElementById('maxRadiusVal');

  const setSpin = (b)=>{ spinner.style.display = b?'inline':'none'; btnCompute.disabled = b; };
  const updateBadge = ()=>{ badge.style.display = MetricsState.computed ? 'inline-flex' : 'none'; };
  resVal.textContent = resSlider.value;
  resSlider.oninput = ()=> resVal.textContent = resSlider.value;
  resSlider.onchange = ()=> MetricsState.resolution = +resSlider.value;
  chkUseWeights.onchange = ()=> MetricsState.useWeights = chkUseWeights.checked;

  btnCompute.onclick = async () => {
    setSpin(true);
    try {
      const payload = {
        nodes: graph.getNodes().map(n => ({ id: n.id })),
        links: graph.getLinks().map(l => ({ source: (l.source.id ?? l.source), target: (l.target.id ?? l.target), weight: l.weight })),
        useWeights: MetricsState.useWeights,
        louvainResolution: MetricsState.resolution,
      };
      const out = await runner.compute(payload);
      // annotate nodes
      const nm = out.nodeMetrics;
      graph.getNodes().forEach(n => {
        const m = nm[n.id];
        if (!m) return;
        n.degree_in_w = m.degree_in_w;
        n.degree_out_w = m.degree_out_w;
        n.degree_total_w = m.degree_total_w;
        n.eigenvector_raw = m.eigenvector_raw;
        n.eigenvector = m.eigenvector;
        n.community_id = out.communities[n.id];
      });
      // annotate edges
      graph.getLinks().forEach((l, i) => {
        const f = out.edgeFlags[i];
        if (!f) return;
        l.intraCommunity = f.intraCommunity;
        l.bridgeEdge = f.bridgeEdge;
      });
      // refresh dropdowns and default to community coloring
      refreshAttrDropdowns();
      if ([...colorSel.options].some(o=>o.value==='community_id')) {
        colorSel.value = 'community_id';
        colorSel.dispatchEvent(new Event('change'));
      }
      // degree domains
      const keys = ['degree_total_w','degree_in_w','degree_out_w'];
      keys.forEach(k => {
        const vals = graph.getNodes().map(n => Number(n[k]) || 0);
        MetricsState.domains[k] = { min: Math.min(...vals), max: Math.max(...vals) };
      });
      // summary
      const commCount = new Set(graph.getNodes().map(n => n.community_id)).size;
      const top = out.topEigenvector.map(t => `${t.id}: ${t.score.toFixed(3)}`).join('<br/>');
      summary.innerHTML = `communities: <b>${commCount}</b><br/>modularity Q: <b>${(out.modularityQ||0).toFixed(3)}</b><br/>top eigenvector:<br/>${top}`;

      MetricsState.computed = true; updateBadge();
    } catch (e) {
      console.error(e); alert('Metrics computation failed. See console for details.');
    } finally {
      setSpin(false);
    }
  };

  function buildRadiusProvider() {
    const metric = sizeSel.value;
    const minRv = +minR.value, maxRv = +maxR.value;
    if (metric === 'none') return (d)=>8;
    if (metric === 'eigenvector') return (d)=>{
      const v = Number.isFinite(d.eigenvector) ? d.eigenvector : 0;
      return Math.max(minRv, Math.min(maxRv, minRv + v*(maxRv-minRv)));
    };
    const dom = MetricsState.domains[metric];
    if (!dom || dom.max <= dom.min) return (d)=>minRv;
    return (d)=>{
      const raw = Number.isFinite(d[metric]) ? d[metric] : 0;
      const t = (raw - dom.min) / (dom.max - dom.min);
      return Math.max(minRv, Math.min(maxRv, minRv + t*(maxRv-minRv)));
    };
  }
  const syncVals = ()=>{ minRVal.textContent = minR.value; maxRVal.textContent = maxR.value; };
  sizeSel.onchange = ()=> graph.setRadiusProvider(buildRadiusProvider());
  minR.oninput = ()=>{ syncVals(); graph.setRadiusProvider(buildRadiusProvider()); };
  maxR.oninput = ()=>{ syncVals(); graph.setRadiusProvider(buildRadiusProvider()); };
  syncVals();

  // Public method so main.js can refresh after setData
  function refreshAttrDropdownsPublic(){ refreshAttrDropdowns(); }
  // After initial data load
  return { refreshAttrDropdowns: refreshAttrDropdownsPublic };
}
