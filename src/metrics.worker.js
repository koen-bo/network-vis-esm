// metrics.worker.js - computes directed weighted degrees, undirected eigenvector, and weighted Louvain
const safeWeight = (w, useWeights) => (useWeights && Number.isFinite(+w)) ? +w : 1;

self.onmessage = (ev) => {
  const msg = ev.data || ev;
  if (!msg || msg.type !== "compute_metrics") return;
  const { nodes, links, useWeights, louvainResolution } = msg.payload;
  const result = computeMetrics(nodes, links, useWeights, louvainResolution);
  self.postMessage({ type: "metrics_done", payload: result });
};

function computeMetrics(nodes, links, useWeights, gamma=1.0) {
  let N = nodes.length;
  const idToIdx = new Map(nodes.map((n,i)=>[String(n.id), i]));
  const idxToId = nodes.map(n => String(n.id));

  // Directed degree (unweighted and weighted)
  const deg_in = new Array(N).fill(0), deg_out = new Array(N).fill(0), deg_total = new Array(N).fill(0);
  const deg_in_w = new Array(N).fill(0), deg_out_w = new Array(N).fill(0), deg_total_w = new Array(N).fill(0);

  // Undirected folded weights
  const pairKey = (a,b) => a < b ? a+"|"+b : b+"|"+a;
  const undirected = new Map();

  for (let i=0;i<links.length;i++) {
    const L = links[i];
    const u = idToIdx.get(String(L.source));
    const v = idToIdx.get(String(L.target));
    if (u == null || v == null) continue;
    const w = safeWeight(L.weight, useWeights);

    deg_out[u] += 1; deg_in[v] += 1;
    deg_total[u] += 1; deg_total[v] += 1;

    deg_out_w[u] += w; deg_in_w[v] += w;
    deg_total_w[u] += w; deg_total_w[v] += w;

    const key = pairKey(u,v);
    undirected.set(key, (undirected.get(key) || 0) + w);
  }

  // Build adjacency for undirected weighted graph
  let neighbors = Array.from({length:N}, ()=>[]);
  let totalWeight = 0;
  let undirectedEdges = [];
  for (const [key, w] of undirected.entries()) {
    const [aS,bS] = key.split("|"); const a=+aS, b=+bS;
    neighbors[a].push([b, w]); neighbors[b].push([a, w]);
    undirectedEdges.push([a,b,w]);
    totalWeight += w;
  }
  if (totalWeight <= 0) totalWeight = 1;

  // Eigenvector centrality via power iteration
  const eigen_raw = powerIteration(neighbors, N);
  const [minC, maxC] = minMax(eigen_raw);
  const eigen_norm = eigen_raw.map(c => (maxC===minC) ? 0 : (c - minC)/(maxC - minC));

  // Louvain communities (simplified, weighted, with resolution gamma)
  const louvainOut = louvain(neighbors, undirectedEdges, N, totalWeight, gamma);
  const community = louvainOut.community;
  const modularityQ = louvainOut.Q;

  // Edge flags (use original directed edges, but community from undirected partition)
  const edgeFlags = {};
  for (let i=0;i<links.length;i++) {
    const L = links[i];
    const u = idToIdx.get(String(L.source));
    const v = idToIdx.get(String(L.target));
    if (u==null || v==null) continue;
    const intra = community[u] === community[v];
    edgeFlags[i] = { intraCommunity: intra, bridgeEdge: !intra };
  }

  // Node metrics map
  const nodeMetrics = {};
  for (let u=0; u<N; u++) {
    const id = idxToId[u];
    nodeMetrics[id] = {
      degree_in: deg_in[u],
      degree_out: deg_out[u],
      degree_total: deg_total[u],
      degree_in_w: deg_in_w[u],
      degree_out_w: deg_out_w[u],
      degree_total_w: deg_total_w[u],
      eigenvector_raw: eigen_raw[u],
      eigenvector: eigen_norm[u],
    };
  }

  // Communities map id -> community id
  const communities = {};
  for (let u=0; u<N; u++) communities[idxToId[u]] = community[u];

  // Top-5 eigenvector
  const topEigenvector = idxToId.map((id,idx)=>({ id, score: eigen_norm[idx] }))
    .sort((a,b)=>b.score-a.score).slice(0,5);

  return { nodeMetrics, edgeFlags, communities, modularityQ, topEigenvector };
}

// ----- Helpers -----
function minMax(arr) {
  let mn = Infinity, mx = -Infinity;
  for (let v of arr) { if (v<mn) mn=v; if (v>mx) mx=v; }
  return [mn, mx];
}

function powerIteration(neighbors, N, maxIter=200, eps=1e-6) {
  let c = new Array(N).fill(1/N);
  for (let it=0; it<maxIter; it++) {
    const next = new Array(N).fill(0);
    for (let u=0; u<N; u++) {
      const adj = neighbors[u];
      for (let k=0; k<adj.length; k++) {
        const v = adj[k][0], w = adj[k][1];
        next[u] += w * c[v];
      }
    }
    let norm = 0; for (let i=0;i<N;i++) norm += next[i]*next[i]; norm = Math.sqrt(norm);
    if (!isFinite(norm) || norm === 0) break;
    for (let i=0;i<N;i++) next[i] /= norm;
    let delta = 0; for (let i=0;i<N;i++) delta += Math.abs(next[i]-c[i]);
    c = next;
    if (delta < eps) break;
  }
  return c;
}

// Very compact Louvain-like routine (heuristic, suitable for medium graphs)
function louvain(neighbors, edges, N, totalWeight, gamma=1.0) {
  let community = new Array(N); for (let i=0;i<N;i++) community[i]=i;
  let improved = true;
  const m2 = 2*totalWeight;

  function degree(u) {
    let s=0; const adj=neighbors[u]; for (let k=0;k<adj.length;k++) s+=adj[k][1]; return s;
  }

  while (improved) {
    improved = false;
    // Phase 1: local moves
    let moved = true;
    while (moved) {
      moved = false;
      for (let u=0; u<N; u++) {
        const cu = community[u];
        const k_u = degree(u);
        const neighW = new Map();
        const adj = neighbors[u];
        for (let k=0;k<adj.length;k++){ const v=adj[k][0], w=adj[k][1]; const cv=community[v]; neighW.set(cv, (neighW.get(cv)||0)+w); }
        let bestC = cu; let bestGain = 0;
        for (const [cN,w_uc] of neighW.entries()) {
          if (cN===cu) continue;
          // approximate gain (resolution-adjusted)
          // ΔQ ≈ (w(u→cN)/m) - gamma * (k_u * sum_k_cN)/(2m^2)
          let sum_k_cN = 0;
          for (let i=0;i<N;i++) if (community[i]===cN) sum_k_cN += degree(i);
          const gain = (w_uc / m2) - gamma * ( (k_u * sum_k_cN) / (m2*m2) );
          if (gain > bestGain) { bestGain=gain; bestC=cN; }
        }
        if (bestC !== cu) { community[u]=bestC; moved=true; improved=true; }
      }
    }
    // Phase 2: no aggregation in this compact variant; break loop
    break;
  }

  // Modularity Q (rough estimate)
  let Q = 0;
  for (let [a,b,w] of edges) {
    const same = (community[a]===community[b]) ? 1 : 0;
    const k_a = degree(a), k_b = degree(b);
    Q += (w/ m2 - gamma * (k_a*k_b) / (m2*m2)) * same;
  }
  return { community, Q };
}
