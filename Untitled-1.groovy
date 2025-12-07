// ================== CONFIG ==================
const DATA_URL = "dataset.json"; // ชื่อไฟล์ JSON ที่เก็บ data set
const BUDGET_LIMIT = 1500;       // งบประมาณค่าไฟต่อเดือน (ปรับได้)

// ================== MAIN ====================
document.addEventListener("DOMContentLoaded", async () => {
  // ตั้งค่า default font ให้ Chart.js (ถ้าโหลด Chart.js แล้ว)
  if (window.Chart) {
    Chart.defaults.font.family = "'Prompt', sans-serif";
    Chart.defaults.color = "#888888";
  }

  const hasDashboard    = document.getElementById("display-amount");
  const hasUsageChart   = document.getElementById("usageChart");
  const hasWarningChart = document.getElementById("warningChart");
  const hasPieChart     = document.getElementById("pieChart");

  // ถ้าในหน้านี้ไม่มี element พวกนี้เลย ไม่ต้องโหลดอะไร
  if (!hasDashboard && !hasUsageChart && !hasWarningChart && !hasPieChart) return;

  try {
    const raw = await fetchData();
    const rows = normalizeData(raw);

    if (!rows.length) {
      console.error("Dataset is empty");
      return;
    }

    if (hasDashboard)    renderDashboard(rows);
    if (hasUsageChart)   renderUsagePage(rows);
    if (hasWarningChart) renderWarningPage(rows);
    if (hasPieChart)     renderBreakdownPage(rows);
  } catch (err) {
    console.error("Error loading data:", err);
    if (document.getElementById("display-amount")) {
      document.getElementById("display-amount").innerText = "Error";
    }
  }
});

// ดึงข้อมูลจากไฟล์ JSON (กัน cache ด้วย timestamp)
async function fetchData() {
  const url = DATA_URL + "?t=" + Date.now();
  const res = await fetch(url);
  if (!res.ok) throw new Error("Network error " + res.status);
  return await res.json();
}

// รองรับได้ทั้งกรณีที่ JSON เป็น array ตรง ๆ หรืออยู่ใน field "data" / "usage"
function normalizeData(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.usage)) return raw.usage;
  return [];
}

// ================= DASHBOARD =================
// แสดงยอดค่าไฟสะสม + progress bar + เวลาล่าสุด
function renderDashboard(rows) {
  const sorted = sortByTime(rows);

  // รวมค่าไฟทั้งหมดจาก cost_baht
  const totalCost = sorted.reduce((sum, row) => {
    const c = parseFloat(row.cost_baht || 0);
    return sum + (isNaN(c) ? 0 : c);
  }, 0);

  animateValue("display-amount", 0, totalCost, 1000);

  const percent = (totalCost / BUDGET_LIMIT) * 100;
  const fillElem = document.getElementById("progress-fill");
  const textElem = document.getElementById("progress-text");

  if (fillElem) {
    fillElem.style.width = Math.min(percent, 100) + "%";
    fillElem.style.backgroundColor = percent > 80 ? "#FF5252" : "#333333";
  }
  if (textElem) {
    textElem.innerText = `${Math.floor(totalCost)} ฿ จาก ${BUDGET_LIMIT} ฿`;
  }

  // timestamp แถวสุดท้าย = เวลาอัปเดตล่าสุด
  const lastRow = sorted[sorted.length - 1];
  const d = new Date(lastRow.timestamp.replace(" ", "T"));
  const lastUpdateText = d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  setText("last-update", `อัปเดตล่าสุด: ${lastUpdateText}`);
}

// ================ USAGE PAGE ================
// ใช้ 10 แถวล่าสุดของ dataset มาวาดกราฟเส้น
function renderUsagePage(rows) {
  const sorted = sortByTime(rows);
  const windowSize = 10;
  const startIndex = Math.max(sorted.length - windowSize, 0);
  const lastRows = sorted.slice(startIndex);

  const labels = lastRows.map((row) => {
    const d = new Date(row.timestamp.replace(" ", "T"));
    const h = d.getHours().toString().padStart(2, "0");
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  });

  const usageData = lastRows.map((row) => {
    const k = parseFloat(row.kWh_usage || 0);
    return isNaN(k) ? 0 : k;
  });

  const canvas = document.getElementById("usageChart");
  if (!canvas || !window.Chart) return;

  new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "การใช้ไฟ (kWh)",
          data: usageData,
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
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          display: false,
          beginAtZero: true,
        },
      },
    },
  });

  // ใช้ข้อมูลแถวล่าสุดในหน้าจอนี้ทำ insight
  const last = lastRows[lastRows.length - 1];
  setText("insight-room", "ห้อง " + (last.room_number ?? "-"));
  setText("insight-power", (last.power_watts ?? "-") + " W");
  setText(
    "insight-cost",
    (parseFloat(last.cost_baht || 0).toFixed(2)) + " ฿"
  );
}

