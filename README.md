# dsh-plugins-index

DeepSeek Harness（dsh）的自定义插件索引，格式说明见 dsh 仓库的 `docs/user/guide/plugin-market.zh.md`。

## 文件

```text
dsh-plugins-index/
├── index.json         # 生成产物，格式 1
├── icons/             # 图标文件，由 config/index.yaml 以相对路径引用
├── config/
│   └── index.yaml     # 市场头、来源列表、插件覆盖
├── scripts/generate.mjs
├── package.json
└── node_modules/      # 依赖目录，已 gitignore
```

`index.json` 目前列出五个插件：

| 插件 | 来源 | 收录版本 |
|---|---|---|
| `@smai-kit/dsh-smkit` | npm | 1.20.1 |
| `dsh-better-sidebar` | npm | 0.31.1 |
| `dsh-sessions-manager` | npm | 3.7.10 |
| `dsh-context` | npm | 0.83.1 |
| `dsh-mnemon` | npm | 0.5.44 |

每个插件只保留一个版本（即发布时的 `latest`），不收录历史版本与 `beta` / `alpha` 渠道：索引用于“装到当前最新”，回滚或旧版本请直接走 `dsh plugin add <name>@<version>`。

`engines.dsh` 的来源：manifest 声明了 `engines.dsh` 时原样复制，否则取所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 范围的合取；没有这类 peer 的版本省略该字段，语义为任意 dsh 版本。

## 发布

索引必须经 `http:` 或 `https:` 提供，dsh 不接受 `file://`。任选一种静态主机：

```sh
# 本地预览（http://localhost:8080/index.json）
npx serve .
# 或
python -m http.server 8080
```

推到 GitHub Pages、GitLab Pages 或对象存储时，保持 `index.json` 与 `icons/` 同级即可，相对图标会自动基于索引 URL 解析。

## 在 dsh 中使用

1. 打开 **插件** → **实验性插件** → 开启 **自定义插件索引**；
2. 切到 **发现** → **添加索引源**，填入索引文件的 URL（如 `https://<user>.github.io/dsh-plugins-index/index.json`）；
3. 卡片显示推荐版本 = 与当前 dsh 兼容且非预发布的最高版本；确认来源后再安装。

索引读取有 10 分钟缓存，改完想立即生效就点「发现」的刷新。

## 更新索引

```sh
npm install          # 首次或依赖变化后
npm run index        # 按 config/index.yaml 重新生成 index.json
npm run index:check  # 只校验，不一致时退出码 1（给 CI 用）
```

所有输入都在 `config/index.yaml`，分三块：

```yaml
market:
  title:
    en: smkit plugin index
    zh: smkit 插件索引

sources:
  npm:
    - '@smai-kit/dsh-smkit'
    - dsh-mnemon

overrides:
  dsh-better-sidebar:
    title: Better Sidebar
    icon: icons/dsh-better-sidebar.svg
```

- `market`：写进 `index.json` 的根字段，`title` 必填、`description` 可选；
- `sources`：`npm` 与 `github`（`git` 等价）两个键，值可为单个字符串或字符串数组；`github` 条目支持 `owner/repo` 简写，展开成 `https://github.com/owner/repo`；需要 npm 与 github 交错排序时，把 `sources` 改成有序列表：

  ```yaml
  sources:
    - npm: '@smai-kit/dsh-smkit'
    - github: owner/repo
    - npm: dsh-sessions-manager
  ```

- `overrides`：按包名或 Git URL 覆盖单个插件，字段见下表；
- 以 `@` 开头的包名必须加引号，否则 YAML 本身就不合法；未知顶层键、未知分组、非字符串条目都会报错并中止，不写半成品索引。

生成器做的事：

