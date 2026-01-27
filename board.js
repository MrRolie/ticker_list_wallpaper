// board.js — updated to always fetch once + intelligently schedule next update

const rowMap = new Map();
let symbols = [];
let sortcolumn = 'none';
let sortdirection = 'desc';
let fontSize = 16;
let verticalAlign = 'top';

function applyFontSize(pxValue) {
  if (typeof pxValue !== 'number' || !Number.isFinite(pxValue) || pxValue <= 0) {
    return false;
  }
  const rounded = Math.round(pxValue);
  if (fontSize === rounded) {
    return false;
  }
  fontSize = rounded;
  if (document.body) {
    document.body.style.fontSize = `${rounded}px`;
  }
  return true;
}

function isMarketOpenLocal(now = new Date()) {
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = est.getDay();
  const h = est.getHours();
  const m = est.getMinutes();
  const t = h * 60 + m;
  return (day >= 1 && day <= 5) && t >= 570 && t <= 960; // 9:30 to 16:00
}

function getMsUntilNextMarketOpen(now = new Date()) {
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const openTime = new Date(est);
  openTime.setHours(9, 30, 0, 0);

  if (est.getDay() >= 6) {
    const daysToAdd = 8 - est.getDay(); // If Sat (6) -> +2, Sun (0) -> +1
    openTime.setDate(est.getDate() + daysToAdd);
  } else if (est.getHours() > 9 || (est.getHours() === 9 && est.getMinutes() >= 30)) {
    if (est.getDay() === 5) {
      openTime.setDate(est.getDate() + 3); // Friday after 9:30, next open is Monday
    } else {
      openTime.setDate(est.getDate() + 1);
    }
  }

  return openTime - est;
}

function updateSymbols(input) {
  const newSymbols = input.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (JSON.stringify(newSymbols) === JSON.stringify(symbols)) return;
  symbols = newSymbols;
  const tbody = document.querySelector('#board tbody');
  if (!tbody) {
    // DOM not ready yet; rows will be created on setupBoard
    return;
  }
  tbody.innerHTML = '';
  rowMap.clear();
  symbols.forEach(createRow);
  updateAll(true);
}