// ============== WARNING PAGE ===============
// กราฟค่าไฟสะสมจริง vs เส้นงบประมาณ
function renderWarningPage(rows) {
  const sorted = sortByTime(rows);

  let cumulativeCost = 0;
  const labels = [];
  const actualCostData = [];
  const budgetData = [];

  sorted.forEach((row) => {
    const c = parseFloat(row.cost_baht || 0);
    cumulativeCost += isNaN(c) ? 0 : c;

    const d = new Date(row.timestamp.replace(" ", "T"));
    const label = `${d.getDate()}/${d.getMonth() + 1} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:00`;

    labels.push(label);
    actualCostData.push(cumulativeCost);
    budgetData.push(BUDGET_LIMIT);
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
          data: actualCostData,
          borderColor: "#FF5252",
          backgroundColor: gradient,
          borderWidth: 2,
          tension: 0.4,
          pointRadius: 0,
          fill: true,
        },
        {
          label: `งบประมาณ (${BUDGET_LIMIT} บ.)`,
          data: budgetData,
          borderColor: "#333333",
          borderWidth: 1.5,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { usePointStyle: true, boxWidth: 8 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${Math.floor(ctx.raw)} บาท`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, maxRotation: 0 },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#f5f5f5" },
        },
      },
    },
  });
}

// ============ BREAKDOWN PAGE ==============
// แบ่งการใช้ไฟเป็นกลางวัน / กลางคืน แล้วทำ doughnut chart
function renderBreakdownPage(rows) {
  let dayUsage = 0;
  let nightUsage = 0;

  rows.forEach((row) => {
    const k = parseFloat(row.kWh_usage || 0);
    if (isNaN(k)) return;

    const d = new Date(row.timestamp.replace(" ", "T"));
    const hour = d.getHours();

    // สมมติกึ่ง ๆ ว่า 9:00–22:00 = Off-Peak (กลางวัน) ที่เหลือ = Peak (กลางคืน)
    if (hour >= 9 && hour < 22) {
      dayUsage += k;
    } else {
      nightUsage += k;
    }
  });

  const total = dayUsage + nightUsage;
  const dayPercent = total ? ((dayUsage / total) * 100).toFixed(0) : 0;
  const nightPercent = total ? ((nightUsage / total) * 100).toFixed(0) : 0;

  setText("legend-day", `กลางวัน ${dayPercent}% (Off-Peak)`);
  setText("legend-night", `กลางคืน ${nightPercent}% (Peak)`);

  const canvas = document.getElementById("pieChart");
  if (!canvas || !window.Chart) return;

  new Chart(canvas, {
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

// ============= HELPERS =============
function sortByTime(rows) {
  return [...rows].sort((a, b) => {
    const ta = new Date((a.timestamp || "").replace(" ", "T")).getTime();
    const tb = new Date((b.timestamp || "").replace(" ", "T")).getTime();
    return ta - tb;
  });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function animateValue(id, start, end, duration) {
  const el = document.getElementById(id);
  if (!el) return;

  let startTime = null;

  function step(ts) {
    if (!startTime) startTime = ts;
    const progress = Math.min((ts - startTime) / duration, 1);
    const value = Math.floor(start + (end - start) * progress);
    el.innerHTML = value.toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ========== INTERACTIVE PLAN ==========
// ถ้ามีหน้าเลือกแผน Lite / Balance / Max แบบในเดโมเดิม
function showPlanList() {
  const start = document.getElementById("step-start");
  const select = document.getElementById("step-selection");
  if (start) start.style.display = "none";
  if (select) {
    select.classList.remove("hidden");
    select.classList.add("fade-in");
  }
}

function showPlanDetail(planType) {
  const result = document.getElementById("step-result");
  const title = document.getElementById("result-title");
  const desc = document.getElementById("result-desc");
  const amount = document.getElementById("result-amount");

  const plans = {
    lite: {
      title: "แผน Lite (เริ่มต้น)",
      desc: "เน้นปิดไฟ/ถอดปลั๊กเมื่อไม่ใช้งาน ไม่กระทบชีวิตประจำวันมาก",
      amount: "50 - 80 บาท",
    },
    balance: {
      title: "แผน Balance (แนะนำ)",
      desc: "ปรับแอร์ 26°C และเลี่ยงช่วง Peak (13:00-15:00)",
      amount: "150 - 200 บาท",
    },
    max: {
      title: "แผน Max (ประหยัดสูงสุด)",
      desc: "งดใช้เครื่องทำน้ำอุ่น / อบผ้า และเปิดแอร์เฉพาะตอนนอน",
      amount: "300+ บาท",
    },
  };

  const plan = plans[planType];
  if (!plan) return;

  if (title) title.innerText = plan.title;
  if (desc) desc.innerText = plan.desc;
  if (amount) amount.innerText = plan.amount;

  if (result) {
    result.classList.remove("hidden");
    result.classList.add("fade-in");
    if (window.innerWidth < 768) {
      result.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }
}
