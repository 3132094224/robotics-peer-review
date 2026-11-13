(function (root) {
  "use strict";
  const BANDS = Object.freeze([
    { id: "excellent", label: "90–100 分", min: 90, max: 100, percent: 20 },
    { id: "good", label: "80–89 分", min: 80, max: 89, percent: 30 },
    { id: "fair", label: "70–79 分", min: 70, max: 79, percent: 30 },
    { id: "pass", label: "60–69 分", min: 60, max: 69, percent: 20 },
  ]);
  function quotas(total) {
    if (!Number.isInteger(total) || total < 1) throw new Error("名单人数必须为正整数");
    const result = BANDS.map(b => Math.floor(total * b.percent / 100));
    const ranking = BANDS.map((b, i) => ({ i, remainder: total * b.percent % 100 }))
      .sort((a, b) => b.remainder - a.remainder || b.i - a.i);
    const remaining = total - result.reduce((a, b) => a + b, 0);
    for (let i = 0; i < remaining; i++) result[ranking[i].i]++;
    return result;
  }
  function bandIndex(score) {
    return typeof score === "number" && Number.isInteger(score)
      ? BANDS.findIndex(b => score >= b.min && score <= b.max) : -1;
  }
  function validate(scores, students) {
    const limits = quotas(students.length);
    const counts = [0, 0, 0, 0];
    const known = new Set(students.map(s => s.id));
    let filled = 0;
    const errors = [];
    if (!scores || typeof scores !== "object" || Array.isArray(scores)) {
      return { ok: false, filled, counts, limits, errors: ["评分格式不正确"] };
    }
    if (Object.keys(scores).some(id => !known.has(id))) errors.push("评分中存在名单外的同学");
    for (const student of students) {
      if (!Object.hasOwn(scores, student.id)) continue;
      const index = bandIndex(scores[student.id]);
      if (index < 0) errors.push(`${student.name}的分数须为 60–100 的整数`);
      else { counts[index]++; filled++; }
    }
    if (filled !== students.length) errors.push(`还需评价 ${students.length - filled} 人（包括自己）`);
    BANDS.forEach((b, i) => {
      if (counts[i] !== limits[i]) errors.push(`${b.label}需要 ${limits[i]} 人，当前 ${counts[i]} 人`);
    });
    return { ok: errors.length === 0, filled, counts, limits, errors };
  }
  // 只纳入完整、合规且评分人不重复的已提交问卷；不把未参与者当作零分。
  function summarize(students, ballots) {
    const rows = new Map(students.map(s => [s.id, { ...s, total: 0, count: 0, average: null, submitted: false }]));
    const seen = new Set();
    for (const ballot of ballots) {
      if (!rows.has(ballot.rater_id) || seen.has(ballot.rater_id) || !validate(ballot.scores, students).ok) {
        throw new Error("收到重复或不完整的问卷，请检查数据来源");
      }
      seen.add(ballot.rater_id);
      rows.get(ballot.rater_id).submitted = true;
      for (const s of students) {
        const row = rows.get(s.id);
        row.total += ballot.scores[s.id];
        row.count++;
      }
    }
    return [...rows.values()].map(row => ({ ...row, average: row.count ? row.total / row.count : null }));
  }
  function csv(headers, rows) {
    const escape = value => {
      let s = value == null ? "" : String(value);
      if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "\uFEFF" + [headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n");
  }
  const api = { BANDS, quotas, bandIndex, validate, summarize, csv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ReviewRules = api;
})(typeof window === "undefined" ? globalThis : window);
