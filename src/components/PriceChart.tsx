// Mini Candlestick/Sparkline Chart — Canvas HTML5
import { useRef, useEffect, useCallback } from 'react';
import type { PriceCandle } from '../hooks/useDeepTrade';

interface Props {
  candles: PriceCandle[];
  livePrice: number;
  width?: number;
  height?: number;
}

export function PriceChart({ candles, livePrice, width = 360, height = 160 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Calculate price range
    const prices = candles.flatMap(c => [c.high, c.low]);
    const minPrice = Math.min(...prices) * 0.999;
    const maxPrice = Math.max(...prices) * 1.001;
    const priceRange = maxPrice - minPrice;

    const padding = { top: 16, bottom: 24, left: 8, right: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const candleW = Math.max(2, (chartW / candles.length) * 0.6);
    const gap = chartW / candles.length;

    const priceToY = (p: number) => padding.top + chartH - ((p - minPrice) / priceRange) * chartH;

    // Grid lines
    ctx.strokeStyle = 'rgba(0, 245, 255, 0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();

      // Price labels
      const price = maxPrice - (priceRange / 4) * i;
      ctx.fillStyle = 'rgba(112, 144, 176, 0.7)';
      ctx.font = '9px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(price.toFixed(2), width - padding.right + 4, y + 3);
    }

    // Candles
    candles.forEach((c, i) => {
      const x = padding.left + i * gap + gap / 2;
      const isUp = c.close >= c.open;
      const color = isUp ? '#00ff88' : '#ff4466';
      const shadowColor = isUp ? 'rgba(0,255,136,0.3)' : 'rgba(255,68,102,0.3)';

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(c.high));
      ctx.lineTo(x, priceToY(c.low));
      ctx.stroke();

      // Body
      const bodyTop = priceToY(Math.max(c.open, c.close));
      const bodyBottom = priceToY(Math.min(c.open, c.close));
      const bodyH = Math.max(1, bodyBottom - bodyTop);

      ctx.fillStyle = color;
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 4;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
      ctx.shadowBlur = 0;
    });

    // Live price line
    const liveY = priceToY(livePrice);
    ctx.strokeStyle = '#00f5ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, liveY);
    ctx.lineTo(width - padding.right, liveY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Live price badge
    ctx.fillStyle = '#00f5ff';
    ctx.shadowColor = 'rgba(0,245,255,0.5)';
    ctx.shadowBlur = 6;
    const badgeW = 44;
    const badgeH = 14;
    const badgeX = width - padding.right + 2;
    const badgeY = liveY - badgeH / 2;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#000';
    ctx.font = 'bold 8px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(livePrice.toFixed(2), badgeX + badgeW / 2, badgeY + 10);

    // Volume bars (subtle at bottom)
    const maxVol = Math.max(...candles.map(c => c.volume));
    candles.forEach((c, i) => {
      const x = padding.left + i * gap + gap / 2;
      const volH = (c.volume / maxVol) * 16;
      const isUp = c.close >= c.open;
      ctx.fillStyle = isUp ? 'rgba(0,255,136,0.12)' : 'rgba(255,68,102,0.12)';
      ctx.fillRect(x - candleW / 2, height - padding.bottom - volH, candleW, volH);
    });

  }, [candles, livePrice, width, height]);

  useEffect(() => { draw(); }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: height,
        borderRadius: 8,
        background: 'rgba(5, 8, 16, 0.6)',
        border: '1px solid rgba(0, 245, 255, 0.1)',
      }}
    />
  );
}
