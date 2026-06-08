/**
 * 折线趋势图组件（Canvas 2D，零依赖）
 *
 * 用法：
 * <trend-chart points="{{points}}" color="#1E88E5" unit="kg" />
 *
 * points 结构：[{ time: Date|isoString|number, value: number }]
 */
Component({
  properties: {
    points: { type: Array, value: [], observer: '_redraw' },
    color:  { type: String, value: '#1E88E5', observer: '_redraw' },
    unit:   { type: String, value: '' },
    // 第二条曲线（如血压的舒张压），可选
    points2: { type: Array, value: [], observer: '_redraw' },
    color2:  { type: String, value: '#FBC02D' }
  },

  data: {
    canvasId: 'tc-' + Math.random().toString(36).slice(2, 8),
    empty: true
  },

  lifetimes: {
    ready() {
      // 给 wxml 一帧时间渲染 canvas
      setTimeout(() => this._redraw(), 50);
    }
  },

  methods: {
    _redraw() {
      if (!this.data.canvasId) return;
      const pts  = this.properties.points  || [];
      const pts2 = this.properties.points2 || [];
      this.setData({ empty: !pts.length });
      if (!pts.length) return;

      const q = this.createSelectorQuery().in(this);
      q.select('#' + this.data.canvasId)
        .fields({ node: true, size: true })
        .exec(res => {
          if (!res || !res[0] || !res[0].node) return;
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = wx.getSystemInfoSync().pixelRatio;
          const cssW = res[0].width;
          const cssH = res[0].height;
          canvas.width  = cssW * dpr;
          canvas.height = cssH * dpr;
          ctx.scale(dpr, dpr);
          this._draw(ctx, cssW, cssH, pts, pts2);
        });
    },

    _draw(ctx, W, H, pts, pts2) {
      // padding
      const PL = 36, PR = 14, PT = 16, PB = 26;
      const cw = W - PL - PR;
      const ch = H - PT - PB;

      // 时间归一
      const toMs = t => typeof t === 'number' ? t : new Date(t).getTime();
      const allPts = [...pts, ...pts2];
      const tMin = Math.min(...allPts.map(p => toMs(p.time)));
      const tMax = Math.max(...allPts.map(p => toMs(p.time)));
      const tSpan = tMax - tMin || 1;
      const allVals = allPts.map(p => p.value).filter(v => typeof v === 'number');
      let vMin = Math.min(...allVals);
      let vMax = Math.max(...allVals);
      if (vMin === vMax) { vMin -= 1; vMax += 1; }
      const vPad = (vMax - vMin) * 0.15;
      vMin -= vPad; vMax += vPad;
      const vSpan = vMax - vMin;

      const x = ms  => PL + (ms - tMin) / tSpan * cw;
      const y = val => PT + (1 - (val - vMin) / vSpan) * ch;

      // 背景 + 网格
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#FAFBFC';
      ctx.fillRect(PL, PT, cw, ch);

      ctx.strokeStyle = '#E5E7EB';
      ctx.lineWidth = 1;
      ctx.font = '10px sans-serif';
      ctx.fillStyle = '#9CA3AF';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';

      // 4 条水平网格 + Y 轴标签
      for (let i = 0; i <= 4; i++) {
        const gy = PT + ch * i / 4;
        ctx.beginPath();
        ctx.moveTo(PL, gy);
        ctx.lineTo(PL + cw, gy);
        ctx.stroke();
        const v = vMax - vSpan * i / 4;
        ctx.fillText(v.toFixed(v >= 10 ? 0 : 1), PL - 4, gy);
      }

      // X 轴标签（首/中/末）
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const fmt = ms => {
        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
      ctx.fillText(fmt(tMin), PL, PT + ch + 6);
      ctx.fillText(fmt(tMin + tSpan / 2), PL + cw / 2, PT + ch + 6);
      ctx.fillText(fmt(tMax), PL + cw, PT + ch + 6);

      // 主折线 + 区域
      const baselineY = PT + ch;
      this._drawSeries(ctx, pts,  x, y, this.properties.color,  true,  baselineY);
      if (pts2.length) {
        this._drawSeries(ctx, pts2, x, y, this.properties.color2, false, baselineY);
      }
    },

    _drawSeries(ctx, pts, x, y, color, withArea, baselineY) {
      const toMs = t => typeof t === 'number' ? t : new Date(t).getTime();
      const sorted = [...pts].sort((a, b) => toMs(a.time) - toMs(b.time));
      if (!sorted.length) return;

      // 区域填充
      if (withArea && sorted.length > 1) {
        ctx.beginPath();
        ctx.moveTo(x(toMs(sorted[0].time)), baselineY);
        sorted.forEach(p => ctx.lineTo(x(toMs(p.time)), y(p.value)));
        ctx.lineTo(x(toMs(sorted[sorted.length - 1].time)), baselineY);
        ctx.closePath();
        ctx.fillStyle = this._hexAlpha(color, 0.12);
        ctx.fill();
      }

      // 折线
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      sorted.forEach((p, i) => {
        const px = x(toMs(p.time));
        const py = y(p.value);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // 数据点
      ctx.fillStyle = color;
      sorted.forEach(p => {
        const px = x(toMs(p.time));
        const py = y(p.value);
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      });
    },

    _hexAlpha(hex, alpha) {
      const m = hex.replace('#', '');
      const r = parseInt(m.slice(0, 2), 16);
      const g = parseInt(m.slice(2, 4), 16);
      const b = parseInt(m.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
});
