/**
 * 生成 index.json：从 plugins.txt 读取 npm 包与 GitHub 仓库，按插件市场格式 1 输出。
 *
 * 规则与 dsh 官方参考生成器一致的部分：只收录声明了 dsh.bundle.patch 且未弃用的版本；
 * engines.dsh 取 manifest 的 engines.dsh，否则取 @deepseek-ai/dsh* peer 范围的合取；
 * 展示字段取自所收录版本。不同之处：每个插件只保留 dist-tags.latest 指向的版本，
 * 且 Git 源仅支持 github.com 的仓库根包。
 *
 * 用法：
 *   node scripts/generate.mjs           # 写入 index.json（内容未变则不动文件）
 *   node scripts/generate.mjs --check   # 不写文件，与现有 index.json 不一致时退出码 1
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INDEX_FILE = join(ROOT, 'index.json')
const PLUGINS_FILE = join(ROOT, 'plugins.yaml')
const OVERRIDES_FILE = join(ROOT, 'overrides.json')
const MARKET_FILE = join(ROOT, 'market.json')
const REGISTRY = (process.env.NPM_REGISTRY ?? 'https://registry.npmjs.org/').replace(/\/?$/u, '/')
const INDEX_URL = process.env.INDEX_URL ?? 'https://smk-h.github.io/dsh-plugins-index/index.json'
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
const CHECK = process.argv.includes('--check')
const TIMEOUT_MS = 30_000
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u

function warn(message) {
  console.error(`warning: ${message}`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'dsh-plugins-index', accept: 'application/json', ...headers },
  })
  if (!response.ok) {
    const limited = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
    throw new Error(`${url} → HTTP ${response.status}${limited ? '（GitHub API 限额用尽，设置 GITHUB_TOKEN 可提高额度）' : ''}`)
  }
  return response.json()
}

/** 一份 manifest 是否声明了可用的 dsh.bundle.patch。 */
function declaresBundle(manifest) {
  const patch = manifest?.dsh?.bundle?.patch
  if (typeof patch === 'string') return patch.trim() !== ''
  return Array.isArray(patch) && patch.length > 0 && patch.every(entry => typeof entry === 'string' && entry.trim() !== '')
}

/** engines.dsh：优先 manifest 声明，否则合取所有 @deepseek-ai/dsh* peer 范围。 */
function enginesOf(manifest) {
  const declared = manifest?.engines?.dsh
  if (typeof declared === 'string' && declared.trim() !== '') return declared.trim()
  const ranges = new Set()
  for (const [name, range] of Object.entries(manifest?.peerDependencies ?? {})) {
    if (name !== '@deepseek-ai/dsh' && !name.startsWith('@deepseek-ai/dsh-')) continue
    const value = String(range).trim()
    if (value.startsWith('workspace:') || value === '*') continue
    ranges.add(value)
  }
  return ranges.size === 0 ? undefined : [...ranges].join(' ')
}

/** 把 manifest 的 author 归一成显示名，去掉联系方式。 */
function authorName(author) {
  if (typeof author === 'string') {
    const name = author.replace(/\s*<[^>]*>/u, '').replace(/\s*\([^)]*\)/u, '').trim()
    return name === '' ? undefined : name
  }
  if (typeof author?.name === 'string' && author.name.trim() !== '') return author.name.trim()
  return undefined
}

