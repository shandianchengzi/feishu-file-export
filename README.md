# 飞书多维表格附件批量导出

一个纯前端的飞书多维表格边栏插件：选择附件列和记录，使用同一行的指定单元格内容命名附件，并按另一列的内容分类到文件夹，最终下载 ZIP。

## 当前状态

- 功能、锁定版本的依赖、测试和构建工作流已准备。
- 本地及 GitHub Actions 的 13 项测试、TypeScript 检查、生产构建均通过，编译产物已上传。
- **尚未在真实飞书表格中完成下载验收，尚未宣布线上可用。** SDK 授权、租户策略、附件下载权限、临时链接 CORS 和用户网络可达性需要真实环境验收。
- 仓库已由所有者设置为 public，使用免费的标准 GitHub-hosted runner。私有分支条件仅为未来复用保留：私有仓库默认不启动 runner，除非所有者自行设置 `ALLOW_PRIVATE_ACTIONS=true`。
- 默认发布到本仓库的项目 Pages，无需设置 `PAGES_MODE` 或任何跨仓库凭据。首次部署停在 `actions/configure-pages`，原因是仓库尚未启用 Pages。请在 [Settings → Pages](https://github.com/shandianchengzi/feishu-file-export/settings/pages) 的 Build and deployment → Source 选择 **GitHub Actions**，然后重新运行失败的部署任务。
- [已完成编译的 Actions 记录](https://github.com/shandianchengzi/feishu-file-export/actions/runs/34690208464)：`build` 成功，`deploy-project-pages` 等待完成上述一次性设置后重跑。

## 功能

1. 选择数据表与视图，读取当前视图、整张表或交互式选择的记录。当前视图模式遵循该视图的筛选，使用分页 API，不限于前 200 条。
2. 勾选一个或多个附件列。选择记录与附件列的交集即确定需要读取的附件单元格，预览后还能逐个勾选附件。
3. 选择命名列，支持“单元格内容 + 原扩展名”或“单元格内容 + 原文件名”。命名来源是附件所在行的单元格。
4. 选择分类列，每一种显示文本对应一个文件夹。多选字段的完整显示文本视作一个分类，不将文件复制到多个目录。
5. 预览最终路径并打包。保留中文、保留扩展名，自动处理同一单元格多个附件、跨行重名、Windows 保留名称、非法路径字符及分类名称清理后的碰撞。
6. 默认每包附件上限 128 MiB，可选 32–512 MiB；每包是独立 ZIP。生成一包后点击保存，再处理下一包，避免浏览器拦截连续自动下载。
7. 每个文件下载前使用其 token、fieldId、recordId 获取新的短期 URL；自动重试两次。每包都有 `_导出清单.json`，区分成功与失败，不把失败附件伪装成空文件，不在清单记录 token 或短期链接。
8. 支持取消。SDK 请求及 ZIP 生成本身无法中途强制终止时，会在当前操作返回后丢弃其结果；已经保存的包不受影响。

例如，命名列为“姓名”，分类列为“学院”，同一行有两个 txt 附件时，导出为 `计算机学院/张三.txt` 和 `计算机学院/张三 (2).txt`。空名称保留原文件名，空分类进入“未分类”。

## 为什么静态托管能够运行

GitHub Pages 托管 HTML、CSS 和 JavaScript，JavaScript 在用户浏览器中执行。飞书将页面作为边栏插件载入，官方 `@lark-base-open/js-sdk` 与宿主通信，读取当前用户有权访问的表格和附件地址；浏览器获取附件后用 JSZip 打包。服务器端不需要 Node 服务、数据库、飞书 App Secret 或付费中转。

源码及网页资源可以放在 GitHub；飞书表格数据和附件不会上传到 GitHub。SDK 自身的宿主通信仍由飞书管理。

附件 URL 来自官方接口并由飞书鉴权。实现使用浏览器 `fetch` 获取短期 URL，是否允许跨域读取仍须真实飞书环境验证；如果网络或租户策略阻止读取，插件会显示失败并保留清单，不使用公共代理绕过。

## 开发与验证

需要 Node.js 24。依赖由 `package-lock.json` 固定，运行：

```bash
npm ci
npm test
npm run build
npm run dev
```

`npm run build` 包含 TypeScript 检查与 Vite 生产构建，输出 `dist/`。`base: './'` 使资源可在子路径使用。构建将依赖一并打包，运行时不依赖 npm CDN。

在普通浏览器中打开页面会显示安装说明。访问 `?demo=1` 可用内置小文件验证预览、分类、重名及 ZIP 下载；示例模式与飞书数据完全分离。真实插件 URL 不应添加 `?demo=1`。

测试覆盖分页超过 200 条、分页异常、命名/分类碰撞、ZIP 字节内容、失败清单、过期链接重试、流式大小上限及取消。

## GitHub Actions 与两种发布方式

`.github/workflows/build.yml` 在 `main` push、PR 和手动触发时运行测试与构建，上传 `feishu-file-export-dist`，保留 3 天。发布只在 `main` 且非 PR 时执行。

### 方式 A：公开新插件仓库，使用项目 Pages（免费且无跨仓库凭据）

此方式不需要修改已有的 `shandianchengzi.github.io` 仓库。项目 Pages 默认地址仍为 `https://shandianchengzi.github.io/feishu-file-export/`。

1. 由仓库所有者确认并将 **这个新插件仓库** 设置为 public。不要为了本插件公开整个已有博客仓库。
2. 在这个仓库的 Settings → Pages 中，将 Source 设为 GitHub Actions。
3. 默认已选择项目 Pages，**无需新增变量或 Secret**。可选设置 `PAGES_MODE=project` 显式指定，`PAGES_MODE=build-only` 可只编译不发布。
4. 运行 Actions → Build and optionally publish → Run workflow，或向 `main` 提交改动。
5. 等待 build 和 deploy-project-pages 均成功，再将 workflow 输出的真实地址填入飞书插件入口。

首次启用 Pages 需要仓库管理权限；工作流自带的 `GITHUB_TOKEN` 不能自动完成此设置。普通部署在启用后使用内置令牌即可，不需要个人访问令牌。依据 [configure-pages 官方说明](https://github.com/actions/configure-pages/blob/main/action.yml)。

GitHub Free 支持公开仓库的 Pages，公开仓库的标准 GitHub-hosted runner 免费。使用普通 `ubuntu-latest`，不使用收费 larger runners。仍应遵守 GitHub 的带宽、站点大小和合理使用限制。

项目 Pages 与用户站点同名子目录可能形成路由冲突，因此两种方式只选择一种；不要同时在旧站点创建同名子目录和启用此项目 Pages。现有用户站点如设置自定义域名，最终 URL 以 Pages 部署输出为准。

### 方式 B：发布到指定的已有用户站点仓库

源码在本仓库，`dist/` 由脚本写入 `shandianchengzi/shandianchengzi.github.io` 的 `master` 分支 `feishu-file-export/` 子目录。2026-09-12 核查时，该站点默认源码分支为 `origin`，已有 Pages 发布记录使用 **master**，不存在 main 分支；不能凭默认分支推断发布分支。

1. 在本仓库 Variables 中设置 `PAGES_MODE=user-site`。
2. 创建一个只授权目标站点仓库的 fine-grained PAT，赋予 Contents 和 Pages 的读写权限，在本仓库 Secret 中保存为 `PAGES_DEPLOY_TOKEN`。不要将 token 放进源码、前端或提交记录。
3. 本仓库保持私有时，须先确认账号的 Actions 免费额度与预算，再自行设置 `ALLOW_PRIVATE_ACTIONS=true`。默认不会启用可能产生费用的私有构建。
4. 运行工作流。`scripts/publish_user_site.py` 会先检查目标 Pages 必须是 `master` 根目录的 branch-based 模式，不符则停止。脚本基于最新目标 tree 更新插件子目录，使用非强制更新，保留博客及其他页面，并显式请求 Pages build。
5. 检查目标仓库的 Pages 构建完成，再访问插件。

此方式需要额外的跨仓库凭据，且私有仓库 Pages 依赖 GitHub Pro/Team 等套餐，**不承诺它在 GitHub Free 下可用**。普通 `GITHUB_TOKEN` 仅对当前仓库授权，不能自动写入另一个仓库。

脚本不删除旧的哈希资源，以保护仍缓存旧 HTML 的客户端。若以后使用会重建并覆盖整个 master 分支的博客发布流程，需要将插件目录纳入该发布流程的保留范围。

## 飞书内安装与验收

1. 确认 HTTPS 页面实际能打开；独立页面应显示安装说明，`?demo=1` 应能下载一个包含四个测试附件的 ZIP。
2. 打开目标多维表格，在边栏插件的自定义／开发插件入口添加真实部署地址。具体入口、是否允许自定义插件及授权要求，以当前飞书界面和官方开发指南为准。个人自用不等同于插件市场上架。
3. 使用有下载权限的账号，先选择一条有小附件的记录，检查原附件可手动下载，再在插件中预览和导出。
4. 验证附件原始字节、扩展名、同一行的命名和分类，以及一个单元格多个附件、重名和空值的情况。
5. 验证一个筛选视图、一组手选记录及超过 200 条的表格；确保清单数量和原表所选范围一致。
6. 最后用实际附件大小测试分包。单个附件不能超过选定的单包上限；浏览器内存需求高于附件总字节数，低内存设备应减小单包大小。

网络到 GitHub Pages 的可达性、飞书租户插件政策、附件权限和跨域响应不由此仓库控制。完成这组验收之前，不应把“构建通过”表述为“真实飞书下载已经验证”。

## 资料

- [用户指定：多维表格边栏插件开发指南](https://feishu.feishu.cn/docx/S1pMdbckEooVlhx53ZMcGGnMnKc)
- [飞书官方 SDK 文档源码：附件字段](https://github.com/lark-base-team/js-sdk-docs/blob/main/docs/zh/api/field/attachment.md)
- [飞书官方 SDK 文档源码：数据表及分页 API](https://github.com/lark-base-team/js-sdk-docs/blob/main/docs/zh/api/table.md)
- [飞书官方 SDK 文档源码：记录选择器](https://github.com/lark-base-team/js-sdk-docs/blob/main/docs/zh/api/ui.md)
- [GitHub Pages 支持的仓库类型和套餐](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Actions 免费额度和计费](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GITHUB_TOKEN 的仓库作用域](https://docs.github.com/en/actions/concepts/security/github_token)

用户提供的飞书 docx 链接在本次检索环境未能直接读取正文；实现依据飞书团队维护的官方 SDK 文档仓库和已安装的 1.0.2 类型定义，没有将未读取的页面表述为已审阅。
