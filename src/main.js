import { Graph } from './graph.js';
import { sampleData } from './data.js';
import { mountUI } from './ui.js';

const svg = document.getElementById('svg');
const graph = new Graph(svg);
graph.setData(sampleData.nodes, sampleData.links);

const ui = mountUI(graph);
// After initial data load, sync dropdowns
ui.refreshAttrDropdowns();
