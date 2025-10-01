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
  values.forEach(v => { if(!m.has(v)) m.set(v, scheme[i++ % scheme.length]); });
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

    this.zoom = d3.zoom().scaleExtent([CONFIG.ui.zoomMin, CONFIG.ui.zoomMax]).on('zoom', (event) => {
      this.g.attr('transform', event.transform);
    });
    this.svg.call(this.zoom);

    this.sim = d3.forceSimulation()
      .force('link', d3.forceLink().id(d => d.id).distance(CONFIG.forces.linkDistance))
      .force('charge', d3.forceManyBody().strength(CONFIG.forces.charge))
      .force('center', d3.forceCenter(600, 400))
      .force('collide', d3.forceCollide().radius(d => CONFIG.forces.collide));

    this.linkSel = null;
    this.nodeSel = null;
    this.labelSel = null;
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
    this.populateSearch();
    this.buildLegendAndFilters();
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
      .attr('stroke-width', e => hooks.edgeWidth(e));
    this.linkSel = linkEnter.merge(this.linkSel);

    // Nodes
    this.nodeSel = this.nodeG.selectAll('g.node').data(this.nodes, d => d.id);
    this.nodeSel.exit().remove();
    const nodeEnter = this.nodeSel.enter().append('g')
      .attr('class', 'node')
      .call(d3.drag().on('start', (ev,d)=>this.dragstarted(ev,d)).on('drag', (ev,d)=>this.dragged(ev,d)).on('end', (ev,d)=>this.dragended(ev,d)))
      .on('click', (_, d) => this.selectNode(d))
      .on('mouseover', (_, d) => this.showTooltip(d))
      .on('mouseout', () => this.hideTooltip())
      .on('dblclick', (_, d) => { d.fx = null; d.fy = null; this.sim.alpha(0.7).restart(); });

    nodeEnter.append('circle')
      .attr('r', d => hooks.nodeRadius(d))
      .attr('fill', d => this.colorScale(d[this.colorAttr]));

    this.nodeSel = nodeEnter.merge(this.nodeSel);

    // Labels
    this.labelSel = this.labelG.selectAll('text').data(this.nodes, d => d.id);
    this.labelSel.exit().remove();
    const labelEnter = this.labelSel.enter().append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', -12)
      .text(d => hooks.labelText(d));
    this.labelSel = labelEnter.merge(this.labelSel);

    // Sim
    this.sim.nodes(this.nodes).on('tick', () => this.ticked());
    this.sim.force('link').links(this.links);
    this.sim.alpha(1).restart();

    this.applyFilters();
    this.recolorNodes(); // ensure colors match current colorAttr
  }

  ticked() {
    this.linkSel
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    this.nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
    this.labelSel.attr('x', d => d.x).attr('y', d => d.y - 12);
  }

  dragstarted(event, d) { if (!event.active) this.sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; }
  dragged(event, d) { d.fx = event.x; d.fy = event.y; }
  dragended(event, d) { if (!event.active) this.sim.alphaTarget(0); }

  showTooltip(d) {
    const rect = document.getElementById('canvas').getBoundingClientRect();
    d3.select('#tooltip')
      .html(`<b>${safe(d.name ?? d.id)}</b><br/><span class="hint">${safe(hooks.tooltipLine2(d))}</span>`)
      .style('left', (d.x + rect.left + 14) + 'px')
      .style('top', (d.y + rect.top - 10) + 'px')
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
    const target = this.nodes.find(n => (n.name ?? n.id).toLowerCase() === name.toLowerCase());
    if (!target) return false;
    this.selectNode(target);
    const k = CONFIG.ui.focusScale;
    const width = this.svg.node().clientWidth, height = this.svg.node().clientHeight;
    const tx = width / 2 - k * target.x; const ty = height / 2 - k * target.y;
    this.svg.transition().duration(650).call(this.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
    this.nodeSel.selectAll('circle').classed('highlight', n => n.id === target.id);
    return true;
  }

  // Public API used by UI
  recolor(attr) {
    this.colorAttr = attr;
    this.rebuildColorScale();
    this.recolorNodes();
    this.buildLegendAndFilters(); // legend uses colors
  }

  recolorNodes() {
    this.nodeG.selectAll('circle').attr('fill', d => this.colorScale(d[this.colorAttr]));
  }

  setFilterAttr(attr) {
    this.filterAttr = attr;
    this.selectedFilterValues = new Set(); // will be re-initialized to all in buildLegend
    this.buildLegendAndFilters();
    this.applyFilters();
  }

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
    merged.classed('selected', v => this.selectedFilterValues.has(v));
    items.exit().remove();
  }

  toggleValue(v) {
    if (this.selectedFilterValues.has(v)) this.selectedFilterValues.delete(v);
    else this.selectedFilterValues.add(v);
    this.updateLegendSelection();
    this.applyFilters();
  }

  updateLegendSelection() {
    d3.select('#legend').selectAll('.legend-item').classed('selected', v => this.selectedFilterValues.has(v));
  }

  applyFilters() {
    const active = this.selectedFilterValues;
    const isVisible = (d) => !this.filterAttr || active.has(d[this.filterAttr]);
    this.nodeSel.classed('hidden', d => !isVisible(d));
    this.labelSel.classed('hidden', d => !isVisible(d));
    const visibleIds = new Set(this.nodes.filter(isVisible).map(n => n.id));
    this.linkSel.classed('hidden', d => !(visibleIds.has(d.source.id ?? d.source) && visibleIds.has(d.target.id ?? d.target)));
  }

  populateSearch() {
    const datalist = document.getElementById('suggestions');
    datalist.innerHTML = '';
    this.nodes.forEach(n => {
      const option = document.createElement('option');
      option.value = n.name ?? n.id;
      datalist.appendChild(option);
    });
  }
}
