# dsh-plugins-index

DeepSeek Harness（dsh）的自定义插件索引，格式说明见 dsh 仓库的 `docs/user/guide/plugin-market.zh.md`。

## 文件

```text
dsh-plugins-index/
├── index.json   # 索引本体，格式 1
└── icons/       # 可选；图标以相对路径引用时放在这里
```

`index.json` 目前列出四个插件：

| 插件 | 来源 | 收录版本 |
|---|---|---|
| `@smai-kit/dsh-smkit` | npm | 1.20.0 |
| `dsh-better-sidebar` | npm | 0.30.1 |
| `dsh-memory-evolve` | Git 提交 `44b6b3e` | 0.1.0 |
| `dsh-sessions-manager` | npm | 3.7.10 |

每个插件只保留一个版本（即发布时的 `latest`），不收录历史版本与 `beta` / `alpha` 渠道：索引用于“装到当前最新”，回滚或旧版本请直接走 `dsh plugin add <name>@<version>`。

`engines.dsh` 的来源：manifest 声明了 `engines.dsh` 时原样复制，否则取所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` peer 范围的合取；没有这类 peer 的版本省略该字段，语义为任意 dsh 版本。

`dsh-memory-evolve` 只按 Git 提交固定（仓库用的是日期式标签，没有 semver 标签），且其 `package.json` 带 `"private": true` —— 官方参考生成器会跳过这类包，这里是手工索引才保留。

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

## 发新版本时手动改两处

以 npm 来源为例，**替换**而不是追加：

1. 把对应插件 `versions` 里唯一那块改成新版本：

   ```json
   {
     "version": "1.21.0",
     "publishTimestamp": 1794300000,
     "source": { "type": "npm" },
     "engines": { "dsh": ">=0.1.2-rc.1" }
   }
   ```

2. 把该插件的 `dist-tags.latest` 改成同一个版本号（两者必须一致，否则整份索引被拒收）。

`publishTimestamp` 是 npm 上的发布时间（Unix 秒），用一条命令取：

```sh
npm view @smai-kit/dsh-smkit time.1.21.0 --json
```

列出某包的最新版本与时间（对照着改）：

```sh
npm view dsh-better-sidebar version time --json
```

版本号与 registry 不一致、时间戳写错这类问题校验器查不出来，只能靠人工核对。

第三方插件更新时，用同样的方式替换版本即可；不想追更就保持原样，索引是自洽的快照。

## 改成自动生成

手写适合现在这几个包。要自动化时不必搬 dsh 仓库里的参考生成器（它是 `private` 包），用一个薄脚本即可：读 `plugins.txt` → 取 `https://registry.npmjs.org/<name>` 的 packument（其中保留了 `dsh.bundle`）→ 组 `index.json` → 用 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 预检后写出。

## 已知限制

- 每个插件只列一个版本，无法从「发现」安装历史版本；需要旧版就用 `dsh plugin add <name>@<version>`。
- 索引不支持升级：新版本只显示为「有新版本」，仍需卸载后再装。
- 索引是静态快照，重新生成前版本列表不会更新。
- 索引无签名，`name`/`version`/`engines` 的真实性由发布方声明。
