const ADMIN_USER = "HR";
const ADMIN_PASS = "bpk9";

let registrations = [];
let targetList = [];     // live target list pulled from the TargetList sheet (falls back to embedded data)
let deptOverrides = {};

const byId = (id) => document.getElementById(id);

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------
function tryLogin() {
  const u = byId("login-user").value.trim();
  const p = byId("login-pass").value;
  const err = byId("login-error");
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    sessionStorage.setItem("bpk9_admin", "1");
    showAdmin();
  } else {
    err.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
    err.classList.remove("hidden");
  }
}

function logout() {
  sessionStorage.removeItem("bpk9_admin");
  location.reload();
}

function showAdmin() {
  byId("login-shell").classList.add("hidden");
  byId("admin-shell").classList.remove("hidden");
  loadAllData();
}

// ------------------------------------------------------------
// Data loading — TargetList sheet overrides the embedded default list
// once the backend is connected, so admin edits are reflected everywhere.
// ------------------------------------------------------------
async function loadAllData() {
  try {
    const [regs, tlist, overrides] = await Promise.all([
      fetchSheet("Registrations"),
      fetchSheet("TargetList").catch(() => []),
      fetchSheet("DeptOverride").catch(() => []),
    ]);
    registrations = regs;
    targetList = tlist.length
      ? tlist.map((r) => ({ id: r.EmployeeID, name: r.Name, position: r.Position, dept: r.Dept }))
      : TARGET_EMPLOYEES;
    deptOverrides = {};
    overrides.forEach((r) => {
      if (r.Dept) deptOverrides[r.Dept] = parseInt(r.OverrideCount, 10) || 0;
    });
    renderTargetTable();
    renderDeptOverrides();
    renderSummary();
  } catch (err) {
    console.error(err);
    showBanner("โหลดข้อมูลจาก Google Sheet ไม่สำเร็จ — ตรวจสอบการตั้งค่าใน gas.js", "warn");
  }
}

function showBanner(text, kind) {
  const el = byId("admin-banner");
  el.textContent = text;
  el.className = "msg " + kind;
  el.classList.remove("hidden");
}

// ------------------------------------------------------------
// Target list: add / remove
// ------------------------------------------------------------
function renderTargetTable() {
  const registeredIds = new Set(registrations.map((r) => r.EmployeeID));
  let html = `<table><thead><tr>
    <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>หน่วยงาน</th><th>สถานะ</th><th></th>
  </tr></thead><tbody>`;
  targetList
    .slice()
    .sort((a, b) => a.dept.localeCompare(b.dept, "th"))
    .forEach((e) => {
      html += `<tr>
        <td class="mono">${e.id}</td>
        <td>${e.name}</td>
        <td>${e.position}</td>
        <td>${e.dept}</td>
        <td>${
          registeredIds.has(e.id)
            ? `<span class="status-badge registered">ลงทะเบียนแล้ว</span>`
            : `<span class="status-badge pending">ยังไม่ลงทะเบียน</span>`
        }</td>
        <td><button class="tag-remove" onclick="removeTarget('${e.id}')">ลบ</button></td>
      </tr>`;
    });
  html += `</tbody></table>`;
  byId("target-table").innerHTML = html;
  byId("target-count-pill").textContent = targetList.length + " คน";
}

let searchTimeout = null;
function onEmployeeSearchInput() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(renderEmployeeSuggestions, 120);
}

function renderEmployeeSuggestions() {
  const q = byId("add-emp-search").value.trim().toLowerCase();
  const box = byId("add-emp-suggestions");
  if (!q) { box.innerHTML = ""; box.classList.add("hidden"); return; }
  const existingIds = new Set(targetList.map((e) => e.id));
  const matches = ALL_EMPLOYEES.filter(
    (e) =>
      !existingIds.has(e.id) &&
      (e.id.includes(q) || e.name.toLowerCase().includes(q))
  ).slice(0, 12);

  if (!matches.length) {
    box.innerHTML = `<div class="autocomplete-item">ไม่พบรายชื่อ</div>`;
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = matches
    .map(
      (e) =>
        `<div class="autocomplete-item" onclick='selectEmployeeToAdd(${JSON.stringify(e)})'>
          <strong>${e.name}</strong> — ${e.position} · ${e.dept} · <span class="mono">${e.id}</span>
        </div>`
    )
    .join("");
  box.classList.remove("hidden");
}

let pendingAdd = null;
function selectEmployeeToAdd(emp) {
  pendingAdd = emp;
  byId("add-emp-search").value = `${emp.name} (${emp.id})`;
  byId("add-emp-suggestions").classList.add("hidden");
  byId("add-emp-btn").disabled = false;
}

async function addTargetEmployee() {
  if (!pendingAdd) return;
  const btn = byId("add-emp-btn");
  btn.disabled = true;
  btn.textContent = "กำลังเพิ่ม...";
  await postToGAS({
    action: "admin_add",
    EmployeeID: pendingAdd.id,
    Name: pendingAdd.name,
    Position: pendingAdd.position,
    Dept: pendingAdd.dept,
  });
  pendingAdd = null;
  byId("add-emp-search").value = "";
  btn.textContent = "เพิ่มเข้ากลุ่มเป้าหมาย";
  await loadAllData();
}

async function removeTarget(employeeId) {
  if (!confirm("ลบรายชื่อนี้ออกจากกลุ่มเป้าหมาย?")) return;
  await postToGAS({ action: "admin_remove", EmployeeID: employeeId });
  await loadAllData();
}

// ------------------------------------------------------------
// Department target overrides
// ------------------------------------------------------------
function renderDeptOverrides() {
  let html = `<table><thead><tr>
    <th>หน่วยงาน</th><th>จำนวนจากรายชื่อ</th><th>จำนวนเป้าหมาย (แก้ไขได้)</th><th></th>
  </tr></thead><tbody>`;
  DEPT_INFO.forEach((d) => {
    const listCount = targetList.filter((e) => e.dept === d.dept).length;
    const overrideVal = deptOverrides[d.dept] != null ? deptOverrides[d.dept] : listCount;
    html += `<tr>
      <td>${d.dept}</td>
      <td class="mono">${listCount}</td>
      <td style="max-width:120px;">
        <input type="number" min="0" class="mono" id="override-${cssSafe(d.dept)}" value="${overrideVal}">
      </td>
      <td><button class="btn ghost small-btn" onclick="saveOverride('${d.dept.replace(/'/g, "\\'")}')">บันทึก</button></td>
    </tr>`;
  });
  html += `</tbody></table>`;
  byId("dept-override-table").innerHTML = html;
}

function cssSafe(s) {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

async function saveOverride(dept) {
  const val = byId("override-" + cssSafe(dept)).value;
  await postToGAS({ action: "admin_set_override", Dept: dept, OverrideCount: val });
  await loadAllData();
}

// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------
function renderSummary() {
  const registeredIds = new Set(registrations.map((r) => r.EmployeeID));
  const registeredCount = targetList.filter((e) => registeredIds.has(e.id)).length;
  byId("summary-total").textContent = targetList.length;
  byId("summary-registered").textContent = registeredCount;
  byId("summary-pct").textContent = targetList.length
    ? Math.round((registeredCount / targetList.length) * 100) + "%"
    : "0%";
}

document.addEventListener("DOMContentLoaded", () => {
  if (sessionStorage.getItem("bpk9_admin") === "1") {
    showAdmin();
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete")) {
      byId("add-emp-suggestions").classList.add("hidden");
    }
  });
});