function createRow(symbol) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td>${symbol}</td>
    <td class="price">—</td>
    <td class="change">—</td>
    <td class="percent">—</td>
    <td class="pct5d">—</td>
    <td class="pct30d">—</td>
    <td class="volume">—</td>
  `;
  document.querySelector('#board tbody').appendChild(tr);
  rowMap.set(symbol, tr);
}

function flashUpdate(td, newValue, delta, suffix = '', showPlus = false) {
  let formatted = Number.isNaN(newValue) ? '—' : newValue.toFixed(2) + suffix;
  if (showPlus && !Number.isNaN(newValue) && newValue > 0) {
    formatted = '+' + formatted;
  }
  if (td.textContent !== formatted) {
    td.textContent = formatted;
    td.classList.add(delta >= 0 ? 'flash-green' : 'flash-red');
    setTimeout(() => td.classList.remove('flash-green', 'flash-red'), 800);
  }
}
function updateRibbonStats(data) {
  const ribbon = document.getElementById("stats-ribbon");
  const perfElem = document.getElementById("top-performers");
  if (!ribbon || ribbon.classList.contains("hidden") || !perfElem || !data?.length) return;

  const lastUpdate = data.reduce((max, d) => d.lastUpdate && (!max || d.lastUpdate > max) ? d.lastUpdate : max, null);
  const sorted1d = [...data].sort((a, b) => b.percent - a.percent);
  const sorted5d = [...data].sort((a, b) => b.change_5d - a.change_5d);
  const sorted30d = [...data].sort((a, b) => b.change_30d - a.change_30d);

  const up = data.filter(d => d.percent > 0).length;
  const down = data.length - up;
  const avgChange = (data.reduce((sum, d) => sum + d.percent, 0) / data.length).toFixed(2);
  const medianChange = sorted1d[Math.floor(data.length / 2)].percent.toFixed(2);
  const mean = data.reduce((sum, d) => sum + d.percent, 0) / data.length;
  const volatility = Math.sqrt(data.reduce((sum, d) => sum + Math.pow(d.percent - mean, 2), 0) / data.length).toFixed(2);

  // Skewness and kurtosis
  const n = data.length;
  const diffs = data.map(d => d.percent - mean);
  const m2 = diffs.reduce((sum, x) => sum + x ** 2, 0) / n;
  const m3 = diffs.reduce((sum, x) => sum + x ** 3, 0) / n;
  const m4 = diffs.reduce((sum, x) => sum + x ** 4, 0) / n;
  const skewness = m2 === 0 ? 0 : (m3 / Math.pow(m2, 1.5)).toFixed(2);
  const kurtosis = m2 === 0 ? 0 : (m4 / (m2 * m2) - 3).toFixed(2);

  perfElem.textContent = [
    `Last update: ${lastUpdate ? lastUpdate.toLocaleString() : '—'}`,
    `🏆 Top 1D: ${sorted1d[0].sym} ${sorted1d[0].percent.toFixed(2)}%`,
    `🏆 Top 5D: ${sorted5d[0].sym} ${sorted5d[0].change_5d.toFixed(2)}%`,
    `🏆 Top 30D: ${sorted30d[0].sym} ${sorted30d[0].change_30d.toFixed(2)}%`,
    `📉 Worst 1D: ${sorted1d.at(-1).sym} ${sorted1d.at(-1).percent.toFixed(2)}%`,
    `📈 # Gainers: ${up} 📉 # Losers: ${down}`,
    `📊 Avg: ${avgChange}% | 🧘 Med: ${medianChange}% | ⭐ Vol: ${volatility}% | 🔀 Skew: ${skewness} | 🏔️ Kurt: ${kurtosis}`
  ].join(' | ');
}



