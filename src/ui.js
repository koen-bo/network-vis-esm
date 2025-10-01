// Wire DOM to graph methods
import { parseFile, normalizeData, sampleData } from './data.js';

export function mountUI(graph) {
  const menu = document.getElementById('menu');
  const menuBtn = document.getElementById('menuBtn');
  const closeMenu = document.getElementById('closeMenu');

  // Hamburger
  menuBtn.onclick = () => { menu.classList.toggle('open'); menu.setAttribute('aria-hidden', String(!menu.classList.contains('open'))); };
  closeMenu.onclick = () => { menu.classList.remove('open'); menu.setAttribute('aria-hidden', 'true'); };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target.id !== 'menuBtn') { menu.classList.remove('open'); menu.setAttribute('aria-hidden','true'); } });

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

  // Attr dropdowns
  const colorSel = document.getElementById('colorAttr');
  const filterSel = document.getElementById('filterAttr');
  function refreshAttrDropdowns() {
    const attrs = Array.from(new Set(graph.nodes.flatMap(n => Object.keys(n))))
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

  // Public method so main.js can refresh after setData
  return { refreshAttrDropdowns };
}
