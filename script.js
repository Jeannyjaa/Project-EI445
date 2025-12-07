// --- CONFIGURATION: Google Sheets 3 ลิงก์ ---
// 1) test:  1uY2EGP7UkzMKTlhFr4vlO70ovk3yCpv4Rbo3SA7UJFk (ยังไม่ใช้)
// 2) dataset2 (usage log หลัก): 1QF7MeuGdKgdr9J0coQa5e_PWARxItijf44FN8vcCoM4
// 3) dataset1 (profile/amount_paid): 1nklvlk-u0thbcZUtJ0HuExlx1kBdAME9CdjjMHzvaf0

const SHEETS = {
  usage:   { id: "1QF7MeuGdKgdr9J0coQa5e_PWARxItijf44FN8vcCoM4", gid: "0" }, // dataset2
  profile: { id: "1nklvlk-u0thbcZUtJ0HuExlx1kBdAME9CdjjMHzvaf0", gid: "0" }, // dataset1
};

let BUDGET_LIMIT = 1500; // ยังใช้เป็นงบ fix ถ้าอยากให้ดึงจากชีตทีหลังค่อยปรับได้

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

  // ถ้าหน้านี้ไม่มี element ไหนเลย ก็ไม่ต้องโหลดอะไร
  if (!hasDashboard && !hasUsageChart && !hasWarningChart && !hasPieChart) return;

  try {
    const data = await fetchDataFromSheets(); // <--- ใช้ Google Sheet

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

// helper แปลงชื่อคอลัมน์ให้ normalize
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

  // ตัด wrapper google.visualization.Query.setResponse(...)
  const jsonStr = text.substring(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const obj = JSON.parse(jsonStr);

  return obj.table; // { cols, rows }
}

// แปลง dataset2 → array ของ usage log ตามฟิลด์ที่ script เดิมใช้
function parseUsageFromDataset2(table) {
  const rawCols = table.cols.map((c) => c.label || "");
  const cols = rawCols.map((label) => normalizeLabel(label));

  // พยายามหา index ของแต่ละ field แบบยืดหยุ่น
  let idxTimestamp = cols.findIndex(
    (l) => l === "timestamp" || l === "time" || l.startsWith("datetime")
  );
  let idxRoom = cols.findIndex(
    (l) => l === "room_number" || l === "roomnumber" || l === "room"
  );
  let idxPowerWatts = cols.findIndex(
    (l) => l === "power_watts" || l === "powerwatts" || l === "power" || l === "watt"
  );
  let idxKwhUsage = cols.findIndex(
    (l) => l === "kwh_usage" || l === "kwhusage" || l === "kwh"
  );
  let idxCostBaht = cols.findIndex(
    (l) => l === "cost_baht" || l === "costbaht" || l === "cost" || l === "bill"
  );

  // ถ้าหาไม่เจอเลย ลอง fallback เป็นตำแหน่งคอลัมน์ตามลำดับ
  if (idxTimestamp === -1) idxTimestamp = 0;
  if (idxRoom === -1 && rawCols.length > 1) idxRoom = 1;
  if (idxPowerWatts === -1 && rawCols.length > 2) idxPowerWatts = 2;
  if (idxKwhUsage === -1 && rawCols.length > 3) idxKwhUsage = 3;
  if (idxCostBaht === -1 && rawCols.length > 4) idxCostBaht = 4;

  return table.rows
    .filter((r) => r.c && r.c[idxTimestamp] && r.c[idxTimestamp].v != null)
    .map((r) => {
      const c = r.c;

      const tsRaw    = c[idxTimestamp]  ? c[idxTimestamp].v  : "";
      const roomRaw  = c[idxRoom]       ? c[idxRoom].v       : "";
      const powerRaw = c[idxPowerWatts] ? c[idxPowerWatts].v : 0;
      const kwhRaw   = c[idxKwhUsage]   ? c[idxKwhUsage].v   : 0;
      const costRaw  = c[idxCostBaht]   ? c[idxCostBaht].v   : 0;

      const room     = roomRaw == null ? "" : roomRaw;
      const powerNum = Number(powerRaw) || 0;
      const kwhNum   = Number(kwhRaw)   || 0;
      const costNum  = Number(costRaw)  || 0;

      return {
        timestamp:   tsRaw,
        room_number: room,
        power_watts: powerNum,
        kwh_usage:   kwhNum,
        cost_baht:   costNum,
      };
    });
}

// แปลง dataset1 → profile array (เก็บไว้เผื่อใช้ต่อ)
function parseProfileTable(table) {
  const cols = table.cols.map((c) => (c.label || "").trim());

  return table.rows
    .filter((r) => r.c && r.c.some((cell) => cell && cell.v != null))
    .map((r) => {
      const obj = {};
      r.c.forEach((cell, idx) => {
        const key = cols[idx] || `col_${idx}`;
        obj[key] = cell ? cell.v : null;
      });
      return obj;
    });
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

// ดึง usage + profile จาก 2 ชีต
async function fetchDataFromSheets() {
  const [usageTable, profileTable] = await Promise.all([
    fetchSheetTable(SHEETS.usage.id, SHEETS.usage.gid),
    fetchSheetTable(SHEETS.profile.id, SHEETS.profile.gid),
  ]);

  const usage   = parseUsageFromDataset2(usageTable);
  const profile = parseProfileTable(profileTable);

  // เรียง usage ตามเวลา
  usage.sort((a, b) => toDate(a.timestamp) - toDate(b.timestamp));

  return { usage, profile };
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

  setText("insight-room", targetLog.room_number || "-");
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

  window.userProfile = data.profile;
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