async function fetchPrice(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=30d&interval=1d`;
  try {
    const res = await fetch(url);
    const json = await res.json();
    const result = json.chart.result?.[0];
    const { close, volume } = result?.indicators?.quote?.[0] || {};
    const closes = (close || []).filter(x => typeof x === 'number');
    const vols = (volume || []).filter(x => typeof x === 'number');

    // Get last update timestamp (in seconds)
    const lastTimestamp = result?.timestamp?.at(-1) || null;
    // Convert to JS Date object (local time)
    const lastUpdate = lastTimestamp ? new Date(lastTimestamp * 1000) : null;

    if (closes.length < 2 || vols.length < 1) throw new Error('Insufficient data');

    const price = closes.at(-1);
    const prev = closes.at(-2);
    const change = price - prev;
    const percent = (change / prev) * 100;
    const change5d = ((price - (closes.at(-5) ?? closes[0])) / (closes.at(-5) ?? closes[0])) * 100;
    const change30d = ((price - (closes.at(-30) ?? closes[0])) / (closes.at(-30) ?? closes[0])) * 100;

    return { sym: symbol, price, change, percent, change_5d: change5d, change_30d: change30d, volume: vols.at(-1), lastUpdate};
  } catch (err) {
    console.error('Fetch failed for', symbol, err);
    return { sym: symbol, price: NaN, change: 0, percent: 0, change_5d: 0, change_30d: 0, volume: null };
  }
}

function updateRow(symbol, data) {
  const row = rowMap.get(symbol);
  if (!row) return;
  const [ , tdPrice, tdChange, tdPercent, td5d, td30d, tdVolume ] = row.children;
  flashUpdate(tdPrice, data.price, data.change);
  flashUpdate(tdChange, data.change, data.change, '', true);
  flashUpdate(tdPercent, data.percent, data.percent, '%', true);
  flashUpdate(td5d, data.change_5d, data.change_5d, '%', true);
  flashUpdate(td30d, data.change_30d, data.change_30d, '%', true);
  tdVolume.textContent = data.volume ? data.volume.toLocaleString() : '—';

  tdChange.classList.remove('up', 'down');
  tdChange.classList.add('change', data.change >= 0 ? 'up' : 'down');
  
  tdPercent.className = 'percent ' + (data.percent >= 0 ? 'up' : 'down');
  td5d.className = 'pct5d ' + (data.change_5d >= 0 ? 'up' : 'down');
  td30d.className = 'pct30d ' + (data.change_30d >= 0 ? 'up' : 'down');
}

async function updateAll(force = false) {
  if (!force && !isMarketOpenLocal()) return;
  const updates = await Promise.all(symbols.map(fetchPrice));

  if (sortcolumn !== 'none') {
    updates.sort((a, b) => sortdirection === 'asc' ? a[sortcolumn] - b[sortcolumn] : b[sortcolumn] - a[sortcolumn]);
  }

  updateRibbonStats(updates);

  const tbody = document.querySelector('#board tbody');
  tbody.innerHTML = '';
  for (const data of updates) {
    updateRow(data.sym, data);
    const tr = rowMap.get(data.sym);
    if (tr) tbody.appendChild(tr);
  }
}


function scheduleNextUpdate() {
  if (isMarketOpenLocal()) {
    updateAll();
    setTimeout(scheduleNextUpdate, 5000);
  } else {
    const ms = getMsUntilNextMarketOpen();
    console.log(`Market closed. Next fetch in ${Math.round(ms / 60000)} minutes.`);
    setTimeout(() => {
      updateAll(true);
      scheduleNextUpdate();
    }, ms);
  }
}

function setupBoard() {
  if (symbols.length === 0) {
    updateSymbols("AAPL,MSFT,GOOGL,AMZN,NVDA,BRK-B,UNH,JPM,V,MA,XOM,LLY,JNJ,WMT,PG,COST,HD,CVX,ABBV,META");
  }
  if (document.body) {
    document.body.style.fontSize = `${fontSize}px`;
    document.body.classList.remove('align-top','align-center','align-bottom');
    document.body.classList.add('align-top');
  }
  // If properties were applied before DOMContentLoaded, ensure rows exist
  if (rowMap.size === 0 && symbols.length > 0) {
    symbols.forEach(createRow);
  }
  updateAll(true);
  scheduleNextUpdate();
}

document.addEventListener("DOMContentLoaded", setupBoard);


// Wallpaper Engine property listener
window.wallpaperPropertyListener = {
  applyUserProperties: function(properties) {
    let refresh = false;

    if (properties.tickers?.value) {
      updateSymbols(properties.tickers.value);
    }

    if (properties.sortcolumn?.value && properties.sortcolumn.value !== sortcolumn) {
      sortcolumn = properties.sortcolumn.value;
      refresh = true;
    }

    if (properties.sortdirection?.value && properties.sortdirection.value !== sortdirection) {
      sortdirection = properties.sortdirection.value;
      refresh = true;
    }

    if (properties.showribbon) {
      const ribbon = document.getElementById("stats-ribbon");
      ribbon.classList.toggle("hidden", !properties.showribbon.value);
      refresh = true; 
    }

    if (properties.verticalalign?.value) {
      verticalAlign = properties.verticalalign.value;
      const cls = verticalAlign === 'bottom' ? 'align-bottom' : (verticalAlign === 'centered' ? 'align-center' : 'align-top');
      if (document.body) {
        document.body.classList.remove('align-top','align-center','align-bottom');
        document.body.classList.add(cls);
      }
    }

    if (properties.fontsize && typeof properties.fontsize.value === 'number') {
      if (applyFontSize(properties.fontsize.value)) {
        refresh = true;
      }
    }

    if (refresh) {
      updateAll(true);
    }
  }
};
