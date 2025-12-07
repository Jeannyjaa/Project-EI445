// --- CONFIGURATION: Google Sheet เดียว ---
//  test:  1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk
//  คอลัมน์ที่ workflow เขียนลง: 
//  timestamp, room_number, kWh_reading, kWh_usage, cost_baht,
//  power_kw, power_watts, level, amount_paid

const SHEET = {
  id: "1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk",
  gid: "0",
};

// งบประมาณค่าไฟ (บาท) – fix ไว้ก่อน
let BUDGET_LIMIT = 1500;

// โหลดเมื่อ DOM พร้อม
document.addEventListener("DOMContentLoaded", async () => {
  // ตั้งฟอนต์และสีเริ่มต้นของ Chart.js
  if (window.Chart) {
    Chart.defaults.font.family = "'Prompt', sans-serif";
    Chart.defaults.color = "#888888";
  }

  const hasDashboard    = document.getElementById("display-amount");
  const hasUsageChart   = document.getElementById("usageChart");
  const hasWarningChart = document.getElementById("warningChart");
  const hasPieChart     = document.getElementById("pieChart");

  // ถ้าไม่มี element ที่ต้องใช้เลย ก็ไม่ต้องดึงข้อมูล
  if (!hasDashboard && !hasUsageChart && !hasWarningChart && !hasPieChart) return;

  try {
    const data = await fetchDataFromSheets(); // ดึงจาก Google Sheet เดียว

    if (hasDashboard)    renderDashboard(data);
    if (hasUsageChart)   renderUsagePage(data);
    if (hasWarningChart) renderWarningPage(data);
    if (hasPieChart)     renderBreakdownPage(data);
  } catch (error) {
    console.error("Error loading data:", error);
    if (hasDashboard) {
      document.getElementById("display-amount").innerText = "Error";
    }
  }
});


// -------------------------------------------------
// ดึงข้อมูลจาก Google Sheets (ผ่าน gviz JSON)
// -------------------------------------------------

