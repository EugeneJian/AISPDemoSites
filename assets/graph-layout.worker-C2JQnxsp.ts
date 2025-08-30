import type { GraphLayoutInput, GraphLayoutOutput, WorkerRequest, WorkerResponse, ProtocolVersion } from '../types/algo';

// 最小占位：仅回传空结果，确保构建与消息通路打通（P0-1）
self.onmessage = (ev: MessageEvent<WorkerRequest<GraphLayoutInput>>) => {
  const t0 = performance.now();
  try {
    const req = ev.data;
    const version: ProtocolVersion = req.version || 'v1';
    const payload = req?.payload as GraphLayoutInput;
    const nodes = payload?.nodes || new Uint32Array(0);
    const edges = payload?.edges || new Uint32Array(0);
    const dims = payload?.dims || { width: 0, height: 0 };
    const sides = (payload as unknown as { sides?: Uint8Array })?.sides;
    const depths = (payload as unknown as { depths?: Uint8Array })?.depths;
    const n = (nodes?.length || 0) >>> 0;
    const m = Math.floor((edges?.length || 0) / 2) >>> 0;

    const positions = new Float32Array(n * 2);
    const links = new Float32Array(m * 4); // [sx,sy,tx,ty]*

    // 列/行参数（最小可用，与主线程等距策略对齐）
    const marginTop = 24, marginLeft = 180, marginRight = 180, marginBottom = 24;
    const innerW = Math.max(300, (dims?.width || 0) - marginLeft - marginRight);
    const innerH = Math.max(280, (dims?.height || 0) - marginTop - marginBottom);
    const minGap = 160;
    const columns = 3;

    // 估算列宽：优先使用静态列宽（简单均分），后续可引入 label 宽度测量回传
    const maxColWByWidth = Math.max(110, Math.floor(((innerW - minGap) / 2) / (columns - 1)));
    const colW = Math.max(110, Math.min(maxColWByWidth, 260));
    const treeW = colW * (columns - 1);
    const centerGap = Math.max(minGap, innerW - treeW * 2);

    // 简单等距纵向分布：每列独立计数
    const laneCountsLeft = new Uint32Array(columns);
    const laneCountsRight = new Uint32Array(columns);

    for (let i = 0; i < n; i++) {
      const side = sides ? sides[i] : (i % 2 === 0 ? 0 : 1); // 0=A(left) 1=B(right)；无输入时占位分布
      const depth = depths ? Math.min(2, depths[i]) : 2; // 默认 L2
      const depthAdj = Math.max(0, depth);
      const isLeft = side === 0;
      const xIndex = isLeft ? laneCountsLeft[depthAdj]++ : laneCountsRight[depthAdj]++;
      const y = isLeft
        ? marginLeft + depthAdj * colW
        : marginLeft + treeW + centerGap + (columns - 1 - depthAdj) * colW;
      const perLane = Math.max(1, Math.floor(innerH / Math.max(1, (isLeft ? laneCountsLeft[depthAdj] : laneCountsRight[depthAdj]))));
      const x = marginTop + xIndex * perLane + Math.min(20, perLane * 0.2);
      positions[i * 2] = x;
      positions[i * 2 + 1] = y;
    }

    for (let i = 0; i < m; i++) {
      const u = edges[i * 2] >>> 0;
      const v = edges[i * 2 + 1] >>> 0;
      const sx = positions[u * 2 + 1];
      const sy = positions[u * 2];
      const tx = positions[v * 2 + 1];
      const ty = positions[v * 2];
      const dx = Math.abs(tx - sx);
      const c = Math.max(60, dx * 0.45);
      // 返回直线端点，Renderer 侧再生成 cubic path（保持一致性）
      links[i * 4] = sy;        // sx
      links[i * 4 + 1] = sx;    // sy
      links[i * 4 + 2] = ty;    // tx
      links[i * 4 + 3] = tx;    // ty
      void c; // 预留将来在 Renderer 使用曲率
    }

    const res: WorkerResponse<GraphLayoutOutput> = {
      version,
      id: req.id,
      ok: true,
      result: { positions, links },
      perf: { ms: Math.max(0, performance.now() - t0) }
    };
    // 使用 Transferable 传输（P0-3）
    (self as unknown as Worker).postMessage(res, [positions.buffer, links.buffer]);
  } catch (e) {
    const req: WorkerRequest<GraphLayoutInput> = (ev && ev.data) || ({ id: 'unknown', kind: 'graph-layout', payload: { nodes: new Uint32Array(0), edges: new Uint32Array(0), dims: { width: 0, height: 0 } } } as unknown as WorkerRequest<GraphLayoutInput>);
    const err: WorkerResponse<GraphLayoutOutput> = {
      version: 'v1',
      id: req.id,
      ok: false,
      error: { code: 'E_EXECUTION_FAILED', message: (e instanceof Error ? e.message : 'unknown') }
    };
    (self as unknown as Worker).postMessage(err);
  }
};


