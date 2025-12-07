/* -------------------------------------------------
 * 2. USAGE PAGE (ใช้ "10 แถวล่าสุด" จาก dataset2)
 * ------------------------------------------------- */
function renderUsagePage(data) {
  const usageLog = data.usage;
  if (!usageLog || usageLog.length === 0) return;

  // เรียงตามเวลา
  const sorted = [...usageLog].sort((a, b) => {
    return toDate(a.timestamp) - toDate(b.timestamp);
  });

  // ดึง 10 แถวล่าสุด (ถ้าข้อมูลน้อยกว่า 10 ก็ใช้ทั้งหมด)
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
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false } },
        y: { display: false, beginAtZero: true },
      },
    },
  });

  // ---------- เลือกแถวที่ใช้แสดง Insight ----------
  // หา record ล่าสุดที่มี power_watts หรือ cost_baht เป็นเลขจริง
  const targetLog =
    [...lastLogs]
      .reverse()
      .find((log) => {
        const p = Number(log.power_watts);
        const c = Number(log.cost_baht);
        return (!isNaN(p) && p !== 0) || (!isNaN(c) && c !== 0);
      }) || lastLogs[lastLogs.length - 1]; // ถ้าไม่เจอเลยใช้แถวสุดท้ายเดิม

  setText("insight-room", targetLog.room_number || "-");

  const powerVal = Number(targetLog.power_watts) || 0;
  const costVal = Number(targetLog.cost_baht) || 0;

  setText("insight-power", powerVal.toFixed(0) + " W");
  setText("insight-cost", costVal.toFixed(2) + " ฿");
}
