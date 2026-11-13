(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const R = window.ReviewRules, API = window.ReviewAPI, roster = window.REVIEW_ROSTER;
  const students = roster.students, demo = new URLSearchParams(location.search).get("demo") === "1";
  const demoKey = "robotics-review.demo.ballots." + roster.version;
  let dashboard = null, activeTab = "summary", busy = false, resetting = false, resetRound = null;
  function errorAt(id, error) { $(id).textContent = error.message || String(error); $(id).classList.remove("hidden"); }
  function getDemoDashboard() {
    let ballots;
    try { ballots = JSON.parse(localStorage.getItem(demoKey) || "[]"); }
    catch (_) { throw new Error("本机体验数据无法读取"); }
    const rows = R.summarize(students, ballots).map(s => ({
      id: s.id, sort_order: s.order, name: s.name, total: s.total, received_count: s.count,
      average: s.average, submitted: s.submitted, submitted_at: ballots.find(b => b.rater_id === s.id)?.submitted_at || null,
    }));
    return { students: rows, total_students: students.length, submitted_count: ballots.length, accepting: localStorage.getItem(demoKey + ".closed") !== "1", round_id: localStorage.getItem(demoKey + ".round") || "initial", roster_version: roster.version, refreshed_at: new Date().toISOString() };
  }
  function validateDashboard(data) {
    if (data.roster_version !== roster.version) throw new Error("后台名单与页面版本不一致，请刷新或检查部署配置。");
    const expectedIds = new Set(students.map(s => s.id));
    if (!Array.isArray(data.students) || data.students.length !== students.length || new Set(data.students.map(s => s.id)).size !== students.length || data.students.some(s => !expectedIds.has(s.id))) throw new Error("后台返回的名单不完整，暂不展示统计。");
    if (Number(data.submitted_count) !== data.students.filter(s => s.submitted).length) throw new Error("提交人数不一致，请重新刷新。");
  }
  async function refresh() {
    if (busy) return;
    busy = true; $("refreshButton").disabled = true; $("resetButton").disabled = true; $("dashboardError").classList.add("hidden");
    try {
      const next = demo ? getDemoDashboard() : await API.dashboard(); validateDashboard(next); dashboard = next;
      $("loginSection").classList.add("hidden"); $("dashboardSection").classList.remove("hidden"); render();
    } catch (error) { errorAt(dashboard ? "dashboardError" : "loginError", error); }
    finally { busy = false; $("refreshButton").disabled = false; $("resetButton").disabled = resetting || !dashboard?.round_id; }
  }
  function filteredRows() {
    const query = $("adminSearch").value.trim().toLowerCase();
    let rows = dashboard.students.filter(s => !query || s.name.toLowerCase().includes(query) || String(s.sort_order).includes(query));
    if (activeTab === "missing") rows = rows.filter(s => !s.submitted);
    return rows.sort($("sortSelect").value === "average" && activeTab === "summary"
      ? (a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity) || a.sort_order - b.sort_order
      : (a, b) => a.sort_order - b.sort_order);
  }
  function renderTable() {
    const rows = filteredRows(); $("summaryBody").replaceChildren(); $("missingList").replaceChildren();
    if (activeTab === "summary") {
      for (const s of rows) {
        const tr = document.createElement("tr"); tr.dataset.studentId = s.id;
        const values = [String(s.sort_order).padStart(2, "0"), s.name, s.average === null ? "暂无评分" : Number(s.average).toFixed(2), s.total, s.received_count];
        values.forEach((value, i) => { const td = document.createElement("td"); td.textContent = value; if (i === 2) td.className = "average-value"; tr.append(td); });
        const statusCell = document.createElement("td"), badge = document.createElement("span");
        badge.className = "status-badge" + (s.submitted ? "" : " pending"); badge.textContent = s.submitted ? "已提交" : "未提交"; statusCell.append(badge); tr.append(statusCell);
        $("summaryBody").append(tr);
      }
    } else {
      for (const s of rows) {
        const person = document.createElement("div"); person.className = "missing-person";
        const order = document.createElement("span"); order.textContent = String(s.sort_order).padStart(2, "0");
        const name = document.createElement("strong"); name.textContent = s.name; person.append(order, name); $("missingList").append(person);
      }
    }
    $("adminEmpty").classList.toggle("hidden", rows.length !== 0);
    if (!rows.length && activeTab === "missing" && !$("adminSearch").value) $("adminEmpty").textContent = "全班均已提交，没有未提交的同学。";
    else $("adminEmpty").textContent = "没有符合条件的同学。";
  }
  function render() {
    $("statTotal").textContent = dashboard.total_students;
    $("statSubmitted").textContent = dashboard.submitted_count;
    const missing = dashboard.total_students - dashboard.submitted_count;
    $("statMissing").textContent = missing; $("missingBadge").textContent = missing;
    $("statPercent").textContent = `提交率 ${(dashboard.submitted_count / dashboard.total_students * 100).toFixed(1)}%`;
    $("activityStatus").textContent = dashboard.accepting ? "收集中" : "已暂停";
    $("toggleActivity").textContent = dashboard.accepting ? "暂停收集 →" : "重新开放 →";
    $("lastUpdated").textContent = "更新于 " + new Date(dashboard.refreshed_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
    renderTable();
  }
  function setTab(tab) {
    activeTab = tab;
    for (const name of ["summary", "missing"]) {
      $(name + "Tab").classList.toggle("active", name === tab);
      $(name + "Tab").setAttribute("aria-selected", String(name === tab));
      $(name + "Panel").classList.toggle("hidden", name !== tab);
    }
    $("sortLabel").classList.toggle("hidden", tab !== "summary"); renderTable();
  }
  function download(name, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault(); $("loginError").classList.add("hidden"); $("loginButton").disabled = true; $("loginButton").textContent = "正在登录…";
    try { await API.signIn($("emailInput").value.trim(), $("passwordInput").value); $("passwordInput").value = ""; await refresh(); }
    catch (error) { errorAt("loginError", error); }
    finally { $("loginButton").disabled = false; $("loginButton").textContent = "登录并查看结果"; }
  });
  $("refreshButton").addEventListener("click", refresh);
  $("logoutButton").addEventListener("click", async () => {
    if (demo) { location.href = "admin.html"; return; }
    try { await API.signOut(); } catch (_) { /* 本地会话已经清除。 */ }
    dashboard = null; $("dashboardSection").classList.add("hidden"); $("loginSection").classList.remove("hidden"); $("summaryBody").replaceChildren(); $("missingList").replaceChildren();
  });
  $("summaryTab").addEventListener("click", () => setTab("summary")); $("missingTab").addEventListener("click", () => setTab("missing"));
  $("adminSearch").addEventListener("input", () => { if (dashboard) renderTable(); }); $("sortSelect").addEventListener("change", renderTable);
  $("exportButton").addEventListener("click", () => {
    const rows = [...dashboard.students].sort((a,b) => a.sort_order - b.sort_order);
    download("全班互评-平均分汇总.csv", R.csv(["序号", "姓名", "平均分", "评分总和", "实际收到份数", "本人提交状态"], rows.map(s => [s.sort_order, s.name, s.average === null ? "暂无评分" : Number(s.average).toFixed(2), s.total, s.received_count, s.submitted ? "已提交" : "未提交"])));
  });
  $("exportMissing").addEventListener("click", () => download("全班互评-未提交名单.csv", R.csv(["序号", "姓名", "提交状态"], dashboard.students.filter(s => !s.submitted).sort((a,b) => a.sort_order-b.sort_order).map(s => [s.sort_order, s.name, "未提交"]))));
  $("toggleActivity").addEventListener("click", () => {
    $("activityDialogTitle").textContent = dashboard.accepting ? "暂停收集评价？" : "重新开放评价？";
    $("activityDialogText").textContent = dashboard.accepting ? "暂停后同学不能提交新问卷，已收到的评分和平均分会保留。" : "开放后，尚未提交的同学可以继续填写并提交。";
    $("activityError").classList.add("hidden"); $("activityDialog").showModal();
  });
  $("cancelActivity").addEventListener("click", () => $("activityDialog").close());
  $("confirmActivity").addEventListener("click", async () => {
    $("confirmActivity").disabled = true;
    try {
      if (demo) localStorage.setItem(demoKey + ".closed", dashboard.accepting ? "1" : "0");
      else await API.setAccepting(!dashboard.accepting);
      $("activityDialog").close(); await refresh();
    } catch (error) { errorAt("activityError", error); }
    finally { $("confirmActivity").disabled = false; }
  });
  $("resetButton").addEventListener("click", () => {
    if (busy || resetting || !dashboard?.round_id) return;
    resetRound = dashboard.round_id;
    $("resetSummary").textContent = `即将删除全班 ${dashboard.submitted_count} 份已提交的评分。`;
    $("resetError").classList.add("hidden"); $("resetDialog").showModal();
  });
  $("cancelReset").addEventListener("click", () => { if (!resetting) $("resetDialog").close(); });
  $("resetDialog").addEventListener("cancel", event => { if (resetting) event.preventDefault(); });
  $("confirmReset").addEventListener("click", async () => {
    if (resetting || !resetRound) return;
    resetting = true; $("confirmReset").disabled = true; $("cancelReset").disabled = true; $("resetButton").disabled = true;
    $("confirmReset").textContent = "正在清空…"; $("resetError").classList.add("hidden");
    try {
      if (demo) {
        if ((localStorage.getItem(demoKey + ".round") || "initial") !== resetRound) throw new Error("评分轮次已更新，请刷新后台后重试");
        localStorage.setItem(demoKey, "[]");
        localStorage.setItem(demoKey + ".closed", "0");
        localStorage.setItem(demoKey + ".round", crypto.randomUUID());
      } else await API.reset(resetRound);
      $("resetDialog").close(); $("adminSearch").value = ""; $("sortSelect").value = "order"; setTab("summary");
      await refresh();
    } catch (error) {
      const uncertain = /超时|无法连接|Failed to fetch|NetworkError/.test(error.message);
      errorAt("resetError", new Error(error.message + (uncertain ? " 请取消并刷新后台核对结果后再决定是否重试。" : "")));
    } finally {
      resetting = false; $("confirmReset").disabled = false; $("cancelReset").disabled = false;
      $("resetButton").disabled = !dashboard?.round_id; $("confirmReset").textContent = "确认清空";
    }
  });
  if (demo) {
    $("modeNotice").textContent = "本机体验：只统计同一浏览器体验模式下的提交，不代表正式评分结果。"; $("modeNotice").classList.remove("hidden");
    document.querySelectorAll('a[href="index.html"],a[href="./"]').forEach(a => a.href = "index.html?demo=1"); refresh();
  } else if (!API.ready) { $("demoLink").classList.remove("hidden"); $("loginButton").disabled = true; }
  window.addEventListener("storage", event => { if (demo && (event.key === demoKey || event.key === demoKey + ".closed" || event.key === demoKey + ".round")) refresh(); });
})();