/** 仓库地址归一：去 git+ 前缀、.git 后缀、凭据、查询与片段，只保留 http(s) 网页。 */
function repositoryUrl(value) {
  const raw = typeof value === 'string' ? value : value?.url
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  let url = raw.trim().replace(/^git\+/u, '').replace(/#.*$/u, '').replace(/\.git$/u, '')
  const shorthand = /^github:([^/]+)\/([^/]+)$/u.exec(url)
  if (shorthand !== null) url = `https://github.com/${shorthand[1]}/${shorthand[2]}`
  const scp = /^git@([^:]+):(.+)$/u.exec(url)
  if (scp !== null) url = `https://${scp[1]}/${scp[2]}`
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  return parsed.href.replace(/\/$/u, '')
}

function httpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/** 展示字段来源：overrides 优先，否则取 manifest；空值不写。 */
function displayFields(manifest, overrides) {
  const fields = {}
  const title = overrides.title
  if (title !== undefined) fields.title = title
  if (overrides.icon !== undefined) {
    if (existsSync(join(ROOT, overrides.icon))) fields.icon = overrides.icon
    else warn(`${manifest.name}: 图标 ${overrides.icon} 不存在，已省略`)
  }
  const description = overrides.description ?? manifest.description
  if (description !== undefined && description !== null && String(description).trim() !== '') fields.description = description
  const author = overrides.author ?? authorName(manifest.author)
  if (author !== undefined) fields.author = author
  const homepage = httpUrl(overrides.homepage ?? manifest.homepage)
  if (homepage !== undefined) fields.homepage = homepage
  const repository = repositoryUrl(overrides.repository ?? manifest.repository)
  if (repository !== undefined) {
    const directory = typeof overrides.repository === 'object' ? overrides.repository?.directory : undefined
    fields.repository = directory === undefined ? { url: repository } : { url: repository, directory }
  }
  const keywords = Array.isArray(overrides.keywords)
    ? overrides.keywords.filter(word => typeof word === 'string')
    : Array.isArray(manifest.keywords) ? manifest.keywords.filter(word => typeof word === 'string') : []
  if (keywords.length > 0) fields.metadata = { keywords }
  return fields
}

function versionEntry(version, publishTimestamp, source, engines) {
  return {
    version,
    publishTimestamp,
    source,
    ...engines === undefined ? {} : { engines: { dsh: engines } },
  }
}

/** 组装一个插件对象；字段顺序固定，便于 diff。 */
function pluginObject(name, fields, versions, distTags) {
  return {
    name,
    ...fields.title === undefined ? {} : { title: fields.title },
    ...fields.icon === undefined ? {} : { icon: fields.icon },
    ...fields.description === undefined ? {} : { description: fields.description },
    ...fields.author === undefined ? {} : { author: fields.author },
    ...fields.homepage === undefined ? {} : { homepage: fields.homepage },
    ...fields.repository === undefined ? {} : { repository: fields.repository },
    ...fields.metadata === undefined ? {} : { metadata: fields.metadata },
    ...distTags === undefined ? {} : { 'dist-tags': distTags },
    versions,
  }
}

/** 选出版本：优先 dist-tags.latest，其次最高稳定版，最后最高版本。 */
function pickVersion(eligible, tags, name) {
  const latest = tags.latest
  if (typeof latest === 'string' && eligible.includes(latest)) return latest
  const stable = eligible.filter(version => semver.prerelease(version) === null).sort(semver.rcompare)
  if (stable.length > 0) {
    warn(`${name}: dist-tags.latest 不可用，改用最高稳定版 ${stable[0]}`)
    return stable[0]
  }
  const highest = [...eligible].sort(semver.rcompare)[0]
  warn(`${name}: dist-tags.latest 不可用，改用最高版本 ${highest}`)
  return highest
}

async function npmPlugin(name, overrides) {
  if (!PACKAGE_NAME.test(name)) throw new Error(`${name} 不是合法的 npm 包名`)
  const doc = await getJson(REGISTRY + name.replace('/', '%2f'))
  const tags = doc['dist-tags'] ?? {}
  const eligible = Object.keys(doc.versions).filter(version =>
    semver.valid(version) !== null && declaresBundle(doc.versions[version]) && doc.versions[version].deprecated === undefined)
  if (eligible.length === 0) throw new Error(`${name}: 没有声明 dsh.bundle 且未弃用的版本`)
  const version = pickVersion(eligible, tags, name)
  const manifest = doc.versions[version]
  const engines = enginesOf(manifest)
  if (engines !== undefined && semver.validRange(engines) === null) throw new Error(`${name}@${version}: engines.dsh ${JSON.stringify(engines)} 不是有效的 SemVer 范围`)
  const timestamp = Date.parse(doc.time[version])
  if (Number.isNaN(timestamp)) throw new Error(`${name}@${version}: registry 没有该版本的发布时间`)
  const keptTags = Object.fromEntries(Object.entries(tags).filter(([, target]) => target === version))
  return pluginObject(
    name,
    displayFields(manifest, overrides),
    [versionEntry(version, Math.floor(timestamp / 1000), { type: 'npm' }, engines)],
    Object.keys(keptTags).length === 0 ? undefined : keptTags,
  )
}

async function gitPlugin(url, overrides) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${url} 不是合法的 URL`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`${url} 必须是 https 仓库地址`)
  if (parsed.hostname !== 'github.com') throw new Error(`${url}: 目前只支持 github.com 的 Git 源`)
  const [owner, repo] = parsed.pathname.replace(/^\/+|\/+$/gu, '').split('/')
  if (owner === undefined || repo === undefined) throw new Error(`${url}: 需要 owner/repo 两段路径`)
  const api = `https://api.github.com/repos/${owner}/${repo.replace(/\.git$/u, '')}`
  const headers = GITHUB_TOKEN === undefined ? {} : { authorization: `Bearer ${GITHUB_TOKEN}` }
  const commits = await getJson(`${api}/commits?per_page=1`, headers)
  const head = commits[0]
  if (head === undefined) throw new Error(`${url}: 仓库没有提交`)
  const commit = head.sha

  const readManifest = async (directory) => {
    const manifestPath = directory === undefined ? 'package.json' : `${String(directory).replace(/^\/+|\/+$/gu, '')}/package.json`
    const contents = await getJson(`${api}/contents/${manifestPath}?ref=${commit}`, headers)
    if (typeof contents.content !== 'string') throw new Error(`${url}: ${manifestPath} 不是文件`)
    return JSON.parse(Buffer.from(contents.content, 'base64').toString('utf8'))
  }

  let manifest = await readManifest()
  let name = manifest.name
  if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`${url}: package.json 的 name 无效`)
  const overridesFromUrl = overrides[url] ?? {}
  const overridesFromName = overrides[name] ?? {}
  const settings = { ...overridesFromUrl, ...overridesFromName, path: overridesFromUrl.path ?? overridesFromName.path }
  const subdirectory = settings.path
  if (subdirectory !== undefined) {
    manifest = await readManifest(subdirectory)
    name = manifest.name
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) throw new Error(`${url}: ${subdirectory}/package.json 的 name 无效`)
  }
  if (manifest.private === true && settings.allowPrivate !== true) {
    throw new Error(`${url}: package.json 带 "private": true，若确认要收录请在 overrides.json 里为该包设置 "allowPrivate": true`)
  }
  if (!declaresBundle(manifest)) throw new Error(`${url}: package.json 没有声明 dsh.bundle.patch`)
  const version = manifest.version
  if (typeof version !== 'string' || semver.valid(version) === null) throw new Error(`${url}: package.json 的 version ${JSON.stringify(version)} 不是精确 SemVer`)
  const engines = enginesOf(manifest)
  if (engines !== undefined && semver.validRange(engines) === null) throw new Error(`${url}: engines.dsh ${JSON.stringify(engines)} 不是有效的 SemVer 范围`)
  const timestamp = Math.floor(Date.parse(head.commit.committer.date) / 1000)
  return pluginObject(
    name,
    displayFields(manifest, settings),
    [versionEntry(version, timestamp, {
      type: 'git',
      url: `https://github.com/${owner}/${repo.replace(/\.git$/u, '')}`,
      commit,
      ...subdirectory === undefined ? {} : { path: String(subdirectory).replace(/^\/+|\/+$/gu, '') },
    }, engines)],
    undefined,
  )
}