1. 按 `config/index.yaml` 的 `sources` 顺序读取来源：npm 包名走 `https://registry.npmjs.org/<name>`；`https://github.com/...` 走 GitHub API，读默认分支 HEAD 提交与 `package.json`。
2. 只收录声明了 `dsh.bundle.patch`、未弃用、版本号是精确 SemVer 的版本；每个插件只保留 `dist-tags.latest` 指向的那个（不可用时退到最高稳定版，并给出警告）。
3. `publishTimestamp`：npm 取 registry 发布时间，Git 取提交的 committer 时间；`engines.dsh` 取 manifest 声明，否则取 `@deepseek-ai/dsh*` peer 范围的合取；无则省略。
4. `dist-tags` 只保留指向所收录版本的标签；随后用 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 校验，通过才写文件。
5. 写入是原子的，且内容未变时不改动文件；任一来源读取失败都会中止，**不写半成品索引**。

`config/index.yaml` 的 `overrides` 可按键（包名或 Git URL）覆盖展示与策略：

| 字段 | 作用 |
|---|---|
| `title`、`description`、`author`、`homepage`、`repository`、`keywords` | 覆盖 manifest 的展示字段；`description` 支持 `{ "en", "zh" }` 多语言 |
| `icon` | 仓库内的相对路径，如 `icons/foo.svg`，必须是实际存在的文件 |
| `allowPrivate` | Git 源 `package.json` 带 `"private": true` 时必须显式设为 `true` |
| `path` | Git 仓库为 monorepo 时，包在仓库中的目录 |

可选环境变量：`GITHUB_TOKEN`（提高 API 限额、读私有仓库）、`NPM_REGISTRY`（换 registry）、`INDEX_URL`（仅用于校验时解析相对图标，默认 `https://smk-h.github.io/dsh-plugins-index/index.json`）。

CI 里两种用法任选：定时跑 `npm run index` 后把变更提交；或在合并请求里跑 `npm run index:check`，索引过期就让流水线失败。

## 定时流水线

`.cnb/workflows/cnb-crontab.yml` 里配置了每天 **01:00（Asia/Shanghai）** 的刷新任务：

```yaml
main:
  'crontab: 0 1 * * *':
    - name: refresh-plugin-index
      docker:
        image: node:22
      stages:
        - name: regenerate index
          script: |
            npm ci
            npm run index
        - name: commit and push
          script: |
            if git diff --quiet -- index.json; then exit 0; fi
            git add index.json
            git commit -m "chore(index): 每日定时刷新索引"
            git push origin HEAD:main
```

行为与注意点：

- 到点后拉取 `main` 的 HEAD 执行，`index.json` 没有变化就跳过提交，不会产生空提交；
- 有变化才提交并回推；CI 环境的 `origin` 自带 `CNB_TOKEN` 鉴权，不需要额外配密码；
- 回推会触发 `main` 的 push 流水线，也就是现有的「同步到 GitHub」，GitHub Pages 随之更新；
- 定时任务的执行身份是「最后修改本配置并推送的人」，此人被移出仓库会导致任务失败；
- 改完 `cnb-crontab.yml` 要顺带改一下 `.cnb.yml`（哪怕加个空行）再推送，否则平台不会重新解析 include 模板；
- 需要提高 GitHub API 限额时，在仓库环境里提供 `GITHUB_TOKEN`，生成器会自动使用。

## 已知限制

- 每个插件只列一个版本，无法从「发现」安装历史版本；需要旧版就用 `dsh plugin add <name>@<version>`。
- 索引不支持升级：新版本只显示为「有新版本」，仍需卸载后再装。
- 生成器跑之前索引不会变；Git 源固定在默认分支 HEAD，不上标签、不读历史提交。
- Git 源只支持 `github.com`，且默认只读仓库根 `package.json`（monorepo 用 `config/index.yaml` 里 `overrides.<包名>.path`）；未认证的 GitHub API 限额为 60 次/小时，一个 Git 源约 2~3 次请求，CI 里建议配 `GITHUB_TOKEN`。
- 不读取包的 locale 文件，也不从 tarball 抽图标：标题、图标这类字段靠 `config/index.yaml` 手工维护。
- 索引无签名，`name`/`version`/`engines` 的真实性由发布方声明。
