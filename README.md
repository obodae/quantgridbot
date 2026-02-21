# quantgridbot
tradingbot
RSI (14) — identifies overbought/oversold zones
MACD — detects momentum crossovers for trend direction
Bollinger Bands — spots price extremes and mean-reversion opportunities
Triple EMA (9/21/50) — determines trend structure and alignment
Market Regime Classifier — labels conditions as TRENDING_BULL, TRENDING_BEAR, VOLATILE_BULL, VOLATILE_BEAR, RANGING, or HIGH_VOLATILITY with a confidence score

Simultaneous Signal Generation:

Buy and sell signals are scored independently in parallel — the bot can trigger both sides simultaneously based on different timeframe signals
Orders fire when signal score ≥ 4 (multiple confirmations required)
Buys use 30% of available USD; Sells use 50% of held BTC — maintaining both positions at once

Live Features:

Simulated BTC/USDT price feed with realistic candle generation
Portfolio tracker with real-time P&L
Live trade log with timestamps and reasons
Speed controls from 0.2s to 2s per tick
