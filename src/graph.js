// D3 Graph module
import { CONFIG, hooks } from './config.js';

const uid = () => Math.random().toString(36).slice(2);
const safe = (v) => v === undefined || v === null ? '' : String(v);

function buildColorScale(values) {
  const scheme = [
    '#38bdf8','#a78bfa','#f472b6','#f59e0b','#34d399','#60a5fa','#f87171','#22d3ee','#c084fc','#fb7185',
    '#fbbf24','#4ade80','#93c5fd','#fca5a5','#22c55e','#eab308','#06b6d4','#d946ef','#10b981','#f97316'
  ];
  const m = new Map(); let i = 0;
  values.forEach(v => { if (!m.has(v)) m.set(v, scheme[i++ % scheme.length]); });
  return (v) => m.get(v) || '#94a3b8';
}

function uniqueValues(arr, accessor) {
  return Array.from(new Set(arr.map(accessor)));
}

function indexBy(arr, key) {
  const m = new Map(); arr.forEach(d => m.set(d[key], d)); return m;
}

export class Graph {
  constructor(svgEl) {
    this.svg = d3.select(svgEl);
    this.g = this.svg.append('g');
    this.linkG = this.g.append('g').attr('stroke-linecap','round');
    this.nodeG = this.g.append('g');
    this.labelG = this.g.append('g');
    this.tooltip = d3.select('#tooltip');

    this.nodes = [];
    this.links = [];
    this.nodeById = new Map();

    this.colorAttr = null;
    this.filterAttr = null;
    this.selectedFilterValues = new Set();
    this.colorScale = () => '#94a3b8';

    // radius provider (can be overridden by UI)
    this.radiusProvider = (d) => hooks.nodeRadius(d);

    // Zoom/pan
    this.zoom = d3.zoom().scaleExtent([CONFIG.ui.zoomMin, CONFIG.ui.zoomMax]).on('zoom', (event) => {
      this.g.attr('transform', event.transform);
    });
    this.svg.call(this.zoom);

    // Forces (gentle compactness to reduce elongation)
    this.sim = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(CONFIG.forces.linkDistance))
      .force('charge', d3.forceManyBody().strength(CONFIG.forces.charge))
      .force('center', d3.forceCenter(0, 0))
      .force('collide', d3.forceCollide().radius(d => this.radiusProvider(d) + 2))
      .force('x', d3.forceX(0).strength(0.025))
      .force('y', d3.forceY(0).strength(0.025))
      .force('radial', d3.forceRadial(0, 0, 0).strength(0.006));

    this.linkSel = null;
    this.nodeSel = null;
    this.labelSel = null;

