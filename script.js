// --- CONFIGURATION: Google Sheet เดียว ---
//  test:  1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk
//  คอลัมน์: room_number, timestamp, kWh_reading, kWh_usage, cost_baht,
//           power_kw, power_watts, level, amount_paid

const SHEET = {
  id: "1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk",
  gid: "0",
};

// งบประมาณค่าไฟ
let BUDGET_LIMIT = 1500;

// เมื่อโหลดหน้าเสร็จ
document.addEventListener("DOMContentLoaded", async () => {
  if (window.Chart) {
    Chart.defaults.font.family = "'Prompt', sans-serif";
    Chart.defaults.color = "#888888";
  }

  const hasDashboard    = document.getElementById("display-amount");
  const hasUsageChart   = document.getElementById("usageChart");
  const hasWarningChart = document.getElementById("warningChart");
  const hasPieChart     = document.getElementById("pieChart");

  // ถ้าหน้านี้ไม่มีอะไรใช้ data เลยก็ไม่ต้องโหลด
  if (!hasDashboard && !hasUsageChart && !hasWarningChart && !hasPieChart) return;

  try {
    const data = await fetchDataFromSheets();

    if (hasDashboard)    renderDashboard(data);
    if (hasUsageChart)   renderUsagePage(data);
    if (hasWarningChart) renderWarningPage(data);
    if (hasPieChart)     renderBreakdownPage(data);

    // กล่องสถานะ (หน้า index + warning) อิง level ล่าสุดจากชีต
    renderWarningStatus(data.level);

  } catch (error) {
    console.error("Error loading data:", error);
    if (hasDashboard) {
      document.getElementById("display-amount").innerText = "Error";
    }
  }
});


