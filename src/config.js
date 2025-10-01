export const CONFIG = {
  defaultColorAttr: "group",
  defaultFilterAttr: "group",
  forces: { linkDistance: 60, charge: -220, collide: 16 },
  ui: { zoomMin: 0.2, zoomMax: 6, focusScale: 2.5 }
};

export const hooks = {
  labelText: (n) => n.name ?? n.id,
  nodeRadius: (n) => 8,
  edgeWidth: (e) => Math.sqrt(e.weight || 1),
  tooltipLine2: (n) => n.role ?? n.group ?? n.region ?? ""
};
