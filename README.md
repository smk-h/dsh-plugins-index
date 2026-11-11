# dsh-plugins-index

DeepSeek Harness（dsh）的自定义插件索引，格式说明见 dsh 仓库的 `docs/user/guide/plugin-market.zh.md`。

## 文件

```text
dsh-plugins-index/
├── index.json   # 索引本体，格式 1
└── icons/       # 可选；图标以相对路径引用时放在这里
```

`index.json` 目前只列一个插件：`@smai-kit/dsh-smkit`，全部为 npm 来源，`engines.dsh` 取自各版本 manifest 的 `@deepseek-ai/dsh` peer 范围（`>=0.1.2-rc.1`）；1.12.0 之前没有该 peer，故省略 `engines`，等价于任意 dsh 版本。

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

1. 在 `versions` 数组**最前面**加一块（顺序不影响安装，但便于阅读）：

   ```json
   {
     "version": "1.21.0",
     "publishTimestamp": 1794300000,
     "source": { "type": "npm" },
     "engines": { "dsh": ">=0.1.2-rc.1" }
   }
   ```

2. 把 `dist-tags.latest` 改成新版本号。

`publishTimestamp` 是 npm 上的发布时间（Unix 秒），用一条命令取：

```sh
npm view @smai-kit/dsh-smkit time --json
```

或直接算：

```sh
node -e "console.log(Math.floor(Date.parse(require('child_process').execSync('npm view @smai-kit/dsh-smkit time.1.21.0 --json').toString().trim())/1000))"
```

漏改 `dist-tags.latest` 不会被拒收，但「最新渠道」会指向旧版本；版本号与 registry 不一致、时间戳写错这类问题校验器查不出来，只能靠生成器或人工核对。

## 改成自动生成

手写适合现在的一个包。要自动化时不必搬 dsh 仓库里的参考生成器（它是 `private` 包），用一个薄脚本即可：读 `plugins.txt` → 取 `https://registry.npmjs.org/<name>` 的 packument（其中保留了 `dsh.bundle`）→ 组 `index.json` → 用 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 预检后写出。

## 已知限制

- 索引不支持升级：新版本只显示为「有新版本」，仍需卸载后再装。
- 索引是静态快照，重新生成前版本列表不会更新。
- 索引无签名，`name`/`version`/`engines` 的真实性由发布方声明。