// -------------------------------------------------
// ดึงข้อมูลจาก Google Sheets
// -------------------------------------------------
function normalizeLabel(label) {
  return (label || "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

async function fetchSheetTable(id, gid = "0") {
  const url =
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&gid=${gid}&t=` +
    new Date().getTime(); // กัน cache

  const res = await fetch(url);
  if (!res.ok) throw new Error("Fetch sheet error: " + res.status);

  const text = await res.text();
  const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const obj = JSON.parse(jsonStr);

  return obj.table;
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    if (value.startsWith("Date(")) {
      const nums = value.slice(5, -1).split(",").map((n) => parseInt(n) || 0);
      return new Date(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
    }
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function parseMainSheet(table) {
  const colsNorm = table.cols.map((c) => normalizeLabel(c.label || ""));

  const idxTimestamp = colsNorm.indexOf("timestamp");
  const idxRoom      = colsNorm.indexOf("room_number");
  const idxKwhUsage  = colsNorm.indexOf("kwh_usage");
  const idxCost      = colsNorm.indexOf("cost_baht");
  const idxPowerW    = colsNorm.indexOf("power_watts");
  const idxLevel     = colsNorm.indexOf("level");
  const idxPaid      = colsNorm.indexOf("amount_paid");

  const usage = [];
  let latestLevel = null;
  let latestPaid  = 0;

  table.rows.forEach((r) => {
    if (!r.c) return;
    const c = r.c;

    const ts   = idxTimestamp >= 0 && c[idxTimestamp] ? c[idxTimestamp].v : "";
    const room = idxRoom      >= 0 && c[idxRoom]      ? c[idxRoom].v      : "";
    const kwh  = idxKwhUsage  >= 0 && c[idxKwhUsage]  ? c[idxKwhUsage].v  : 0;
    const cost = idxCost      >= 0 && c[idxCost]      ? c[idxCost].v      : 0;
    const pw   = idxPowerW    >= 0 && c[idxPowerW]    ? c[idxPowerW].v    : 0;

    const level = idxLevel >= 0 && c[idxLevel] ? c[idxLevel].v : null;
    const paid  = idxPaid  >= 0 && c[idxPaid]  ? c[idxPaid].v  : 0;

    usage.push({
      timestamp:   ts,
      room_number: room,
      power_watts: Number(pw)   || 0,
      kwh_usage:   Number(kwh)  || 0,
      cost_baht:   Number(cost) || 0,
    });

    if (level !== null && level !== "") latestLevel = level;

    const paidNum = Number(paid);
    if (!isNaN(paidNum)) latestPaid = paidNum;
  });

  return {
    usage,
    level: latestLevel,
    amount_paid: latestPaid,
  };
}

async function fetchDataFromSheets() {
  const table = await fetchSheetTable(SHEET.id, SHEET.gid);
  const parsed = parseMainSheet(table);
  parsed.usage.sort((a, b) => toDate(a.timestamp) - toDate(b.timestamp));
  return parsed;
}


// -------------------------------------------------
// Dashboard (หน้า index)
// -------------------------------------------------
function renderDashboard(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  let total = usageLog.reduce((sum, log) => sum + (Number(log.cost_baht) || 0), 0);
  animateValue("display-amount", 0, total, 1000);

  const percent = (total / BUDGET_LIMIT) * 100;
  const fill = document.getElementById("progress-fill");
  const text = document.getElementById("progress-text");

  if (fill) {
    fill.style.width = `${Math.min(percent, 100)}%`;
    fill.style.backgroundColor = percent > 80 ? "#FF5252" : "#333";
  }

  if (text) {
    text.innerText = `${Math.floor(total)} ฿ จาก ${BUDGET_LIMIT} ฿`;
  }

  const lastLog = usageLog[usageLog.length - 1];
  const dateObj = toDate(lastLog.timestamp);
  const dateStr = dateObj.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const updateElem = document.getElementById("last-update");
  if (updateElem) updateElem.innerText = `อัปเดตล่าสุด: ${dateStr}`;
}


// -------------------------------------------------
// USAGE PAGE (usage.html)
// -------------------------------------------------
function renderUsagePage(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  const last10 = usageLog.slice(-10);
  const labels = last10.map((log) => {
    const d = toDate(log.timestamp);
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  });

  const values = last10.map((log) => Number(log.kwh_usage) || 0);

  const ctx = document.getElementById("usageChart");
  if (ctx && window.Chart) {
    new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "การใช้ไฟ (kWh)",
          data: values,
          borderColor: "#333",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: "#fff",
          pointBorderColor: "#333",
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { display: false, beginAtZero: true },
        },
      },
    });
  }

  // ✅ อัปเดต Insight ด้านขวา
  const targetLog =
    [...last10]
      .reverse()
      .find((log) => {
        const p = Number(log.power_watts);
        const c = Number(log.cost_baht);
        return (!isNaN(p) && p !== 0) || (!isNaN(c) && c !== 0);
      }) || last10[last10.length - 1];

  const powerVal = Number(targetLog.power_watts) || 0;
  const costVal  = Number(targetLog.cost_baht)   || 0;

  setText("insight-room",  targetLog.room_number || "-");
  setText("insight-power", powerVal.toFixed(0) + " W");
  setText("insight-cost",  costVal.toFixed(2)  + " ฿");
}


// -------------------------------------------------
// WARNING PAGE (warning.html) – กราฟเส้นล้วน ไม่มีจุด
// -------------------------------------------------
function renderWarningPage(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  let cumulative = 0;
  const costData = [];
  const budgetData = [];
  const labels = [];

  usageLog.forEach((log) => {
    cumulative += Number(log.cost_baht) || 0;
    costData.push(cumulative);
    budgetData.push(BUDGET_LIMIT);

    const d = toDate(log.timestamp);
    labels.push(`${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:00`);
  });

  const canvas = document.getElementById("warningChart");
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext("2d");

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "ค่าไฟสะสมจริง",
          data: costData,
          borderColor: "#FF5252",
          borderWidth: 3,
          tension: 0.35,
          fill: false,          // ไม่ลงสีพื้น
          pointRadius: 0,       // ❌ ไม่แสดงจุด
          pointHoverRadius: 0,
        },
        {
          label: `งบประมาณ (${BUDGET_LIMIT} บ.)`,
          data: budgetData,
          borderColor: "#333",
          borderDash: [6, 6],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: "#eeeeee" },
        },
      },
    },
  });
}


// -------------------------------------------------
// BREAKDOWN PAGE (breakdown.html)
// -------------------------------------------------
function renderBreakdownPage(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  let dayUsage = 0;
  let nightUsage = 0;

  usageLog.forEach((log) => {
    const hour = toDate(log.timestamp).getHours();
    const kwh  = Number(log.kwh_usage) || 0;
    if (hour >= 9 && hour < 22) dayUsage += kwh;
    else nightUsage += kwh;
  });

  const total = dayUsage + nightUsage;
  const dayPercent   = total > 0 ? ((dayUsage   / total) * 100).toFixed(0) : 0;
  const nightPercent = total > 0 ? ((nightUsage / total) * 100).toFixed(0) : 0;

  // ✅ อัปเดตข้อความ legend
  setText("legend-day",   `กลางวัน ${dayPercent}% (Off-Peak)`);
  setText("legend-night", `กลางคืน ${nightPercent}% (Peak)`);

  const ctx = document.getElementById("pieChart");
  if (!ctx || !window.Chart) return;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["กลางวัน", "กลางคืน"],
      datasets: [{
        data: [dayUsage, nightUsage],
        backgroundColor: ["#E0E0E0", "#333333"],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      cutout: "70%",
      plugins: { legend: { display: false } },
    },
  });
}


// -------------------------------------------------
// WARNING PAGE (warning.html) – กราฟเส้นล้วน ไม่มีจุด
// -------------------------------------------------
function renderWarningPage(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  let cumulative = 0;
  const costData = [];
  const budgetData = [];
  const labels = [];

  usageLog.forEach((log) => {
    cumulative += Number(log.cost_baht) || 0;
    costData.push(cumulative);
    budgetData.push(BUDGET_LIMIT);

    const d = toDate(log.timestamp);
    labels.push(`${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:00`);
  });

  const canvas = document.getElementById("warningChart");
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext("2d");

  new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "ค่าไฟสะสมจริง",
          data: costData,
          borderColor: "#FF5252",
          borderWidth: 3,
          tension: 0.35,
          fill: false,
          // 🔥 ไม่เอาจุด
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
        },
        {
          label: `งบประมาณ (${BUDGET_LIMIT} บ.)`,
          data: budgetData,
          borderColor: "#333",
          borderDash: [6, 6],
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 0,
          pointHitRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true } },
      // 🔥 เผื่อไว้กันจุดโผล่มาอีก กำหนด global ของ chart นี้เป็น 0 เลย
      elements: {
        point: {
          radius: 0,
          hoverRadius: 0,
          hitRadius: 0,
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: "#eeeeee" },
        },
      },
    },
  });
}

// -------------------------------------------------
// Helper
// -------------------------------------------------
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;

  const s = Number(start);
  const e = Number(end);
  let startTimestamp = null;

  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (e - s) + s).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}


// -------------------------------------------------
// Interaction (แผนลดค่าไฟ)
// -------------------------------------------------
function showPlanList() {
  const start = document.getElementById("step-start");
  const selection = document.getElementById("step-selection");
  if (start) start.style.display = "none";
  if (selection) {
    selection.classList.remove("hidden");
    selection.classList.add("fade-in");
  }
}

function showPlanDetail(planType) {
  const title  = document.getElementById("result-title");
  const desc   = document.getElementById("result-desc");
  const amount = document.getElementById("result-amount");
  const result = document.getElementById("step-result");

  const plans = {
    lite: {
      title: "แผน Lite (เริ่มต้น)",
      desc:  "เน้นการปิดไฟและถอดปลั๊กเมื่อไม่ใช้งาน",
      amount: "50 - 80 บาท",
    },
    balance: {
      title: "แผน Balance (แนะนำ)",
      desc:  "ปรับแอร์ 26°C และหลีกเลี่ยงการใช้ไฟช่วง Peak",
      amount: "150 - 200 บาท",
    },
    max: {
      title: "แผน Max (ประหยัดสูงสุด)",
      desc:  "งดใช้เครื่องใช้ไฟฟ้าหนักทั้งหมด",
      amount: "300+ บาท",
    },
  };

  const p = plans[planType];
  if (!p) return;

  if (title)  title.innerText  = p.title;
  if (desc)   desc.innerText   = p.desc;
  if (amount) amount.innerText = p.amount;

  if (result) {
    result.classList.remove("hidden");
    result.classList.add("fade-in");

    if (window.innerWidth < 768) {
      result.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }
}