// helper แปลงชื่อคอลัมน์ให้ normalize เช่น "Power Watts" → "powerwatts"
function normalizeLabel(label) {
  return (label || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

// ดึง table จาก Google Sheet 1 ชีต
async function fetchSheetTable(id, gid = "0") {
  const url =
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:json&gid=${gid}&t=` +
    new Date().getTime(); // กัน cache หน่อย

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Fetch sheet error: " + res.status);
  }

  const text = await res.text();

  // ตัด wrapper google.visualization.Query.setResponse(... )
  const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const obj = JSON.parse(jsonStr);

  return obj.table; // { cols, rows }
}

// helper แปลง timestamp string/Date(..) → Date object ให้ชัวร์
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    // case "Date(2024,11,7,10,0,0)"
    if (value.startsWith("Date(")) {
      const inside = value.slice(5, -1).split(",");
      const nums = inside.map((n) => parseInt(n, 10) || 0);
      return new Date(
        nums[0],
        nums[1],
        nums[2],
        nums[3] || 0,
        nums[4] || 0,
        nums[5] || 0
      );
    }
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(); // fallback ปัจจุบัน
}

// แปลงข้อมูลจากชีทหลัก (test) → usage + level + amount_paid
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

// ดึงข้อมูลจากชีทเดียว
async function fetchDataFromSheets() {
  const table = await fetchSheetTable(SHEET.id, SHEET.gid);
  const parsed = parseMainSheet(table);

  // เรียง usage ตามเวลา
  parsed.usage.sort((a, b) => toDate(a.timestamp) - toDate(b.timestamp));

  return parsed; // { usage, level, amount_paid }
}

/* -------------------------------------------------
 * 1. DASHBOARD
 * ------------------------------------------------- */
function renderDashboard(data) {
  const usageLog = data.usage;
  if (!usageLog || usageLog.length === 0) return;

  const sorted = [...usageLog].sort((a, b) => {
    return toDate(a.timestamp) - toDate(b.timestamp);
  });

  // คำนวณค่าไฟสะสมทั้งหมด
  let calculatedBill = 0;
  sorted.forEach((log) => {
    const v = Number(log.cost_baht) || 0;
    calculatedBill += v;
  });

  if (!isFinite(calculatedBill)) calculatedBill = 0;
  animateValue("display-amount", 0, calculatedBill, 1000);

  const percent = BUDGET_LIMIT > 0 ? (calculatedBill / BUDGET_LIMIT) * 100 : 0;
  const fillElem = document.getElementById("progress-fill");
  const textElem = document.getElementById("progress-text");

  if (fillElem) {
    fillElem.style.width = `${Math.min(percent, 100)}%`;
    fillElem.style.backgroundColor = percent > 80 ? "#FF5252" : "#333333";
  }

  if (textElem) {
    textElem.innerText = `${Math.floor(calculatedBill)} ฿ จาก ${BUDGET_LIMIT} ฿`;
  }

  const lastLog = sorted[sorted.length - 1];
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

/* -------------------------------------------------
 * 2. USAGE PAGE (10 แถวล่าสุด + Insight)
 * ------------------------------------------------- */
function renderUsagePage(data) {
  const usageLog = data.usage;
  if (!usageLog || usageLog.length === 0) return;

  const sorted = [...usageLog].sort((a, b) => {
    return toDate(a.timestamp) - toDate(b.timestamp);
  });

  const windowSize = 10;
  const start = Math.max(sorted.length - windowSize, 0);
  const lastLogs = sorted.slice(start);

  // ทำกราฟ
  const labels = lastLogs.map((log) => {
    const d = toDate(log.timestamp);
    const hh = d.getHours();
    const mm = d.getMinutes();
    return hh + ":" + (mm < 10 ? "0" + mm : mm);
  });

  const dataPoints = lastLogs.map((log) => Number(log.kwh_usage) || 0);

  const ctx = document.getElementById("usageChart");
  if (!ctx || !window.Chart) return;

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "การใช้ไฟ (kWh)",
          data: dataPoints,
          borderColor: "#333333",
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: "#ffffff",
          pointBorderColor: "#333333",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { display: false, beginAtZero: true },
      },
    },
  });

  // เลือก record ล่าสุดที่มี power หรือ cost เป็นเลขจริง
  const targetLog =
    [...lastLogs]
      .reverse()
      .find((log) => {
        const p = Number(log.power_watts);
        const c = Number(log.cost_baht);
        return (!isNaN(p) && p !== 0) || (!isNaN(c) && c !== 0);
      }) || lastLogs[lastLogs.length - 1];

  const powerVal = Number(targetLog.power_watts) || 0;
  const costVal  = Number(targetLog.cost_baht)   || 0;

  setText("insight-room",  targetLog.room_number || "-");
  setText("insight-power", powerVal.toFixed(0) + " W");
  setText("insight-cost",  costVal.toFixed(2)  + " ฿");
}

/* -------------------------------------------------
 * 3. WARNING PAGE
 * ------------------------------------------------- */
function renderWarningPage(data) {
  const usageLog = data.usage;
  if (!usageLog || usageLog.length === 0) return;

  const sorted = [...usageLog].sort((a, b) => {
    return toDate(a.timestamp) - toDate(b.timestamp);
  });

  let cumulativeCost = 0;
  const costData = [];
  const budgetData = [];
  const labels = [];

  sorted.forEach((log) => {
    const v = Number(log.cost_baht) || 0;
    cumulativeCost += v;
    costData.push(cumulativeCost);
    budgetData.push(BUDGET_LIMIT);

    const d = toDate(log.timestamp);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1} ${d.getHours()}:00`;
    labels.push(dateStr);
  });

  const canvas = document.getElementById("warningChart");
  if (!canvas || !window.Chart) return;

  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, "rgba(255, 82, 82, 0.6)");
  gradient.addColorStop(1, "rgba(255, 82, 82, 0.0)");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "ค่าไฟสะสมจริง",
          data: costData,
          borderColor: "#FF5252",
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          pointHoverRadius: 6,
          fill: true,
          order: 1,
        },
        {
          label: `งบประมาณ (${BUDGET_LIMIT} บ.)`,
          data: budgetData,
          borderColor: "#333333",
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          labels: { usePointStyle: true, boxWidth: 8 },
        },
        tooltip: {
          callbacks: {
            label: (context) =>
              context.dataset.label +
              ": " +
              Math.floor(context.raw) +
              " บาท",
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { display: false },
          ticks: { maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
          display: true,
          beginAtZero: true,
          grid: { color: "#f5f5f5" },
        },
      },
    },
  });

  // เผื่ออยากใช้ level / amount_paid ที่อื่นในหน้า Warning
  window.sheetSummary = {
    level: data.level,
    amount_paid: data.amount_paid,
  };
}

