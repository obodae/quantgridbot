import { useState, useEffect, useRef, useCallback } from "react";

// ─── Market Simulation Engine ───────────────────────────────────────────────
function generateCandle(prev, volatility = 1) {
  const change = (Math.random() - 0.48) * volatility * prev * 0.012;
  const open = prev;
  const close = Math.max(0.01, prev + change);
  const high = Math.max(open, close) * (1 + Math.random() * 0.005);
  const low = Math.min(open, close) * (1 - Math.random() * 0.005);
  const volume = Math.floor(Math.random() * 5000 + 500);
  return { open, close, high, low, volume, time: Date.now() };
}

function calcEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  const changes = closes.slice(-period - 1).map((v, i, arr) => i === 0 ? 0 : v - arr[i - 1]).slice(1);
  const gains = changes.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const losses = Math.abs(changes.filter(c => c < 0).reduce((a, b) => a + b, 0)) / period;
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calcMACD(prices) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  if (!ema12 || !ema26) return { macd: 0, signal: 0, histogram: 0 };
  const macd = ema12 - ema26;
  return { macd, signal: macd * 0.9, histogram: macd * 0.1 };
}

function calcBollinger(prices, period = 20) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + 2 * std, middle, lower: middle - 2 * std };
}

function determineMarket(candles, rsi, macd, bb) {
  if (candles.length < 30) return { regime: "LOADING", confidence: 0, trend: "NEUTRAL" };
  const closes = candles.map(c => c.close);
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const current = closes[closes.length - 1];
  const recentVol = closes.slice(-10).map((v, i, a) => i === 0 ? 0 : Math.abs(v - a[i - 1]) / a[i - 1]).slice(1);
  const avgVol = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;

  let bullScore = 0, bearScore = 0;
  if (ema9 > ema21) bullScore += 2; else bearScore += 2;
  if (ema21 > ema50) bullScore += 2; else bearScore += 2;
  if (current > bb.middle) bullScore += 1; else bearScore += 1;
  if (rsi > 55) bullScore += 1; else if (rsi < 45) bearScore += 1;
  if (macd.histogram > 0) bullScore += 1; else bearScore += 1;

  const totalScore = bullScore + bearScore;
  const confidence = Math.round((Math.max(bullScore, bearScore) / totalScore) * 100);

  let regime = "RANGING";
  let trend = "NEUTRAL";
  if (bullScore > bearScore + 2) { regime = avgVol > 0.008 ? "VOLATILE_BULL" : "TRENDING_BULL"; trend = "BULLISH"; }
  else if (bearScore > bullScore + 2) { regime = avgVol > 0.008 ? "VOLATILE_BEAR" : "TRENDING_BEAR"; trend = "BEARISH"; }
  else if (avgVol > 0.01) regime = "HIGH_VOLATILITY";

  return { regime, confidence, trend, bullScore, bearScore, ema9, ema21, ema50 };
}

function generateSignals(candles, rsi, macd, bb, market) {
  if (candles.length < 30) return { buy: null, sell: null };
  const closes = candles.map(c => c.close);
  const current = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  const signals = { buy: [], sell: [] };

  // BUY signals
  if (rsi < 35) signals.buy.push({ reason: "RSI Oversold", strength: "STRONG", score: 3 });
  else if (rsi < 45) signals.buy.push({ reason: "RSI Low Zone", strength: "MODERATE", score: 1.5 });
  if (current < bb.lower * 1.002) signals.buy.push({ reason: "Bollinger Lower Touch", strength: "STRONG", score: 2.5 });
  if (macd.macd > macd.signal && prev < macd.signal) signals.buy.push({ reason: "MACD Crossover ↑", strength: "STRONG", score: 3 });
  if (market.trend === "BULLISH" && current > market.ema9) signals.buy.push({ reason: "EMA Trend Alignment", strength: "MODERATE", score: 2 });

  // SELL signals
  if (rsi > 65) signals.sell.push({ reason: "RSI Overbought", strength: "STRONG", score: 3 });
  else if (rsi > 55) signals.sell.push({ reason: "RSI High Zone", strength: "MODERATE", score: 1.5 });
  if (current > bb.upper * 0.998) signals.sell.push({ reason: "Bollinger Upper Touch", strength: "STRONG", score: 2.5 });
  if (macd.macd < macd.signal && prev > macd.signal) signals.sell.push({ reason: "MACD Crossover ↓", strength: "STRONG", score: 3 });
  if (market.trend === "BEARISH" && current < market.ema9) signals.sell.push({ reason: "EMA Downtrend Confirm", strength: "MODERATE", score: 2 });

  return signals;
}