/** github 组里的条目：owner/repo 简写或完整 URL。 */
function githubUrl(value) {
  const line = value.trim()
  if (line.includes('://')) return line
  const shorthand = /^([\w.-]+)\/([\w.-]+)$/u.exec(line)
  if (shorthand === null) throw new Error(`${JSON.stringify(line)} 既不是 owner/repo 简写，也不是 https URL`)
  return `https://github.com/${shorthand[1]}/${shorthand[2]}`
}

/** 读取一个分组的条目列表：允许单个字符串或字符串数组，忽略空值。 */
function groupEntries(value, key) {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') throw new Error(`${key} 的第 ${index + 1} 项必须是非空字符串`)
    return entry.trim()
  })
}

/**
 * 解析 plugins.yaml。两种写法等价：
 *
 *   npm: ['@scope/pkg', 'pkg']      # 分组映射，npm 在前、github 在后
 *   github: [owner/repo]
 *
 *   - npm: '@scope/pkg'             # 有序列表，可交错，顺序即索引顺序
 *   - github: owner/repo
 */
function parseSources(text) {
  let document
  try {
    document = parseYaml(text)
  } catch (error) {
    throw new Error(`YAML 解析失败：${error.message}`)
  }
  const sources = []
  const addNpm = (name) => { sources.push({ kind: 'npm', line: name }) }
  const addGithub = (value) => { sources.push({ kind: 'git', line: githubUrl(value) }) }

  if (document === null || document === undefined) return sources

  if (Array.isArray(document)) {
    for (const entry of document) {
      if (typeof entry === 'string') {
        entry.includes('://') ? addGithub(entry) : addNpm(entry.trim())
        continue
      }
      if (typeof entry !== 'object' || entry === null) throw new Error('列表项必须是字符串或 npm/github 映射')
      const npm = groupEntries(entry.npm, 'npm')
      const github = groupEntries(entry.github ?? entry.git, 'github')
      if (npm.length + github.length !== 1) throw new Error('每个列表项必须且只能写一个 npm 或 github 键')
      npm.length === 1 ? addNpm(npm[0]) : addGithub(github[0])
    }
    return sources
  }

  if (typeof document !== 'object') throw new Error('plugins.yaml 顶层必须是映射或列表')
  for (const [key, value] of Object.entries(document)) {
    if (key === 'npm') {
      for (const name of groupEntries(value, key)) addNpm(name)
    } else if (key === 'github' || key === 'git') {
      for (const url of groupEntries(value, key)) addGithub(url)
    } else {
      throw new Error(`未知分组 ${key}，只认 npm 与 github（或 git）`)
    }
  }
  return sources
}

