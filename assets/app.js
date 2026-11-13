(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const R = window.ReviewRules, API = window.ReviewAPI;
  const roster = window.REVIEW_ROSTER, students = roster.students;
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const demoBallotsKey = "robotics-review.demo.ballots." + roster.version;
  let me = null, scores = {}, submitting = false, saveAvailable = true, roundId = "initial";
  let toastTimer;
  const rowElements = new Map();
  const draftPrefix = "robotics-review.draft." + roster.version + "." + (demo ? "demo." : "live.");
  const draftKey = () => draftPrefix + (roundId === "initial" ? "" : roundId + ".") + me.id;
  function selectRound(value) {
    roundId = value || "initial";
    if (roundId === "initial") return;
    try {
      const keepPrefix = draftPrefix + roundId + ".";
      const oldKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(draftPrefix) && !key.startsWith(keepPrefix)) oldKeys.push(key);
      }
      oldKeys.forEach(key => localStorage.removeItem(key));
    } catch (_) { /* 无法清除旧缓存时，新轮的草稿键仍不会读取旧轮。 */ }
  }
  function showError(id, error) { $(id).textContent = error.message || String(error); $(id).classList.remove("hidden"); }
  function toast(message) {
    $("toast").textContent = message; $("toast").classList.remove("hidden");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.add("hidden"), 3200);
  }
  function readStorage(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch (_) { return fallback; }
  }
  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify(scores));
      $("saveState").textContent = "草稿已保存在当前浏览器";
      saveAvailable = true;
    } catch (_) {
      saveAvailable = false;
      $("saveState").textContent = "无法保存草稿，请勿关闭此页面";
    }
  }
  function resetSections() {
    $("identitySection").classList.remove("hidden");
    $("scoringSection").classList.add("hidden");
    $("successSection").classList.add("hidden");
    me = null; scores = {};
    $("identityError").classList.add("hidden");
  }
  function success(result) {
    $("identitySection").classList.add("hidden");
    $("scoringSection").classList.add("hidden");
    $("successSection").classList.remove("hidden");
    $("receiptName").textContent = me.name;
    $("receiptTime").textContent = result.submitted_at ? new Date(result.submitted_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "已记录";
    $("receiptCode").textContent = result.receipt || "已记录";
    $("successEyebrow").textContent = demo ? "本机体验 · 已模拟提交" : "评价已提交";
    $("successDescription").textContent = demo ? "体验数据只保存在此浏览器，可以继续修改，不计入正式评分。" : "你的评分已保存，可继续修改并重新提交，后台以最后一次为准。";
    saveDraft();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderStudents() {
    rowElements.clear(); $("studentList").replaceChildren();
    for (const s of students) {
      const row = document.createElement("article");
      row.className = "student-row" + (s.id === me.id ? " is-self" : "");
      row.dataset.studentId = s.id;
      const order = document.createElement("span"); order.className = "student-order"; order.textContent = String(s.order).padStart(2, "0");
      const name = document.createElement("div"); name.className = "student-name"; name.textContent = s.name;
      if (s.id === me.id) { const tag = document.createElement("span"); tag.className = "self-tag"; tag.textContent = "自己"; name.append(tag); }
      const label = document.createElement("label"); label.className = "score-label";
      const a11y = document.createElement("span"); a11y.className = "sr-only"; a11y.textContent = "为" + s.name + "评分";
      const select = document.createElement("select"); select.className = "score-select"; select.dataset.studentId = s.id;
      select.setAttribute("aria-label", "为" + s.name + "评分");
      const blank = document.createElement("option"); blank.value = ""; blank.textContent = "选择分数"; select.append(blank);
      for (const band of R.BANDS) {
        const group = document.createElement("optgroup"); group.label = band.label;
        for (let value = band.min; value <= band.max; value++) {
          const option = document.createElement("option"); option.value = String(value); option.textContent = value + " 分"; group.append(option);
        }
        select.append(group);
      }
      select.value = Object.hasOwn(scores, s.id) ? String(scores[s.id]) : "";
      select.addEventListener("change", () => {
        const previous = scores[s.id], value = select.value === "" ? undefined : Number(select.value);
        if (value === undefined) delete scores[s.id]; else scores[s.id] = value;
        const state = R.validate(scores, students);
        if (state.counts.some((count, i) => count > state.limits[i])) {
          if (previous === undefined) delete scores[s.id]; else scores[s.id] = previous;
          select.value = previous === undefined ? "" : String(previous);
          toast("这个分档名额已满，请先清除该档另一人的分数。");
        }
        saveDraft(); update();
      });
      label.append(a11y, select); row.append(order, name, label);
      rowElements.set(s.id, { row, select }); $("studentList").append(row);
    }
  }
  function renderQuotas(state) {
    $("quotaGrid").replaceChildren();
    R.BANDS.forEach((band, i) => {
      const card = document.createElement("article");
      card.className = "quota-card" + (state.counts[i] === state.limits[i] ? " complete" : ""); card.dataset.band = i;
      const title = document.createElement("div"); title.className = "quota-title";
      const titleText = document.createElement("span"); titleText.textContent = band.label;
      const pct = document.createElement("span"); pct.textContent = band.percent + "%"; title.append(titleText, pct);
      const count = document.createElement("div"); count.className = "quota-count";
      const strong = document.createElement("strong"); strong.textContent = state.counts[i]; count.append(strong, " / " + state.limits[i] + " 人");
      const bottom = document.createElement("div"); bottom.className = "quota-bottom";
      const left = state.limits[i] - state.counts[i]; bottom.textContent = left ? "还可分配 " + left + " 人" : "名额已分配完成 ✓";
      card.append(title, count, bottom); $("quotaGrid").append(card);
    });
  }
  function filterStudents() {
    const query = $("studentSearch").value.trim().toLowerCase(); let visible = 0;
    for (const s of students) {
      const show = (!query || s.name.toLowerCase().includes(query) || String(s.order).includes(query))
        && (!$("onlyUnrated").checked || !Object.hasOwn(scores, s.id));
      rowElements.get(s.id).row.classList.toggle("hidden", !show); if (show) visible++;
    }
    $("emptySearch").classList.toggle("hidden", visible > 0);
  }
  function update() {
    const state = R.validate(scores, students); renderQuotas(state);
    $("progressText").textContent = `已评 ${state.filled} / ${students.length} 人`;
    $("progressFill").style.width = state.filled / students.length * 100 + "%";
    $("reviewButton").disabled = !state.ok;
    $("submitStatus").textContent = state.ok ? "67 位同学均已评分，可以检查并提交" : `还有 ${students.length - state.filled} 位同学待评价`;
    $("submitHelp").textContent = state.ok ? "分档人数符合要求，提交前可再次核对。" : "请给所有同学评分，包括自己。";
    for (const s of students) {
      const { row, select } = rowElements.get(s.id); const currentBand = R.bandIndex(scores[s.id]);
      row.classList.toggle("rated", currentBand >= 0);
      for (const option of select.options) {
        if (!option.value) continue;
        const band = R.bandIndex(Number(option.value));
        option.disabled = state.counts[band] >= state.limits[band] && currentBand !== band;
      }
    }
    filterStudents();
  }
  $("identityForm").addEventListener("submit", async event => {
    event.preventDefault(); $("identityError").classList.add("hidden");
    const student = students.find(s => s.id === $("identitySelect").value); if (!student) return;
    $("startButton").disabled = true; $("startButton").textContent = "正在确认…";
    try {
      let status;
      if (demo) {
        const ballot = readStorage(demoBallotsKey, []).find(b => b.rater_id === student.id);
        let accepting = true;
        try { accepting = localStorage.getItem(demoBallotsKey + ".closed") !== "1"; } catch (_) {}
        status = { accepting, roster_version: roster.version, round_id: localStorage.getItem(demoBallotsKey + ".round") || "initial", submitted: !!ballot, ...ballot };
      } else {
        status = await API.identity(student.id);
      }
      if (status.roster_version !== roster.version) throw new Error("名单版本不一致，请刷新页面；仍不一致时请联系老师。");
      if (!demo && JSON.stringify(status.quotas) !== JSON.stringify(R.quotas(students.length))) throw new Error("评分规则与后台不一致，请联系老师。");
      me = student;
      selectRound(status.round_id);
      if (!status.accepting) throw new Error("本次互评已暂停提交，请联系老师。");
      const draft = readStorage(draftKey(), {}); scores = {};
      for (const s of students) if (R.bandIndex(draft[s.id]) >= 0) scores[s.id] = draft[s.id];
      if (R.validate(scores, students).counts.some((v, i) => v > R.quotas(students.length)[i])) scores = {};
      $("currentName").textContent = me.name;
      $("studentSearch").value = ""; $("onlyUnrated").checked = false;
      renderStudents(); update();
      $("identitySection").classList.add("hidden"); $("successSection").classList.add("hidden"); $("scoringSection").classList.remove("hidden");
      if (status.submitted) toast("你已经提交过，可以继续修改；再次提交后以最新评分为准。");
      else if (Object.keys(scores).length) toast("已恢复你在这台设备上保存的评分草稿。");
    } catch (error) { showError("identityError", error); }
    finally { $("startButton").disabled = !demo && !API.ready; $("startButton").textContent = "开始评价 →"; }
  });
  $("studentSearch").addEventListener("input", filterStudents);
  $("onlyUnrated").addEventListener("change", filterStudents);
  $("switchButton").addEventListener("click", resetSections); $("doneSwitch").addEventListener("click", resetSections);
  $("doneEdit").addEventListener("click", () => $("identityForm").requestSubmit());
  $("clearButton").addEventListener("click", () => {
    if (!confirm("清空当前身份的全部评分草稿？")) return;
    scores = {}; for (const { select } of rowElements.values()) select.value = ""; saveDraft(); update();
  });
  $("reviewButton").addEventListener("click", () => {
    if (!R.validate(scores, students).ok) return;
    $("reviewSummary").textContent = `${me.name}，你已评价全班 ${students.length} 人（包含自己）。分档如下：`;
    $("reviewBreakdown").replaceChildren();
    R.BANDS.forEach((band, i) => {
      const group = document.createElement("section"); group.className = "review-group";
      const title = document.createElement("h3"); title.textContent = band.label + " · " + R.quotas(students.length)[i] + " 人";
      const text = document.createElement("p"); text.textContent = students.filter(s => R.bandIndex(scores[s.id]) === i).map(s => `${s.name} ${scores[s.id]}分${s.id === me.id ? "（自己）" : ""}`).join("　");
      group.append(title, text); $("reviewBreakdown").append(group);
    });
    $("submitError").classList.add("hidden"); $("reviewDialog").showModal();
  });
  $("cancelReview").addEventListener("click", () => $("reviewDialog").close());
  $("reviewDialog").addEventListener("cancel", event => { if (submitting) event.preventDefault(); });
  $("confirmSubmit").addEventListener("click", async () => {
    if (submitting || !R.validate(scores, students).ok) return;
    submitting = true; $("confirmSubmit").disabled = true; $("cancelReview").disabled = true;
    $("confirmSubmit").textContent = "正在提交…"; $("submitError").classList.add("hidden");
    try {
      let result;
      if (demo) {
        if ((localStorage.getItem(demoBallotsKey + ".round") || "initial") !== roundId) {
          const error = new Error("老师已清空上一轮评分，请返回重新开始评价"); error.code = "REVIEW_ROUND_CHANGED"; throw error;
        }
        const ballots = readStorage(demoBallotsKey, []); const existing = ballots.find(b => b.rater_id === me.id);
        result = { rater_id: me.id, scores: { ...scores }, submitted_at: new Date().toISOString(), receipt: "DEMO-" + Date.now().toString(36) };
        const updated = existing ? ballots.map(b => b.rater_id === me.id ? result : b) : [...ballots, result];
        localStorage.setItem(demoBallotsKey, JSON.stringify(updated));
      } else result = await API.submit(me.id, roster.version, scores, roundId);
      $("reviewDialog").close(); success(result);
    } catch (error) {
      if (error.code === "REVIEW_ROUND_CHANGED") {
        try { localStorage.removeItem(draftKey()); } catch (_) {}
        $("reviewDialog").close(); resetSections(); showError("identityError", error);
      } else showError("submitError", error);
    }
    finally { submitting = false; $("confirmSubmit").disabled = false; $("cancelReview").disabled = false; $("confirmSubmit").textContent = "确认提交"; }
  });
  window.addEventListener("beforeunload", event => {
    if (submitting || (!saveAvailable && Object.keys(scores).length)) { event.preventDefault(); event.returnValue = ""; }
  });
  $("classCount").textContent = students.length; $("courseTitle").textContent = window.REVIEW_CONFIG.courseTitle;
  for (const s of students) { const option = document.createElement("option"); option.value = s.id; option.textContent = `${String(s.order).padStart(2, "0")}　${s.name}`; $("identitySelect").append(option); }
  if (demo) {
    $("modeNotice").textContent = "本机体验：数据只在当前浏览器中保存，不计入正式评价。"; $("modeNotice").classList.remove("hidden");
    document.querySelectorAll('a[href="admin.html"]').forEach(a => a.href = "admin.html?demo=1");
  } else if (!API.ready) {
    $("setupHint").classList.remove("hidden"); $("startButton").disabled = true;
  }
})();