    this.updateForcesForViewport();
    window.addEventListener('resize', () => this.updateForcesForViewport());
  }

  // Measure the actual SVG viewport on screen
  getViewportSize() {
    const r = this.svg.node()?.getBoundingClientRect();
    return { w: Math.max(1, r?.width || 1200), h: Math.max(1, r?.height || 800) };
  }

  // Re-center forces to viewport center
  updateForcesForViewport() {
    const { w, h } = this.getViewportSize();
    const cx = w / 2, cy = h / 2;
    this.sim.force('center', d3.forceCenter(cx, cy));
    this.sim.force('x', d3.forceX(cx).strength(0.025));
    this.sim.force('y', d3.forceY(cy).strength(0.025));
    this.sim.force('radial', d3.forceRadial(0, cx, cy).strength(0.006));
    this.sim.alpha(0.1).restart();
  }

  // Reset any previous transform before computing a new absolute transform
  _resetZoomIdentity() {
    this.svg.attr('viewBox', null);
    this.svg.call(this.zoom.transform, d3.zoomIdentity);
  }

  setData(newNodes, newLinks) {
    this.nodes = newNodes.map(d => ({ ...d }));
    this.links = newLinks.map(d => ({ ...d }));
    this.nodeById = indexBy(this.nodes, 'id');

    const attrs = this.nodeAttrs();
    this.colorAttr = attrs.includes('group') ? 'group' : (attrs[0] || null);
    this.filterAttr = this.colorAttr;
    this.rebuildColorScale();

    this.draw();
    this.buildNeighborSets();
    this.populateSearch();
    this.buildLegendAndFilters();

    // Fit after short settle
    d3.timeout(() => this.fitToScreen(24), 600);
  }

  nodeAttrs() {
    const skip = ['id','name','x','y','vx','vy','fx','fy','index'];
    return Array.from(new Set(this.nodes.flatMap(n => Object.keys(n)))).filter(k => !skip.includes(k));
  }

  rebuildColorScale() {
    const vals = this.colorAttr ? uniqueValues(this.nodes, n => n[this.colorAttr]) : [];
    this.colorScale = buildColorScale(vals);
  }

  draw() {
    // Links
    this.linkSel = this.linkG.selectAll('line').data(this.links, d => d.id || (d.id = uid()));
    this.linkSel.exit().remove();
    const linkEnter = this.linkSel.enter().append('line')
      .attr('class', 'link')
      .attr('stroke', '#334155')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', e => hooks.edgeWidth(e));
    this.linkSel = linkEnter.merge(this.linkSel);

    // Nodes
    this.nodeSel = this.nodeG.selectAll('g.node').data(this.nodes, d => d.id);
    this.nodeSel.exit().remove();
    const nodeEnter = this.nodeSel.enter().append('g')
      .attr('class', 'node')
      .call(d3.drag()
        .on('start', (ev,d)=>this.dragstarted(ev,d))
        .on('drag',  (ev,d)=>this.dragged(ev,d))
        .on('end',   (ev,d)=>this.dragended(ev,d)))
      .on('click',   (_, d) => this.selectNode(d))
      .on('mouseover', (_, d) => { this.showTooltip(d); this.highlightNeighbors(d.id); })
      .on('mouseout',  () => { this.hideTooltip(); this.clearHighlight(); })
      .on('dblclick',  (_, d) => { d.fx = null; d.fy = null; this.sim.alpha(0.7).restart(); });

    nodeEnter.append('circle')
      .attr('r',    d => this.radiusProvider(d))
      .attr('fill', d => this.colorScale(d[this.colorAttr]));
    this.nodeSel = nodeEnter.merge(this.nodeSel);

    // Labels
    this.labelSel = this.labelG.selectAll('text').data(this.nodes, d => d.id);
    this.labelSel.exit().remove();
    const labelEnter = this.labelSel.enter().append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -(this.radiusProvider(d) + 2)) // closer than before
      .text(d => hooks.labelText(d));
    this.labelSel = labelEnter.merge(this.labelSel);

    // Sim
    this.sim.nodes(this.nodes).on('tick', () => this.ticked());
    this.sim.force('link').links(this.links);
    this.updateForcesForViewport();
    this.sim.alpha(1).restart();

    this.applyFilters();
    this.recolorNodes();
  }

  ticked() {
    this.linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);

    this.nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);

    // labels stay just above the circle edge (radius + 2)
    this.labelSel
      .attr('x', d => d.x)
      .attr('y', d => d.y - (this.radiusProvider(d) + 2));
  }

  dragstarted(event, d) { if (!event.active) this.sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  dragended(event, d) { if (!event.active) this.sim.alphaTarget(0); }

  showTooltip(d) {
    const rect = this.svg.node()?.getBoundingClientRect() ?? { left:0, top:0 };
    d3.select('#tooltip')
      .html(`<b>${safe(d.name ?? d.id)}</b><br/><span class="hint">${safe(hooks.tooltipLine2(d))}</span>`)
      .style('left', (d.x + rect.left + 14) + 'px')
      .style('top',  (d.y + rect.top  - 10) + 'px')
      .style('opacity', 1);
  }
  hideTooltip() { d3.select('#tooltip').style('opacity', 0); }

  selectNode(d) {
    this.nodeSel.selectAll('circle').classed('highlight', n => n.id === d.id);
    const kv = document.getElementById('details');
    kv.innerHTML = '';
    const title = document.createElement('div'); title.className = 'title-name'; title.textContent = safe(d.name ?? d.id); kv.appendChild(title);
    const hidden = ['x','y','vx','vy','fx','fy','index'];
    const entries = Object.entries(d).filter(([k]) => !hidden.includes(k) && k !== 'id' && k !== 'name');
    entries.forEach(([k,v]) => {
      const key = document.createElement('div'); key.className = 'label'; key.textContent = k;
      const val = document.createElement('div'); val.textContent = safe(v);
      kv.appendChild(key); kv.appendChild(val);
    });
    const key = document.createElement('div'); key.className = 'label'; key.textContent = 'id';
    const val = document.createElement('div'); val.textContent = safe(d.id);
    kv.appendChild(key); kv.appendChild(val);
  }

  focusOnNodeByName(name) {
    let target = this.nodes.find(n => (n.name ?? n.id).toLowerCase() === name.toLowerCase());
    if (!target) target = this.fuzzyFindNode(name);
    if (!target) return false;

    this.selectNode(target);

    // Work in absolute/world coords: reset zoom first
    this._resetZoomIdentity();

    const k = CONFIG.ui.focusScale;
    const { w, h } = this.getViewportSize();
    const t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(k)
      .translate(-target.x, -target.y);

    this.svg.transition().duration(700).call(this.zoom.transform, t);
    this.nodeSel.selectAll('circle').classed('highlight', n => n.id === target.id);
    return true;
  }

  // simple fuzzy
  fuzzyFindNode(query) {
    const q = query.toLowerCase();
    let exact = this.nodes.find(n => (n.name ?? n.id).toLowerCase() === q) || this.nodes.find(n => n.id.toLowerCase() === q);
    if (exact) return exact;
    let sub = this.nodes.find(n => (n.name ?? n.id).toLowerCase().includes(q));
    if (sub) return sub;
    let pre = this.nodes.find(n => (n.name ?? n.id).toLowerCase().startsWith(q));
    if (pre) return pre;
    return null;
  }

  // Neighbor highlight support
  buildNeighborSets() {
    this.neighbors = new Map();
    this.nodes.forEach(n => this.neighbors.set(n.id, new Set([n.id])));
    this.links.forEach(l => {
      const a = l.source.id ?? l.source;
      const b = l.target.id ?? l.target;
      this.neighbors.get(a).add(b);
      this.neighbors.get(b).add(a);
    });
  }
  highlightNeighbors(nodeId) {
    if (!this.neighbors) this.buildNeighborSets();
    const nbrs = this.neighbors.get(nodeId) || new Set([nodeId]);
    this.nodeSel.classed('neighbor', d => nbrs.has(d.id));
    this.nodeSel.classed('dimmed', d => !nbrs.has(d.id));
    this.labelSel.classed('dimmed', d => !nbrs.has(d.id));
    this.linkSel.classed('neighbor', d => (nbrs.has(d.source.id ?? d.source) && nbrs.has(d.target.id ?? d.target)))
                .classed('dimmed', d => !(nbrs.has(d.source.id ?? d.source) && nbrs.has(d.target.id ?? d.target)));
  }
  clearHighlight() {
    this.nodeSel.classed('dimmed', false).classed('neighbor', false);
    this.labelSel.classed('dimmed', false);
    this.linkSel.classed('dimmed', false).classed('neighbor', false);
  }

  // Legend + Filters
  buildLegendAndFilters() {
    const legend = d3.select('#legend'); legend.selectAll('*').remove();
    if (!this.filterAttr) return;
    const values = uniqueValues(this.nodes, n => n[this.filterAttr]).filter(v => v !== undefined);
    if (this.selectedFilterValues.size === 0) { values.forEach(v => this.selectedFilterValues.add(v)); }

    const items = legend.selectAll('div.legend-item').data(values, d => d);
    const itemsEnter = items.enter().append('div').attr('class', 'legend-item')
      .on('click', (_, v) => { this.toggleValue(v); });
    itemsEnter.append('span').attr('class','swatch').style('background', v => this.colorScale(v));
    itemsEnter.append('span').text(v => `${this.filterAttr}: ${safe(v)}`);
    const merged = itemsEnter.merge(items);
    merged.classed('selected', v => this.selectedFilterValues.has(v))
          .classed('unselected', v => !this.selectedFilterValues.has(v));
    items.exit().remove();

    document.getElementById('btnSelectAll').onclick = () => { this.selectedFilterValues = new Set(values); this.updateLegendSelection(); this.applyFilters(); };
    document.getElementById('btnUnselectAll').onclick = () => { this.selectedFilterValues = new Set(); this.updateLegendSelection(); this.applyFilters(); };
  }
  updateLegendSelection() {
    d3.select('#legend').selectAll('.legend-item')
      .classed('selected', v => this.selectedFilterValues.has(v))
      .classed('unselected', v => !this.selectedFilterValues.has(v));
  }
  toggleValue(v) { if (this.selectedFilterValues.has(v)) this.selectedFilterValues.delete(v); else this.selectedFilterValues.add(v); this.updateLegendSelection(); this.applyFilters(); }
  applyFilters() {
    const active = this.selectedFilterValues;
    const isVisible = (d) => !this.filterAttr || active.has(d[this.filterAttr]);
    this.nodeSel.classed('hidden', d => !isVisible(d));
    this.labelSel.classed('hidden', d => !isVisible(d));
    const visibleIds = new Set(this.nodes.filter(isVisible).map(n => n.id));
    this.linkSel.classed('hidden', d => !(visibleIds.has(d.source.id ?? d.source) && visibleIds.has(d.target.id ?? d.target)));
  }

  // recolor helpers
  recolor(attr) {
    this.colorAttr = attr;
    this.rebuildColorScale();
    this.recolorNodes();
    this.buildLegendAndFilters();
  }

  recolorNodes() {
    // Use nodeSel so circles inherit the parent <g> data
    this.nodeSel.select('circle')
      .attr('fill', d => this.colorScale(d[this.colorAttr]));
  }

  // === Fit to screen (zoom to fit) using node positions + radii ===
  fitToScreen(padding = 24) {
    if (!this.nodes.length) return;

    // 1) Work in world coords: clear viewBox & reset zoom
    this._resetZoomIdentity();

    // 2) Tight bounds from node positions + radii
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      const r = this.radiusProvider(n) || 0;
      const x0 = n.x - r, x1 = n.x + r;
      const y0 = n.y - r, y1 = n.y + r;
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
    }
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

    const dx = maxX - minX;
    const dy = maxY - minY;
    if (dx <= 0 || dy <= 0) return;

    // 3) Compute absolute transform to fit bounds into the actual SVG viewport
    const r = this.svg.node().getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const scale = Math.min((w - 2 * padding) / dx, (h - 2 * padding) / dy);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const t = d3.zoomIdentity
      .translate(w / 2, h / 2)
      .scale(scale)
      .translate(-cx, -cy);

    // 4) Apply the absolute transform
    this.svg.transition().duration(500).call(this.zoom.transform, t);
  }

  // public helpers
  getNodes() { return this.nodes; }
  getLinks() { return this.links; }

  setRadiusProvider(fn) {
    this.radiusProvider = fn || ((d)=>hooks.nodeRadius(d));
    this.redrawNodeSizes();
    this.sim.force('collide', d3.forceCollide().radius(d => this.radiusProvider(d) + 2));
    this.sim.alpha(0.2).restart();
  }

  redrawNodeSizes() {
    // Resize circles using the current provider
    this.nodeSel.select('circle')
      .attr('r', d => this.radiusProvider(d));
    // Labels sit just above the circle rim (closer)
    this.labelSel.attr('dy', d => -(this.radiusProvider(d) + 2));
  }

  // Filters and search helpers
  populateSearch() {
    const datalist = document.getElementById('suggestions');
    datalist.innerHTML = '';
    this.nodes.forEach(n => { const option = document.createElement('option'); option.value = n.name ?? n.id; datalist.appendChild(option); });
  }

  setFilterAttr(attr) {
    this.filterAttr = attr;
    this.selectedFilterValues = new Set();
    this.buildLegendAndFilters();
    this.applyFilters();
    d3.timeout(() => this.fitToScreen(24), 200);
  }

  resetForces() {
    // release pinned nodes and gently re-run the sim, no zooming here
    this.nodes.forEach(n => { n.fx = null; n.fy = null; });
    this.updateForcesForViewport();
    this.sim.alpha(0.5).restart();
    this.clearHighlight();
  }


  reset() {
    this.resetForces();
    // one fit after a short settle
    d3.timeout(() => this.fitToScreen(24), 700);
  }

}