async function main() {
  const market = readJson(MARKET_FILE)
  const overrides = existsSync(OVERRIDES_FILE) ? readJson(OVERRIDES_FILE) : {}
  const plugins = []
  const seen = new Set()
  let failed = false

  let sources
  try {
    sources = parseSources(readFileSync(PLUGINS_FILE, 'utf8'))
  } catch (error) {
    console.error(`error: ${error.message}`)
    process.exitCode = 1
    return
  }

  for (const source of sources) {
    try {
      const plugin = source.kind === 'npm'
        ? await npmPlugin(source.line, overrides[source.line] ?? {})
        : await gitPlugin(source.line, overrides)
      if (seen.has(plugin.name)) {
        warn(`${plugin.name}: 重复的插件，保留第一次出现的条目`)
        continue
      }
      seen.add(plugin.name)
      plugins.push(plugin)
      console.log(`${plugin.name} @ ${plugin.versions[0].version} (${source.kind})`)
    } catch (error) {
      console.error(`error: ${source.line}: ${error.message}`)
      failed = true
    }
  }

  if (failed) {
    console.error('有来源读取失败，未写入 index.json')
    process.exitCode = 1
    return
  }
  if (plugins.length === 0) throw new Error('没有生成任何插件')

  const index = {
    format: 1,
    title: market.title,
    ...market.description === undefined ? {} : { description: market.description },
    plugins,
  }
  parseMarketIndex(index, INDEX_URL)

  const text = `${JSON.stringify(index, null, 2)}\n`
  const current = existsSync(INDEX_FILE) ? readFileSync(INDEX_FILE, 'utf8') : undefined

  if (CHECK) {
    if (current === text) {
      console.log('index.json 与源数据一致')
      return
    }
    console.error('index.json 已过期：运行 npm run index 后提交')
    process.exitCode = 1
    return
  }

  if (current === text) {
    console.log('index.json 未变化')
    return
  }
  const temporary = `${INDEX_FILE}.tmp-${process.pid}`
  writeFileSync(temporary, text)
  renameSync(temporary, INDEX_FILE)
  console.log(`已写入 index.json（${plugins.length} 个插件）`)
}

await main()
