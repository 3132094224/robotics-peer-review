# 智能机器人导航与控制 · 全班互评

与参考网站相同的结构：GitHub Pages 托管纯 HTML/CSS/JavaScript，Supabase 提供数据库、老师登录和接口。前端没有框架、在线字体或外部 SDK 依赖。

## 已配置的规则

- 点名册 67 人，评价对象包括自己，每人给全班所有人评分。
- 分数是 60–100 的整数。
- 90–100 分 13 人、80–89 分 20 人、70–79 分 20 人、60–69 分 14 人。
- 比例为 20% / 30% / 30% / 20%，按最大余数法取整，余数相同优先较低分档。因为 67 不能被 10 整除，实际整数人数对应的比例只能近似。
- 必须完整评价、满足四档人数才能提交。可以不限次数重新进入、修改并提交，同一姓名最后一次完整提交覆盖之前的评分，不重复计票。
- 学生只需选择自己的姓名即可开始，不需要评价码或注册。系统按所选姓名记录，需由同学自行确保选择本人姓名。
- 前端和数据库均校验名单、分数范围、整数性及配额。直接绕过页面调用接口同样必须满足规则。

## 你要看的结果

打开 `admin.html`，登录老师账号，可以查看：

1. **平均分汇总**：序号、姓名、平均分、评分总和、实际收到份数、本人是否提交。
2. **未提交名单**：明确列出尚未提交的同学。
3. 按平均分排序、按姓名搜索、导出汇总与未提交名单 CSV。
4. 暂停/重新开放提交。暂停不影响已收集的数据。

公式为 `某同学的平均分 = 实际收到的评分总和 / 实际收到的评分份数`。

例如只有 50 人提交：每位同学收到 50 个分数，除以 50，不除以 67。自评分纳入平均分。未参与者不计为零，也不从被评价名单中删除。零份评分显示“暂无评分”。后台按原始总和和份数计算，页面显示两位小数。

## 文件结构

```text
index.html               同学填写页
admin.html               老师后台
assets/config.js         你自己的 Supabase 公开配置
assets/data.js           67 人公开名单（仅序号、姓名、内部编号）
assets/rules.js           分档、配额、统计和 CSV 算法
assets/api.js             调用 Supabase 接口
assets/app.js             同学填写与草稿恢复
assets/admin.js           后台统计与导出
assets/style.css          手机/电脑样式
database/01-schema.sql    数据表、权限、接口和数据库校验
tests/rules.test.cjs      算法测试
tools/preview.cjs         可选的本机预览工具
.nojekyll                 GitHub Pages 按静态文件发布
```

教师资料目录在这个仓库文件夹外面，**不要上传整个上级目录**。老师密码、原始点名册和初始化名单 SQL 均只供老师保存。历史评价码文件已停用，无需发放。

## 第一步：准备自己的 Supabase

