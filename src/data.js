function generateSampleNetwork() {
  const numNodes = 120;
  const density = 0.12;
  const numClusters = 5;
  const nodes = [];
  const links = [];

  const groups = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];
  const roles = ['Engineer', 'Analyst', 'Manager', 'Designer', 'Coordinator'];
  const regions = ['North', 'South', 'East', 'West', 'Central'];

  const clusterSizes = [30, 25, 25, 20, 20];
  let nodeIndex = 0;

  for (let c = 0; c < numClusters; c++) {
    for (let i = 0; i < clusterSizes[c]; i++) {
      nodes.push({
        id: `n${nodeIndex}`,
        name: `Node ${nodeIndex}`,
        group: groups[c],
        role: roles[Math.floor(Math.random() * roles.length)],
        region: regions[c]
      });
      nodeIndex++;
    }
  }

  let clusterStart = 0;
  for (let c = 0; c < numClusters; c++) {
    const clusterEnd = clusterStart + clusterSizes[c];
    const nodesInCluster = clusterSizes[c];
    const targetIntraLinks = Math.floor(nodesInCluster * (nodesInCluster - 1) * 0.15 / 2);

    const linkSet = new Set();
    let attempts = 0;
    while (linkSet.size < targetIntraLinks && attempts < targetIntraLinks * 3) {
      const i = clusterStart + Math.floor(Math.random() * nodesInCluster);
      const j = clusterStart + Math.floor(Math.random() * nodesInCluster);
      if (i !== j) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        linkSet.add(key);
      }
      attempts++;
    }

    linkSet.forEach(key => {
      const [a, b] = key.split('-').map(Number);
      links.push({ source: `n${a}`, target: `n${b}`, weight: 1 });
    });

    clusterStart = clusterEnd;
  }

  const interClusterLinks = Math.floor(numClusters * 3);
  for (let i = 0; i < interClusterLinks; i++) {
    const c1 = Math.floor(Math.random() * numClusters);
    let c2 = Math.floor(Math.random() * numClusters);
    while (c2 === c1) c2 = Math.floor(Math.random() * numClusters);

    const c1Start = clusterSizes.slice(0, c1).reduce((a, b) => a + b, 0);
    const c2Start = clusterSizes.slice(0, c2).reduce((a, b) => a + b, 0);

    const node1 = c1Start + Math.floor(Math.random() * clusterSizes[c1]);
    const node2 = c2Start + Math.floor(Math.random() * clusterSizes[c2]);

    links.push({ source: `n${node1}`, target: `n${node2}`, weight: 1 });
  }

  return { nodes, links };
}

export const sampleData = generateSampleNetwork();

export async function parseFile(file) {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    return JSON.parse(text);
  } else {
    return d3.csvParse(text);
  }
}

export function normalizeData(nodes, links) {
  const ns = nodes.map(n => ({ ...n, id: String(n.id), name: n.name ?? n.id }));
  const ls = links.map(l => ({ ...l, source: String(l.source), target: String(l.target), weight: +l.weight || 1 }));
  return { nodes: ns, links: ls };
}
