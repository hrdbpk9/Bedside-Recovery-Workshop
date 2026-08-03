// ------------------------------------------------------------
// State
// ------------------------------------------------------------
let registrations = [];   // [{Timestamp, EmployeeID, Name, Position, Dept, RoundID}]
let deptOverrides = {};   // {deptName: overrideCount}
let selectedEmployee = null;
let selectedRoundId = null;
let loadingData = false;

const byId = (id) => document.getElementById(id);

// ------------------------------------------------------------
// Data loading
// ------------------------------------------------------------
async function loadAllData() {
  if (loadingData) return;
  loadingData = true;
  try {
    const [regs, overrides] = await Promise.all([
      fetchSheet("Registrations"),
      fetchSheet("DeptOverride").catch(() => []),
    ]);
    registrations = regs;
    deptOverrides = {};
    overrides.forEach((r) => {
      if (r.Dept) deptOverrides[r.Dept] = parseInt(r.OverrideCount, 10) || 0;
    });
    renderAll();
  } catch (err) {
    console.error(err);
    showBanner(
      "ไม่สามารถโหลดข้อมูลล่าสุดได้ (ตรวจสอบการตั้งค่า Google Sheet ใน gas.js) — ระบบยังใช้งานได้ แต่ตัวเลขอาจไม่อัปเดต",
      "warn"
    );
  } finally {
    loadingData = false;
  }
}

function showBanner(text, kind) {
  const el = byId("global-banner");
  if (!el) return;
  el.textContent = text;
  el.className = "msg " + kind;
  el.classList.remove("hidden");
}

// ------------------------------------------------------------
// Tabs
// ------------------------------------------------------------
function setTab(tab) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
  byId("panel-" + tab).classList.remove("hidden");
  byId("tabbtn-" + tab).classList.add("active");
  if (tab === "dashboard") renderDashboard();
  if (tab === "search") { /* nothing to preload */ }
}

// ------------------------------------------------------------
// Registration flow
// ------------------------------------------------------------
function findRegistration(employeeId) {
  return registrations.find((r) => r.EmployeeID === employeeId);
}

function roundCount(roundId) {
  return registrations.filter((r) => r.RoundID === roundId).length;
}

function verifyEmployee() {
  const code = byId("emp-code-input").value.trim();
  const resultBox = byId("verify-result");
  const roundSection = byId("round-section");
  resultBox.innerHTML = "";
  roundSection.classList.add("hidden");
  selectedEmployee = null;
  selectedRoundId = null;

  if (!code) {
    resultBox.innerHTML = `<div class="msg error">กรุณากรอกรหัสพนักงาน</div>`;
    return;
  }
  const emp = TARGET_EMPLOYEES.find((e) => e.id === code);
  if (!emp) {
    resultBox.innerHTML = `<div class="msg error">ไม่พบรหัสพนักงานนี้ในกลุ่มเป้าหมาย Workshop — กรุณาตรวจสอบรหัส หรือติดต่อ HRD หากคิดว่าควรอยู่ในกลุ่มเป้าหมาย</div>`;
    return;
  }
  selectedEmployee = emp;
  resultBox.innerHTML = `
    <div class="emp-card">
      <div>
        <div class="name">${emp.name}</div>
        <div class="meta">${emp.position} · ${emp.dept}</div>
      </div>
      <div class="mono">รหัส ${emp.id}</div>
    </div>`;

  const existing = findRegistration(emp.id);
  if (existing) {
    const r = ROUNDS.find((rr) => rr.id === existing.RoundID);
    resultBox.innerHTML += `<div class="msg ok">ลงทะเบียนแล้ว: รอบวันที่ ${r ? r.dateLabel : ""} เวลา ${r ? r.start + "–" + r.end : ""} น. — เลือกรอบใหม่ด้านล่างเพื่อเปลี่ยนรอบ</div>`;
    selectedRoundId = existing.RoundID;
  }

  renderRoundPicker();
  roundSection.classList.remove("hidden");
}

function renderRoundPicker() {
  const grouped = {};
  ROUNDS.forEach((r) => {
    grouped[r.date] = grouped[r.date] || [];
    grouped[r.date].push(r);
  });

  let html = `<div class="round-groups">`;
  Object.values(grouped).forEach((dayRounds) => {
    html += `<div><span class="round-date-label">วัน${dayRounds[0].weekday}ที่ ${dayRounds[0].dateLabel} · ${dayRounds[0].location}</span>
      <div class="round-cards">`;
    dayRounds.forEach((r) => {
      const count = roundCount(r.id);
      const isFull = count >= r.capacity;
      const isSelected = selectedRoundId === r.id;
      const pct = Math.min(100, Math.round((count / r.capacity) * 100));
      html += `
        <div class="round-card ${isSelected ? "selected" : ""} ${isFull && !isSelected ? "full" : ""}"
             onclick="${isFull && !isSelected ? "" : `pickRound('${r.id}')`}">
          <div class="time">${r.start}–${r.end} น.</div>
          <div class="cap">${count}/${r.capacity} ที่นั่ง ${isFull ? "· เต็มแล้ว" : ""}</div>
          <div class="bar"><i style="width:${pct}%"></i></div>
        </div>`;
    });
    html += `</div></div>`;
  });
  html += `</div>`;
  byId("round-picker").innerHTML = html;

  byId("confirm-round-btn").disabled = !selectedRoundId;
}

function pickRound(roundId) {
  selectedRoundId = roundId;
  renderRoundPicker();
}