1. 在 [Supabase](https://supabase.com/dashboard) 创建一个新项目。不要填参考网站的配置或连接别人的数据库。
2. 在 SQL Editor 执行本仓库的 `database/01-schema.sql`。
3. 在 SQL Editor 执行本机教师资料中的 `02-导入名单与管理员.sql`。该脚本默认将 `3132094224@qq.com` 设为老师邮箱；使用其他邮箱时，在执行前改掉脚本末尾的邮箱。
4. 在 Authentication → Users 中创建该邮箱的账号，自设密码并确认邮箱。普通同学不需要注册 Supabase 账号。
5. 在项目设置中找到 Project URL 和 publishable key（旧版项目也可以使用 anon public key），填入 `assets/config.js`：

```js
window.REVIEW_CONFIG = {
  supabaseUrl: "https://你的项目编号.supabase.co",
  supabaseKey: "你的 publishable key 或旧版 anon public key",
  courseTitle: "智能机器人导航与控制",
  activityTitle: "课程全班互评",
};
```

**不能放入** service_role key、sb_secret 开头的密钥、数据库密码或老师登录密码。前端配置中的公开 key 不负责保密，权限由数据库函数和 RLS 控制。只有已经登录且邮箱在老师白名单中的账号可以查看结果；匿名用户不能直接读取评分表。

数据库结构脚本只需在新项目执行一次。初始化名单脚本也只执行一次，有重复导入保护。已经收集评分后，不要重新生成或替换名单。

## 第二步：在你的 GitHub 账号创建仓库

1. 登录 GitHub，打开 [新建仓库](https://github.com/new)。
2. Repository name 填 `robotics-peer-review`，Visibility 选 Public，点击 Create repository。
3. 点击 uploading an existing file。将**本文件夹里的文件与 assets、database 等子文件夹**拖入页面，确保 `index.html` 在仓库最外层，不要再套一层 `class-review/`。
4. 保留目录结构，点击 Commit changes。
5. 打开 Settings → Pages，Source 选 Deploy from a branch，Branch 选 main，目录选 /(root)，保存。
6. 等待发布成功，地址为 `https://你的用户名.github.io/robotics-peer-review/`。如果当前用户名仍为 `3132094224`，则预计地址为 `https://3132094224.github.io/robotics-peer-review/`；以 Pages 实际显示为准。

同学入口为上述地址，老师入口在后面加 `admin.html`。不要把带 `?demo=1` 的体验链接发成正式问卷。

## 第三步：将学生链接发到群里

学生打开网址后，选择自己的姓名，点击“开始评价”。可以中途退出，再次进入后恢复当前浏览器里的草稿；提交成功后也可以继续修改。

同一姓名可提交不限次数。每次必须提交完整、合规的评分表；最新提交覆盖旧表，不会增加参与人数或评分权重。换设备时，服务器不会向匿名访问者返回之前的具体分数，需要重新填写。

## 上线前的检查

- 选择一名同学确认能进入填写页，不需要评价码，名单共 67 人，能给自己打分。
- 后台开始时显示 0 人提交、67 人未提交、平均分暂无评分。
- 正式使用时，用该同学真实准备提交的分数完成第一份问卷。完整问卷成功后，后台应显示 1 人提交、66 人未提交，每人收到 1 份评分。不要提交随意填写的测试分数到正式数据库。
- 在实际使用的校园网和手机移动网络上分别检查页面加载、确认身份、提交和老师登录；GitHub Pages 与 Supabase 是两条独立网络链路，不保证所有国内网络都可达。

## 本机体验（无需 Supabase）

已安装 Node.js 的电脑，在本目录运行：

```text
node tools/preview.cjs
```

打开 `http://127.0.0.1:8765/?demo=1` 即可体验；后台为 `http://127.0.0.1:8765/admin.html?demo=1`。体验数据只保存在此浏览器，不会自动转移到正式数据库。没有配置后端时，普通入口会明确提示尚未连接服务，不会伪装成已经云端保存。

算法测试：`node --test tests/*.test.cjs`。网站线上运行不需要 Node.js、npm 或安装依赖。

## 常见操作

- **没填完或中途退出**：当前浏览器自动保存草稿，再次选同一姓名可恢复。
- **名额满了想换人**：先将该分档一人的分数改为“选择分数”，释放名额，再调整其他人。
- **提交时网络超时**：不要清空草稿，重试即可。后台只保留同一姓名最后一次完整提交，不会重复累计。
- **后台数据更新**：点击“刷新数据”；统计以该次请求的数据库快照为准。
- **截止时间到了**：后台点“暂停收集”，确认后停止新提交。
- **忘记老师密码**：在自己的 Supabase 控制台管理对应用户。网页不保存老师密码。
- **要修改已交评分**：同学再次选择自己的姓名进入，修改后重新提交即可；后台平均分随最新提交更新，已参与人数不增加。

本项目依据需求独立编写，实现参考网站的架构，未复制参考仓库的页面或脚本。

技术参考：[GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Supabase 数据库函数](https://supabase.com/docs/guides/database/functions)、[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。