/* -------------------------------------------------
 * 4. BREAKDOWN PAGE (แบ่งกลางวัน/กลางคืน)
 * ------------------------------------------------- */
function renderBreakdownPage(data) {
  const usageLog = data.usage;
  if (!usageLog || usageLog.length === 0) return;

  let dayUsage = 0;
  let nightUsage = 0;

  usageLog.forEach((log) => {
    const hour = toDate(log.timestamp).getHours();
    const kwh  = Number(log.kwh_usage) || 0;

    if (hour >= 9 && hour < 22) {
      dayUsage += kwh;
    } else {
      nightUsage += kwh;
    }
  });

  const total = dayUsage + nightUsage;
  const dayPercent   = total > 0 ? ((dayUsage   / total) * 100).toFixed(0) : 0;
  const nightPercent = total > 0 ? ((nightUsage / total) * 100).toFixed(0) : 0;

  setText("legend-day",   `กลางวัน ${dayPercent}% (Off-Peak)`);
  setText("legend-night", `กลางคืน ${nightPercent}% (Peak)`);

  const ctx = document.getElementById("pieChart");
  if (!ctx || !window.Chart) return;

  new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["กลางวัน", "กลางคืน"],
      datasets: [
        {
          data: [dayUsage, nightUsage],
          backgroundColor: ["#E0E0E0", "#333333"],
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: { legend: { display: false } },
    },
  });
}

/* -------------------------------------------------
 * HELPER FUNCTIONS
 * ------------------------------------------------- */
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;

  const s = Number(start) || 0;
  const e = Number(end)   || 0;

  let startTimestamp = null;

  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    obj.innerHTML = Math.floor(progress * (e - s) + s).toLocaleString();
    if (progress < 1) window.requestAnimationFrame(step);
  };

  window.requestAnimationFrame(step);
}

/* -------------------------------------------------
 * INTERACTION (เลือกแผนลดค่าไฟ)
 * ------------------------------------------------- */
function showPlanList() {
  const startStep     = document.getElementById("step-start");
  const selectionStep = document.getElementById("step-selection");

  if (startStep) startStep.style.display = "none";
  if (selectionStep) {
    selectionStep.classList.remove("hidden");
    selectionStep.classList.add("fade-in");
  }
}

function showPlanDetail(planType) {
  const resultSection = document.getElementById("step-result");
  const title         = document.getElementById("result-title");
  const desc          = document.getElementById("result-desc");
  const amount        = document.getElementById("result-amount");

  const plans = {
    lite: {
      title: "แผน Lite (เริ่มต้น)",
      desc:  "เน้นการปิดไฟและถอดปลั๊กเมื่อไม่ใช้งาน ไม่กระทบชีวิตประจำวันมากนัก",
      amount:"50 - 80 บาท",
    },
    balance: {
      title: "แผน Balance (แนะนำ)",
      desc:  "ปรับอุณหภูมิแอร์เป็น 26°C และหลีกเลี่ยงการใช้ไฟช่วง Peak (13:00-15:00)",
      amount:"150 - 200 บาท",
    },
    max: {
      title: "แผน Max (ประหยัดสูงสุด)",
      desc:  "งดใช้เครื่องทำน้ำอุ่น เครื่องอบผ้า และเปิดแอร์เฉพาะห้องนอนตอนกลางคืนเท่านั้น",
      amount:"300+ บาท",
    },
  };

  const plan = plans[planType];
  if (!plan) return;

  if (title)  title.innerText  = plan.title;
  if (desc)   desc.innerText   = plan.desc;
  if (amount) amount.innerText = plan.amount;

  if (resultSection) {
    resultSection.classList.remove("hidden");
    resultSection.classList.add("fade-in");

    if (window.innerWidth < 768) {
      resultSection.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }
}
