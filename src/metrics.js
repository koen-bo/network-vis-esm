// metrics.js - wrapper to run metrics in a Web Worker
export class MetricsRunner {
  constructor() {
    this.worker = new Worker("./src/metrics.worker.js", { type: "module" });
  }
  compute({ nodes, links, useWeights, louvainResolution }) {
    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        const msg = ev.data || ev;
        if (msg && msg.type === "metrics_done") {
          this.worker.removeEventListener("message", onMessage);
          resolve(msg.payload);
        }
      };
      const onError = (err) => {
        this.worker.removeEventListener("message", onMessage);
        reject(err);
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.postMessage({ type: "compute_metrics", payload: { nodes, links, useWeights, louvainResolution } });
    });
  }
}
