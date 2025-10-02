from typing import Dict, Any, List
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

import networkx as nx

# Try NetworkX's built-in Louvain (NX >= 3.0). Fallback to python-louvain.
try:
    from networkx.algorithms.community import louvain_communities  # type: ignore
    HAVE_NX_LOUVAIN = True
except Exception:
    HAVE_NX_LOUVAIN = False
    import community as community_louvain  # type: ignore

app = FastAPI()

# Allow your local front-end to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000", "*"],  # narrow later if you want
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Link(BaseModel):
    source: str
    target: str
    weight: float | int | None = 1

class MetricsPayload(BaseModel):
    nodes: List[Dict[str, Any]]  # must at least include 'id'
    links: List[Link]
    useWeights: bool = True
    louvainResolution: float = 1.0

@app.post("/metrics")
def compute_metrics(payload: MetricsPayload):
    nodes = payload.nodes
    links = payload.links
    use_w = payload.useWeights
    gamma = payload.louvainResolution

    # --- 1) Directed graph for weighted in/out degree ---
    DG = nx.DiGraph()
    DG.add_nodes_from([str(n["id"]) for n in nodes])
    for e in links:
        w = float(e.weight) if (use_w and e.weight is not None) else 1.0
        DG.add_edge(str(e.source), str(e.target), weight=w)

    degree_in_w = dict(DG.in_degree(weight="weight"))
    degree_out_w = dict(DG.out_degree(weight="weight"))
    # total is sum of in/out (for directed); an undirected view could also be created for total
    degree_total_w = {n: degree_in_w.get(n, 0.0) + degree_out_w.get(n, 0.0) for n in DG.nodes()}

    # --- 2) Undirected weighted graph for eigenvector & community ---
    # Fold directions by summing weights both ways
    G = nx.Graph()
    G.add_nodes_from(DG.nodes())
    for u, v, d in DG.edges(data=True):
        w = float(d.get("weight", 1.0))
        if G.has_edge(u, v):
            G[u][v]["weight"] += w
        else:
            G.add_edge(u, v, weight=w)

    # --- 3) Eigenvector centrality (weighted, undirected) ---
    # Try power iteration with a higher cap; fall back to NumPy if it struggles.
    try:
        eigen_raw_dict = nx.eigenvector_centrality(
            G,
            max_iter=1000,     # was 200
            tol=1e-06,         # tighter tolerance than default
            weight="weight",
        )
    except nx.PowerIterationFailedConvergence:
        # Robust fallback that uses a dense eigen solve via NumPy
        eigen_raw_dict = nx.eigenvector_centrality_numpy(G, weight="weight")

    # normalize to [0,1] for display sizing
    if len(eigen_raw_dict) > 0:
        min_c = min(eigen_raw_dict.values())
        max_c = max(eigen_raw_dict.values())
        if max_c == min_c:
            eigen_norm_dict = {n: 0.0 for n in eigen_raw_dict}
        else:
            rng = max_c - min_c
            eigen_norm_dict = {n: (v - min_c) / rng for n, v in eigen_raw_dict.items()}
    else:
        eigen_norm_dict = {}


    # --- 4) Louvain communities (weighted, undirected) with resolution ---
    if HAVE_NX_LOUVAIN:
        comms = louvain_communities(G, weight="weight", resolution=gamma, seed=42)
        # Map node -> community id
        communities_map = {}
        for cid, com in enumerate(comms):
            for n in com:
                communities_map[n] = cid
        # Modularity
        Q = nx.algorithms.community.modularity(G, comms, weight="weight", resolution=gamma)
    else:
        # python-louvain returns dict node->community; accepts resolution as "resolution"
        partition = community_louvain.best_partition(G, weight="weight", resolution=gamma, random_state=42)
        communities_map = partition  # already node->community id
        # Build list of frozensets to compute modularity
        cid_to_nodes: Dict[int, set] = {}
        for n, c in partition.items():
            cid_to_nodes.setdefault(c, set()).add(n)
        comms = [frozenset(s) for s in cid_to_nodes.values()]
        Q = community_louvain.modularity(partition, G, weight='weight')

    # --- 5) Edge flags on original directed edges ---
    edgeFlags = {}
    for i, e in enumerate(links):
        u = str(e.source); v = str(e.target)
        cu = communities_map.get(u, -1); cv = communities_map.get(v, -1)
        intra = (cu == cv) and (cu != -1)
        edgeFlags[i] = {"intraCommunity": intra, "bridgeEdge": (not intra)}

    # --- 6) Pack node metrics to match your front-end shape ---
    nodeMetrics: Dict[str, Dict[str, float]] = {}
    for n in DG.nodes():
        nodeMetrics[n] = {
            "degree_in_w": float(degree_in_w.get(n, 0.0)),
            "degree_out_w": float(degree_out_w.get(n, 0.0)),
            "degree_total_w": float(degree_total_w.get(n, 0.0)),
            "eigenvector_raw": float(eigen_raw_dict.get(n, 0.0)),
            "eigenvector": float(eigen_norm_dict.get(n, 0.0)),
        }

    # Top-5 eigenvector
    topEigenvector = sorted(
        [{"id": n, "score": nodeMetrics[n]["eigenvector"]} for n in nodeMetrics],
        key=lambda x: x["score"],
        reverse=True
    )[:5]

    # communities: node id -> integer community id
    communities = {str(n): int(communities_map.get(n, -1)) for n in DG.nodes()}

    return {
        "nodeMetrics": nodeMetrics,
        "edgeFlags": edgeFlags,
        "communities": communities,
        "modularityQ": float(Q),
        "topEigenvector": topEigenvector,
    }