async function confirmRound() {
  if (!selectedEmployee || !selectedRoundId) return;
  const btn = byId("confirm-round-btn");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  await postToGAS({
    action: "register",
    EmployeeID: selectedEmployee.id,
    Name: selectedEmployee.name,
    Position: selectedEmployee.position,
    Dept: selectedEmployee.dept,
    RoundID: selectedRoundId,
  });

  await loadAllData();
  const r = ROUNDS.find((rr) => rr.id === selectedRoundId);
  byId("verify-result").innerHTML += `<div class="msg ok">✓ ยืนยันการลงทะเบียนรอบวันที่ ${r.dateLabel} เวลา ${r.start}–${r.end} น. เรียบร้อยแล้ว</div>`;
  renderRoundPicker();
  btn.textContent = "ยืนยันเลือกรอบ";
  btn.disabled = false;
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------
function deptTargetCount(deptName) {
  if (deptOverrides[deptName] != null) return deptOverrides[deptName];
  return TARGET_EMPLOYEES.filter((e) => e.dept === deptName).length;
}

function renderDashboard() {
  const total = TARGET_EMPLOYEES.length;
  const registeredIds = new Set(registrations.map((r) => r.EmployeeID));
  const registeredCount = TARGET_EMPLOYEES.filter((e) => registeredIds.has(e.id)).length;
  const remaining = total - registeredCount;
  const pct = total ? Math.round((registeredCount / total) * 100) : 0;

  byId("kpi-total").textContent = total;
  byId("kpi-registered").textContent = registeredCount;
  byId("kpi-remaining").textContent = remaining;
  byId("kpi-pct").textContent = pct + "%";

  // per-round
  let roundsHtml = `<div class="round-cards" style="grid-template-columns:repeat(4,1fr);">`;
  ROUNDS.forEach((r) => {
    const count = roundCount(r.id);
    const pctR = Math.min(100, Math.round((count / r.capacity) * 100));
    roundsHtml += `
      <div class="round-card" style="cursor:default;">
        <div class="cap mono" style="margin-bottom:2px;">${r.dateLabel}</div>
        <div class="time">${r.start}–${r.end}</div>
        <div class="cap">${count}/${r.capacity} คน</div>
        <div class="bar"><i style="width:${pctR}%"></i></div>
      </div>`;
  });
  roundsHtml += `</div>`;
  byId("rounds-dashboard").innerHTML = roundsHtml;

  // per-department
  const deptStats = DEPT_INFO.map((d) => {
    const target = deptTargetCount(d.dept);
    const regCount = TARGET_EMPLOYEES.filter(
      (e) => e.dept === d.dept && registeredIds.has(e.id)
    ).length;
    const dpct = target ? Math.round((regCount / target) * 100) : 0;
    return { ...d, target, regCount, dpct };
  });

  let tableHtml = `<table><thead><tr>
    <th>หน่วยงาน</th><th>เป้าหมาย</th><th>ลงทะเบียนแล้ว</th><th>ความคืบหน้า</th>
  </tr></thead><tbody>`;
  deptStats.forEach((d) => {
    tableHtml += `<tr class="dept-row">
      <td>${d.dept}</td>
      <td class="mono">${d.target}</td>
      <td class="mono">${d.regCount}</td>
      <td style="min-width:160px;">
        <span class="dept-pct">${d.dpct}%</span>
        <div class="bar-outer"><div class="bar-inner" style="width:${d.dpct}%;"></div></div>
      </td>
    </tr>`;
  });
  tableHtml += `</tbody></table>`;
  byId("dept-table").innerHTML = tableHtml;
}

// ------------------------------------------------------------
// Search
// ------------------------------------------------------------
function runSearch() {
  const q = byId("search-input").value.trim().toLowerCase();
  const resultBox = byId("search-result");
  if (!q) {
    resultBox.innerHTML = `<div class="msg error">กรุณากรอกชื่อหรือรหัสพนักงาน</div>`;
    return;
  }
  const matches = TARGET_EMPLOYEES.filter(
    (e) => e.id.includes(q) || e.name.toLowerCase().includes(q)
  ).slice(0, 20);

  if (!matches.length) {
    resultBox.innerHTML = `<div class="msg error">ไม่พบรายชื่อในกลุ่มเป้าหมาย Workshop</div>`;
    return;
  }

  let html = "";
  matches.forEach((emp) => {
    const reg = findRegistration(emp.id);
    const r = reg ? ROUNDS.find((rr) => rr.id === reg.RoundID) : null;
    html += `
      <div class="emp-card" style="margin-bottom:10px;">
        <div>
          <div class="name">${emp.name}</div>
          <div class="meta">${emp.position} · ${emp.dept} · รหัส ${emp.id}</div>
        </div>
        <div>
          ${
            reg
              ? `<span class="status-badge registered">ลงทะเบียนแล้ว — ${r ? r.dateLabel + " " + r.start + "–" + r.end + " น." : reg.RoundID}</span>`
              : `<span class="status-badge pending">ยังไม่ลงทะเบียน</span>`
          }
        </div>
      </div>`;
  });
  resultBox.innerHTML = html;
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
function renderAll() {
  const active = document.querySelector(".tabs button.active");
  if (active && active.id === "tabbtn-dashboard") renderDashboard();
}

document.addEventListener("DOMContentLoaded", () => {
  loadAllData();
  setInterval(loadAllData, 30000);
});