// ─── Sparkline Component ─────────────────────────────────────────────────────
function Sparkline({ data, color, width = 200, height = 50 }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────
export default function TradingBot() {
  const [candles, setCandles] = useState(() => {
    const init = [];
    let price = 42000 + Math.random() * 5000;
    for (let i = 0; i < 80; i++) {
      const c = generateCandle(price, 1.2);
      init.push(c);
      price = c.close;
    }
    return init;
  });

  const [trades, setTrades] = useState([]);
  const [balance, setBalance] = useState({ usd: 10000, btc: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [stats, setStats] = useState({ totalPnl: 0, wins: 0, losses: 0, trades: 0 });
  const [selectedPair] = useState("BTC/USDT");
  const [log, setLog] = useState([]);
  const intervalRef = useRef(null);
  const candlesRef = useRef(candles);
  const balanceRef = useRef(balance);
  const tradesRef = useRef(trades);
  candlesRef.current = candles;
  balanceRef.current = balance;
  tradesRef.current = trades;

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1] || 42000;
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const market = determineMarket(candles, rsi, macd, bb);
  const signals = generateSignals(candles, rsi, macd, bb, market);

  const buyScore = signals.buy.reduce((a, s) => a + s.score, 0);
  const sellScore = signals.sell.reduce((a, s) => a + s.score, 0);

  const addLog = useCallback((msg, type) => {
    setLog(prev => [{ msg, type, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 19)]);
  }, []);

  const executeTrade = useCallback((type, price, reason) => {
    const bal = balanceRef.current;
    if (type === "BUY" && bal.usd > 100) {
      const amt = bal.usd * 0.3;
      const btc = amt / price;
      balanceRef.current = { usd: bal.usd - amt, btc: bal.btc + btc };
      setBalance({ ...balanceRef.current });
      const trade = { type, price, amount: btc, usd: amt, reason, time: Date.now(), id: Math.random() };
      tradesRef.current = [trade, ...tradesRef.current.slice(0, 49)];
      setTrades([...tradesRef.current]);
      addLog(`BUY ${btc.toFixed(5)} BTC @ $${price.toFixed(0)} — ${reason}`, "BUY");
    } else if (type === "SELL" && bal.btc > 0.0001) {
      const btc = bal.btc * 0.5;
      const usd = btc * price;
      balanceRef.current = { usd: bal.usd + usd, btc: bal.btc - btc };
      setBalance({ ...balanceRef.current });
      const trade = { type, price, amount: btc, usd, reason, time: Date.now(), id: Math.random() };
      tradesRef.current = [trade, ...tradesRef.current.slice(0, 49)];
      setTrades([...tradesRef.current]);
      addLog(`SELL ${btc.toFixed(5)} BTC @ $${price.toFixed(0)} — ${reason}`, "SELL");
    }
  }, [addLog]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        const prev = candlesRef.current;
        const lastPrice = prev[prev.length - 1]?.close || 42000;
        const newCandle = generateCandle(lastPrice);
        const updated = [...prev.slice(-149), newCandle];
        setCandles(updated);

        const cls = updated.map(c => c.close);
        const r = calcRSI(cls);
        const m = calcMACD(cls);
        const b = calcBollinger(cls);
        const mk = determineMarket(updated, r, m, b);
        const sig = generateSignals(updated, r, m, b, mk);
        const bs = sig.buy.reduce((a, s) => a + s.score, 0);
        const ss = sig.sell.reduce((a, s) => a + s.score, 0);
        const cp = cls[cls.length - 1];

        if (bs >= 4) executeTrade("BUY", cp, sig.buy[0]?.reason || "Signal");
        if (ss >= 4) executeTrade("SELL", cp, sig.sell[0]?.reason || "Signal");
      }, speed);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, speed, executeTrade]);

  const portfolioValue = balance.usd + balance.btc * currentPrice;
  const pnl = portfolioValue - 10000;
  const pnlPct = (pnl / 10000) * 100;
  const priceChange = closes.length > 1 ? ((closes[closes.length - 1] - closes[closes.length - 2]) / closes[closes.length - 2]) * 100 : 0;

  const regimeColors = {
    TRENDING_BULL: "#00ff88", VOLATILE_BULL: "#ffcc00",
    TRENDING_BEAR: "#ff4466", VOLATILE_BEAR: "#ff7700",
    RANGING: "#88aaff", HIGH_VOLATILITY: "#ff44ff", LOADING: "#666"
  };

  return (
    <div style={{
      background: "#060a0f",
      minHeight: "100vh",
      color: "#e0e8f0",
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      padding: "20px",
      fontSize: "12px"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0d1520; }
        ::-webkit-scrollbar-thumb { background: #1e3050; border-radius: 2px; }
        .panel {
          background: linear-gradient(135deg, #0d1520 0%, #0a1218 100%);
          border: 1px solid #1a2a3a;
          border-radius: 8px;
          padding: 14px;
        }
        .panel-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #4a6a8a;
          margin-bottom: 10px;
          padding-bottom: 8px;
          border-bottom: 1px solid #1a2a3a;
        }
        .stat-val { font-size: 22px; font-weight: 700; line-height: 1; }
        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1px;
        }
        .btn {
          padding: 10px 24px;
          border: none;
          border-radius: 6px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .btn:active { transform: scale(0.97); }
        .signal-row {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px;
          border-radius: 4px;
          margin-bottom: 4px;
          background: rgba(255,255,255,0.03);
        }
        .meter-bar {
          height: 6px;
          border-radius: 3px;
          background: #1a2a3a;
          overflow: hidden;
        }
        .meter-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease;
        }
        .log-entry { 
          padding: 4px 8px;
          border-radius: 3px;
          margin-bottom: 3px;
          font-size: 11px;
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .price-up { color: #00ff88; }
        .price-down { color: #ff4466; }
        .chart-bar { 
          display: inline-block;
          width: 3px;
          margin: 0 0.5px;
          border-radius: 1px;
          transition: height 0.2s;
        }
        .indicator-chip {
          background: #0d1f2d;
          border: 1px solid #1e3a50;
          border-radius: 6px;
          padding: 10px 14px;
          flex: 1;
        }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "linear-gradient(135deg, #00ff88, #0088ff)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: 1 }}>QUANT GRID BOT</div>
            <div style={{ fontSize: 10, color: "#4a6a8a", letterSpacing: 2 }}>SIMULTANEOUS BUY/SELL ENGINE v2.4</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ textAlign: "right", marginRight: 10 }}>
            <div style={{ fontSize: 10, color: "#4a6a8a" }}>PAIR</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#ffcc00" }}>{selectedPair}</div>
          </div>
          <select value={speed} onChange={e => setSpeed(+e.target.value)} style={{
            background: "#0d1520", border: "1px solid #1a2a3a", color: "#88aaff",
            padding: "8px 12px", borderRadius: 6, fontFamily: "inherit", fontSize: 11, cursor: "pointer"
          }}>
            <option value={2000}>SLOW (2s)</option>
            <option value={1000}>NORMAL (1s)</option>
            <option value={500}>FAST (0.5s)</option>
            <option value={200}>TURBO (0.2s)</option>
          </select>
          <button className="btn" onClick={() => setIsRunning(r => !r)} style={{
            background: isRunning ? "linear-gradient(135deg, #ff4466, #cc0033)" : "linear-gradient(135deg, #00ff88, #00aa55)",
            color: isRunning ? "#fff" : "#000"
          }}>
            {isRunning ? "⏹ STOP" : "▶ START"}
          </button>
        </div>
      </div>

      {/* Price Header */}
      <div className="panel" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 30 }}>
        <div>
          <div style={{ fontSize: 10, color: "#4a6a8a", marginBottom: 2 }}>CURRENT PRICE</div>
          <div style={{ fontSize: 32, fontWeight: 700, color: "#fff" }}>${currentPrice.toFixed(2)}</div>
        </div>
        <div className={priceChange >= 0 ? "price-up" : "price-down"} style={{ fontSize: 18, fontWeight: 600 }}>
          {priceChange >= 0 ? "▲" : "▼"} {Math.abs(priceChange).toFixed(3)}%
        </div>
        <div style={{ flex: 1 }}>
          <Sparkline data={closes.slice(-60)} color={priceChange >= 0 ? "#00ff88" : "#ff4466"} width={300} height={45} />
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          <div className="indicator-chip">
            <div style={{ fontSize: 9, color: "#4a6a8a", marginBottom: 3 }}>RSI(14)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: rsi > 65 ? "#ff4466" : rsi < 35 ? "#00ff88" : "#88aaff" }}>{rsi.toFixed(1)}</div>
          </div>
          <div className="indicator-chip">
            <div style={{ fontSize: 9, color: "#4a6a8a", marginBottom: 3 }}>MACD</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: macd.histogram > 0 ? "#00ff88" : "#ff4466" }}>{macd.histogram.toFixed(0)}</div>
          </div>
          <div className="indicator-chip">
            <div style={{ fontSize: 9, color: "#4a6a8a", marginBottom: 3 }}>BB %B</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#ffcc00" }}>
              {bb.upper > bb.lower ? (((currentPrice - bb.lower) / (bb.upper - bb.lower)) * 100).toFixed(0) : "--"}%
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>

        {/* Market Regime */}
        <div className="panel">
          <div className="panel-title">🔬 Market Regime Analysis</div>
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <div style={{
              display: "inline-block",
              padding: "8px 20px",
              borderRadius: 6,
              background: `${regimeColors[market.regime]}20`,
              border: `1px solid ${regimeColors[market.regime]}60`,
              color: regimeColors[market.regime],
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 10
            }}>
              {market.regime.replace("_", " ")}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 20, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 9, color: "#4a6a8a" }}>CONFIDENCE</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#fff" }}>{market.confidence}%</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#4a6a8a" }}>BIAS</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: market.trend === "BULLISH" ? "#00ff88" : market.trend === "BEARISH" ? "#ff4466" : "#88aaff" }}>
                  {market.trend}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", fontSize: 10 }}>
              <div style={{ color: "#4a6a8a" }}>EMA9: <span style={{ color: "#ffcc00" }}>${market.ema9?.toFixed(0) || "--"}</span></div>
              <div style={{ color: "#4a6a8a" }}>EMA21: <span style={{ color: "#88aaff" }}>${market.ema21?.toFixed(0) || "--"}</span></div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 10 }}>
                <span style={{ color: "#00ff88" }}>BULL {market.bullScore || 0}</span>
                <span style={{ color: "#ff4466" }}>BEAR {market.bearScore || 0}</span>
              </div>
              <div className="meter-bar">
                <div className="meter-fill" style={{
                  width: `${((market.bullScore || 0) / ((market.bullScore || 0) + (market.bearScore || 1))) * 100}%`,
                  background: "linear-gradient(90deg, #00ff88, #00aaff)"
                }} />
              </div>
            </div>
          </div>
        </div>

        {/* Buy Signals */}
        <div className="panel">
          <div className="panel-title" style={{ color: "#00aa55" }}>📈 BUY SIGNALS — Score: {buyScore.toFixed(1)}</div>
          {signals.buy.length === 0 ? (
            <div style={{ color: "#4a6a8a", textAlign: "center", padding: "20px 0" }}>No buy signals detected</div>
          ) : signals.buy.map((s, i) => (
            <div key={i} className="signal-row">
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: s.strength === "STRONG" ? "#00ff88" : "#ffcc00"
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e0e8f0" }}>{s.reason}</div>
                <div style={{ fontSize: 9, color: "#4a6a8a" }}>{s.strength}</div>
              </div>
              <span className="badge" style={{ background: "#00ff8820", color: "#00ff88", border: "1px solid #00ff8840" }}>
                +{s.score}
              </span>
            </div>
          ))}
          {buyScore >= 4 && (
            <div style={{
              marginTop: 10, padding: "8px", borderRadius: 6,
              background: "#00ff8815", border: "1px solid #00ff8840",
              color: "#00ff88", textAlign: "center", fontWeight: 700, fontSize: 13
            }}>
              ⚡ EXECUTING BUY ORDER
            </div>
          )}
        </div>

        {/* Sell Signals */}
        <div className="panel">
          <div className="panel-title" style={{ color: "#cc2244" }}>📉 SELL SIGNALS — Score: {sellScore.toFixed(1)}</div>
          {signals.sell.length === 0 ? (
            <div style={{ color: "#4a6a8a", textAlign: "center", padding: "20px 0" }}>No sell signals detected</div>
          ) : signals.sell.map((s, i) => (
            <div key={i} className="signal-row">
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: s.strength === "STRONG" ? "#ff4466" : "#ff7700"
              }} />
              <div style={{ flex: 1 }}>
                <div style={{ color: "#e0e8f0" }}>{s.reason}</div>
                <div style={{ fontSize: 9, color: "#4a6a8a" }}>{s.strength}</div>
              </div>
              <span className="badge" style={{ background: "#ff446620", color: "#ff4466", border: "1px solid #ff446640" }}>
                +{s.score}
              </span>
            </div>
          ))}
          {sellScore >= 4 && (
            <div style={{
              marginTop: 10, padding: "8px", borderRadius: 6,
              background: "#ff446615", border: "1px solid #ff446640",
              color: "#ff4466", textAlign: "center", fontWeight: 700, fontSize: 13
            }}>
              ⚡ EXECUTING SELL ORDER
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Portfolio */}
        <div className="panel">
          <div className="panel-title">💼 Portfolio</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: "#4a6a8a" }}>TOTAL VALUE</div>
              <div className="stat-val" style={{ color: "#fff" }}>${portfolioValue.toFixed(0)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#4a6a8a" }}>P&L</div>
              <div className="stat-val" style={{ color: pnl >= 0 ? "#00ff88" : "#ff4466" }}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(0)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#4a6a8a" }}>RETURN</div>
              <div className="stat-val" style={{ color: pnlPct >= 0 ? "#00ff88" : "#ff4466" }}>
                {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1, background: "#0a1218", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 9, color: "#4a6a8a", marginBottom: 4 }}>USD BALANCE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#ffcc00" }}>${balance.usd.toFixed(2)}</div>
            </div>
            <div style={{ flex: 1, background: "#0a1218", borderRadius: 6, padding: "10px 14px" }}>
              <div style={{ fontSize: 9, color: "#4a6a8a", marginBottom: 4 }}>BTC HELD</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#ff8844" }}>{balance.btc.toFixed(5)}</div>
              <div style={{ fontSize: 10, color: "#4a6a8a" }}>${(balance.btc * currentPrice).toFixed(2)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#4a6a8a", marginBottom: 4 }}>
              <span>USD</span>
              <span>BTC</span>
            </div>
            <div className="meter-bar" style={{ height: 10 }}>
              <div className="meter-fill" style={{
                width: `${(balance.usd / portfolioValue) * 100}%`,
                background: "linear-gradient(90deg, #ffcc00, #ff8844)"
              }} />
            </div>
          </div>
        </div>

        {/* Trade Log */}
        <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel-title">📋 Live Trade Log ({trades.length})</div>
          <div style={{ flex: 1, overflowY: "auto", maxHeight: 180 }}>
            {log.length === 0 ? (
              <div style={{ color: "#4a6a8a", textAlign: "center", padding: "20px 0" }}>
                {isRunning ? "Waiting for signals..." : "Start bot to begin trading"}
              </div>
            ) : log.map((entry, i) => (
              <div key={i} className="log-entry" style={{
                background: entry.type === "BUY" ? "#00ff8808" : "#ff446608",
                borderLeft: `2px solid ${entry.type === "BUY" ? "#00ff88" : "#ff4466"}`
              }}>
                <span style={{ color: "#4a6a8a", fontSize: 10, whiteSpace: "nowrap" }}>{entry.time}</span>
                <span className="badge" style={{
                  background: entry.type === "BUY" ? "#00ff8820" : "#ff446620",
                  color: entry.type === "BUY" ? "#00ff88" : "#ff4466",
                  fontSize: 9
                }}>{entry.type}</span>
                <span style={{ color: "#c0d0e0" }}>{entry.msg.split("—")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Candle volume mini chart */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">📊 Price Action — Last 80 Candles</div>
        <div style={{ display: "flex", alignItems: "flex-end", height: 60, gap: "1px", overflow: "hidden" }}>
          {candles.slice(-80).map((c, i) => {
            const allCloses = candles.slice(-80).map(x => x.close);
            const min = Math.min(...allCloses);
            const max = Math.max(...allCloses);
            const range = max - min || 1;
            const h = Math.max(2, ((c.close - min) / range) * 55);
            return (
              <div key={i} className="chart-bar" style={{
                height: h,
                background: c.close >= c.open ? "#00ff88" : "#ff4466",
                opacity: 0.7 + (i / 80) * 0.3,
                flex: 1
              }} />
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, color: "#4a6a8a" }}>
          <span>← 80 candles ago</span>
          <span>BB Upper: ${bb.upper.toFixed(0)} | Middle: ${bb.middle.toFixed(0)} | Lower: ${bb.lower.toFixed(0)}</span>
          <span>NOW →</span>
        </div>
      </div>

      <div style={{ textAlign: "center", marginTop: 14, fontSize: 9, color: "#2a3a4a" }}>
        SIMULATION ONLY — NOT FINANCIAL ADVICE — FOR EDUCATIONAL PURPOSES ONLY
      </div>
    </div>
  );
}
