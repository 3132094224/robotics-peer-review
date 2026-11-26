(function () {
  "use strict";
  const cfg = window.REVIEW_CONFIG;
  const url = String(cfg.supabaseUrl || "").replace(/\/+$/, "");
  const key = String(cfg.supabaseKey || "");
  const ready = /^https:\/\//.test(url) && !!key;
  let session = null; // 仅在内存保存老师会话，刷新后重新登录。
  function configError() {
    if (!ready) throw new Error("尚未连接评分服务。请先完成配置，或返回首页进入本机体验。");
    if (/^(sb_secret_|service_role)/.test(key)) throw new Error("配置中误用了管理密钥，请立即更换为公开 key");
  }
  async function request(path, { body, token, method = "POST" } = {}) {
    configError();
    const headers = { apikey: key, "Content-Type": "application/json" };
    if (token || key.startsWith("eyJ")) headers.Authorization = "Bearer " + (token || key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401 && token) { session = null; throw new Error("登录已失效，请重新登录"); }
        const error = new Error(data.message || data.error_description || data.msg || `请求失败（${res.status}）`);
        error.code = data.details;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("连接超时。已保留草稿，请检查网络后重试；后台只保留你最后一次完整提交，不重复计票。");
      if (error instanceof TypeError) throw new Error("暂时无法连接评分服务。已保留草稿，请检查网络后重试。");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const rpc = (name, body, token) => request("/rest/v1/rpc/" + name, { body, token });
  async function adminToken() {
    if (!session) throw new Error("请先登录老师账号");
    if (Date.now() >= session.expires_at - 60000) {
      const fresh = await request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: session.refresh_token } });
      session = { ...fresh, expires_at: Date.now() + fresh.expires_in * 1000 };
    }
    return session.access_token;
  }
  window.ReviewAPI = {
    ready,
    identity: id => rpc("review_identity", { p_rater_id: id }),
    saveDraft: (id, version, scores, roundId) => rpc("review_save_draft", {
      p_rater_id: id, p_roster_version: version, p_scores: scores, p_round_id: roundId,
    }),
    submit: (id, version, scores, roundId = "initial") => rpc("review_submit", {
      p_rater_id: id, p_roster_version: version, p_scores: scores, p_round_id: roundId,
    }),
    async signIn(email, password) {
      const data = await request("/auth/v1/token?grant_type=password", { body: { email, password } });
      session = { ...data, expires_at: Date.now() + data.expires_in * 1000 };
    },
    async signOut() {
      const token = session?.access_token;
      session = null;
      if (token) await request("/auth/v1/logout", { token });
    },
    async dashboard() { return rpc("review_dashboard", {}, await adminToken()); },
    async setAccepting(value) { return rpc("review_set_accepting", { p_accepting: value }, await adminToken()); },
    async reset(roundId) { return rpc("review_reset", { p_confirm: true, p_expected_round_id: roundId }, await adminToken()); },
  };
})();
