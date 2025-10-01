// Sample data + parsers
export const sampleData = {
  nodes: [
    { id: 'a', name: 'Alice', group: 'Team Red', role: 'Analyst', region: 'EU' },
    { id: 'b', name: 'Bob', group: 'Team Red', role: 'Engineer', region: 'EU' },
    { id: 'c', name: 'Carol', group: 'Team Blue', role: 'Engineer', region: 'US' },
    { id: 'd', name: 'David', group: 'Team Blue', role: 'Manager', region: 'US' },
    { id: 'e', name: 'Eve', group: 'Team Green', role: 'Analyst', region: 'APAC' },
    { id: 'f', name: 'Frank', group: 'Team Green', role: 'Engineer', region: 'APAC' }
  ],
  links: [
    { source: 'a', target: 'b', weight: 1 },
    { source: 'a', target: 'c', weight: 2 },
    { source: 'b', target: 'd', weight: 1 },
    { source: 'c', target: 'd', weight: 3 },
    { source: 'd', target: 'e', weight: 1 },
    { source: 'e', target: 'f', weight: 2 },
    { source: 'b', target: 'e', weight: 1 }
  ]
};

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
