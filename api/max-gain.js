function addDaysUTC(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function parseDateUTC(value) {
  const parts = String(value || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function dateKeyUTC(date) {
  return date.getUTCFullYear() + '-' +
    String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(date.getUTCDate()).padStart(2, '0');
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

async function fetchYahoo(ticker, startDate, endDate) {
  const start = parseDateUTC(startDate);
  const end = parseDateUTC(endDate);
  const p1 = Math.floor(addDaysUTC(start, -5).getTime() / 1000);
  const p2 = Math.floor(addDaysUTC(end, 2).getTime() / 1000);
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(ticker) + '?period1=' + p1 + '&period2=' + p2 +
    '&interval=1d&events=history';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Yahoo HTTP ' + response.status);
  const json = await response.json();
  const result = json.chart && json.chart.result && json.chart.result[0];
  const quote = result && result.indicators && result.indicators.quote && result.indicators.quote[0];
  const timestamps = result && result.timestamp || [];
  if (!quote || !timestamps.length) throw new Error('Yahoo returned no candles');
  return timestamps.map((time, index) => ({
    date: dateKeyUTC(new Date(time * 1000)),
    open: quote.open && quote.open[index],
    high: quote.high && quote.high[index],
    low: quote.low && quote.low[index],
    close: quote.close && quote.close[index],
    volume: quote.volume && quote.volume[index]
  })).filter(candle =>
    candle.date &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.close)
  );
}

async function fetchStooq(ticker, startDate, endDate) {
  const start = parseDateUTC(startDate);
  const end = parseDateUTC(endDate);
  const symbol = String(ticker || '').toLowerCase() + '.us';
  const d1 = dateKeyUTC(addDaysUTC(start, -5)).replace(/-/g, '');
  const d2 = dateKeyUTC(addDaysUTC(end, 2)).replace(/-/g, '');
  const url = 'https://stooq.com/q/d/l/?s=' + encodeURIComponent(symbol) +
    '&d1=' + d1 + '&d2=' + d2 + '&i=d';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Stooq HTTP ' + response.status);
  const text = await response.text();
  const rows = text.trim().split(/\r?\n/).slice(1).map(line => {
    const cols = line.split(',');
    return {
      date: cols[0],
      open: Number(cols[1]),
      high: Number(cols[2]),
      low: Number(cols[3]),
      close: Number(cols[4]),
      volume: Number(cols[5])
    };
  }).filter(candle =>
    candle.date &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.close)
  );
  if (!rows.length) throw new Error('Stooq returned no candles');
  return rows;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.statusCode = 204;
    res.end();
    return;
  }

  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  const start = String(req.query.start || '').trim();
  const end = String(req.query.end || '').trim();
  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker) || !parseDateUTC(start) || !parseDateUTC(end)) {
    send(res, 400, { error: 'Invalid ticker, start, or end' });
    return;
  }

  try {
    const candles = await fetchYahoo(ticker, start, end);
    send(res, 200, { ticker, source: 'yahoo', candles });
  } catch (yahooError) {
    try {
      const candles = await fetchStooq(ticker, start, end);
      send(res, 200, { ticker, source: 'stooq', candles });
    } catch (stooqError) {
      send(res, 502, {
        error: 'No candle data available',
        yahoo: yahooError.message,
        stooq: stooqError.message
      });
    }
  }
};
