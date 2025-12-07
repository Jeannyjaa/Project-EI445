// --- CONFIGURATION: Google Sheet เดียว ---
//  test:  1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk
//  คอลัมน์ที่ workflow เขียนลง: 
//  timestamp, room_number, kWh_reading, kWh_usage, cost_baht,
//  power_kw, power_watts, level, amount_paid

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

  if (!hasDashboard && !hasUsageChart && !hasWarningChart && !hasPieChart) return;

  try {
    const data = await fetchDataFromSheets();

    if (hasDashboard) {
      renderDashboard(data);
      renderWarningStatus(data.level);   // ← NEW
    }

    if (hasUsageChart)   renderUsagePage(data);
    if (hasWarningChart) {
      renderWarningPage(data);
      renderWarningStatus(data.level);   // ← NEW
    }

    if (hasPieChart)     renderBreakdownPage(data);
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
    new Date().getTime();

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
// Dashboard
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
}


// -------------------------------------------------
// USAGE PAGE
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
  if (!ctx) return;

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


// -------------------------------------------------
// WARNING PAGE (กราฟคาดการณ์)
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
  if (!canvas) return;
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
          borderWidth: 2,
          tension: 0.4,
          fill: true,
        },
        {
          label: `งบประมาณ (${BUDGET_LIMIT} บ.)`,
          data: budgetData,
          borderColor: "#333",
          borderDash: [5, 5],
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true } },
    },
  });
}


// -------------------------------------------------
// BREAKDOWN PAGE
// -------------------------------------------------
function renderBreakdownPage(data) {
  const usageLog = data.usage;
  if (!usageLog.length) return;

  let day = 0;
  let night = 0;

  usageLog.forEach((log) => {
    const hour = toDate(log.timestamp).getHours();
    const kwh = Number(log.kwh_usage) || 0;
    if (hour >= 9 && hour < 22) day += kwh;
    else night += kwh;
  });

  const ctx = document.getElementById("pieChart");
  if (!ctx) return;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["กลางวัน", "กลางคืน"],
      datasets: [{
        data: [day, night],
        backgroundColor: ["#E0E0E0", "#333"],
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
// WARNING STATUS BOX (อิงจาก level ในชีท)
// -------------------------------------------------
function renderWarningStatus(level) {
  const box = document.getElementById("warning-status-box");
  const text = document.getElementById("warning-level-text");

  if (!box || !text) return;

  box.classList.remove("hidden", "warn-red", "warn-yellow", "warn-green");

  let msg = "";

  switch ((level || "").toLowerCase()) {
    case "critical":
      msg = "ระดับวิกฤต: ค่าไฟสูงผิดปกติ ต้องลดการใช้ทันที";
      box.classList.add("warn-red");
      break;

    case "high":
      msg = "ระดับสูง: ค่าไฟเพิ่มขึ้นอย่างรวดเร็ว";
      box.classList.add("warn-red");
      break;

    case "warning":
      msg = "ระดับเตือน: ค่าไฟเริ่มเกินเกณฑ์ปกติ";
      box.classList.add("warn-yellow");
      break;

    case "normal":
      msg = "ปกติ: การใช้ไฟอยู่ในเกณฑ์เหมาะสม";
      box.classList.add("warn-green");
      break;

    default:
      msg = "ยังไม่มีข้อมูลระดับเตือน";
      box.classList.add("warn-green");
      break;
  }

  text.innerText = msg;
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
// Interaction
// -------------------------------------------------
function showPlanList() {
  document.getElementById("step-start").style.display = "none";

  const selection = document.getElementById("step-selection");
  selection.classList.remove("hidden");
  selection.classList.add("fade-in");
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

  title.innerText = plans[planType].title;
  desc.innerText = plans[planType].desc;
  amount.innerText = plans[planType].amount;

  result.classList.remove("hidden");
  result.classList.add("fade-in");

  if (window.innerWidth < 768) {
    result.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}
