# 逐行详解 ㉓：`context/robot-context.ts`

> 对应源文件：[extensions/openclaw-plugin/src/context/robot-context.ts](../../extensions/openclaw-plugin/src/context/robot-context.ts)
>
> 推荐阅读顺序第 23 个文件，本批最有料的一篇（192 行）。它是另一个钩子——`before_agent_start`（**每次对话开始前**触发）——干一件聪明事：**先问机器人"你现在有哪些话题/服务/动作"，再把这份能力清单塞进 AI 的系统提示里**，让 AI 一开口就知道自己能指挥什么。本篇会综合很多前面学过的东西，并第一次见到几个重要新语法：**`Promise.all` 并行**、**带 TTL 的缓存**、**降级兜底（fallback）**、**空 catch**。

---

## 先理解这篇要解决的问题

AI 默认对你的机器人**一无所知**——它不知道有 `/cmd_vel` 这个话题、不知道能调哪些服务。如果不告诉它，它只能瞎猜话题名。

解决办法：**在每次对话开始前，动态问一次机器人"你有哪些能力"，把结果写成一段说明，塞进 AI 的"系统提示"（system prompt，AI 对话的背景知识）里。** 这样 AI 一上来就掌握了这台机器人的"使用手册"。

但天天问、每次问会慢。所以还要：
- **缓存**：问一次记住，60 秒内不重复问。
- **降级**：万一问失败（没连上等），用一份"硬编码的默认清单"顶上，别让 AI 两眼一抹黑。

这三件事（注入、缓存、降级）就是本篇的全部。

---

## 第 1-4 行：导入

```typescript
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import type { TopicInfo, ServiceInfo, ActionInfo } from "../transport/types.js";
import { getTransport } from "../service.js";
```

- 前三个 `import type`：宿主接口、配置、以及三种能力信息类型 `TopicInfo`/`ServiceInfo`/`ActionInfo`（第③篇定义、第⑩篇 `list*` 方法返回的）。
- `import { getTransport }` —— 值导入，要调用它拿传输。

---

## 第 6-15 行：缓存的数据结构 + 全局缓存变量

```typescript
/** Cached discovery results with TTL. */
interface DiscoveryCache {
  topics: TopicInfo[];
  services: ServiceInfo[];
  actions: ActionInfo[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000; // 60s
let cache: DiscoveryCache | null = null;
```

- `interface DiscoveryCache { ... }` —— 定义"缓存里存什么"（回忆第①篇 interface）：三个能力数组 + 一个 `timestamp`（时间戳）。
  - **`timestamp` 是关键**：记下"这份缓存是什么时候拿的"，用来判断它过期没。
- `const CACHE_TTL_MS = 60_000;` —— **TTL** 常量。
  - **语法小课堂：TTL = Time To Live（存活时间）。** 缓存"保鲜期"。`60_000` 毫秒 = 60 秒（`_` 分位，第⑥篇）。意思是"缓存最多用 60 秒，超过就当过期、重新问"。
  - 用全大写命名 `CACHE_TTL_MS` 是常量的惯例（表示"这是个固定不变的配置值"）。
- `let cache: DiscoveryCache | null = null;` —— **模块级缓存变量**（回忆第⑫篇模块级变量）：存上次问到的结果，初始 `null`（还没问过）。`let` 因为会反复改写。

---

## 第 17-20 行：清缓存的导出函数

```typescript
/** Clear the discovery cache so the next agent start re-discovers capabilities. */
export function clearDiscoveryCache(): void {
  cache = null;
}
```

- 一个对外的小函数：把 `cache` 设回 `null`，**强制下次重新发现**。
- 谁会用它？比如换了机器人、或传输重连后——能力可能变了，得作废旧缓存。下面就会看到一处自动调用它的逻辑。

---

## 第 22-49 行：`registerRobotContext`——注册钩子（主函数）

### 第 26-28 行：取配置

```typescript
export function registerRobotContext(api: OpenClawPluginApi, config: RosClawConfig): void {
  const robotName = config.robot.name;
  const robotNamespace = config.robot.namespace;
```

- 从配置取机器人名字和**命名空间（namespace）**。
  - 命名空间是 ROS2 里给一组话题/服务加的统一前缀（如 `/turtlebot3`）。多机器人时用它区分。下面会用它过滤"只保留属于本机器人的能力"。

### 第 30-42 行：传输重连时自动清缓存（含"空 catch"）

```typescript
  // Reactive re-discovery: clear cache on transport reconnect
  try {
    const transport = getTransport();
    transport.onConnection((status: string) => {
      if (status === "connected") {
        cache = null; // Force re-discovery on next agent start
        api.logger.info("Transport reconnected — capability cache cleared");
      }
    });
  } catch {
    // Transport not initialized yet — will be set up by the service.
    // The onConnection handler will be registered when the hook fires.
  }
```

- 意图（注释 `Reactive re-discovery`）：**传输一旦重连成功，就清空缓存**——因为重连可能意味着换了机器人或机器人重启了，旧能力清单不可信了。
- `try { ... } catch { ... }`：
  - `try` 里：拿传输、登记一个 `onConnection` 回调（第④/⑩篇）。回调里判断 `if (status === "connected")` 就 `cache = null` 清缓存 + 记日志。
  - **语法小课堂：`catch { }`——不带括号的 catch。** 回忆第②⑥篇 `catch (e)` 是接住错误对象。这里写 `catch {`（**没有 `(e)`**）表示"我知道可能出错，但**我不关心错误内容**，接住了啥也不干"。这是较新的语法，用在"出错也无所谓"的场景。
  - **为什么这里允许出错？** 注释说清了：`registerRobotContext` 在插件加载时就被调（第⑬篇），那时**传输可能还没初始化**（service 的 `start` 还没跑），`getTransport()` 会抛错（第⑫篇：没初始化就抛）。这没关系——抓住、忽略即可。等钩子真正触发时（对话开始时）传输早就好了。
  - 所以这段是"**尽力而为**"：能登记重连监听就登记，登记不上也不影响主流程。

### 第 44-48 行：注册 `before_agent_start` 钩子

```typescript
  api.on("before_agent_start", async (_event, _ctx) => {
    const capabilities = await discoverCapabilities(api, robotNamespace);
    const context = buildRobotContext(robotName, robotNamespace, capabilities);
    return { prependContext: context };
  });
}
```

- `api.on("before_agent_start", ...)` —— 挂在"对话开始前"这个时机（回忆第22篇 `api.on` 用法；这是另一个事件名）。`_event`/`_ctx` 都不用，加 `_`。
- 钩子体三行，逻辑极清晰：
  1. `const capabilities = await discoverCapabilities(api, robotNamespace);` —— **发现能力**（调下面的辅助函数，带缓存）。
  2. `const context = buildRobotContext(...);` —— **把能力拼成一段说明文字**（调下面另一个辅助函数）。
  3. `return { prependContext: context };` —— **返回注入指令**。
     - **语法小课堂：`before_agent_start` 钩子返回 `{ prependContext: 文本 }` 的含义。** `prependContext`（前置上下文）告诉宿主"把这段文本**塞到 AI 系统提示的前面**"。于是 AI 这次对话就带着这份机器人能力清单开场。
     - 这和第22篇钩子返回 `{block}` 是同一套机制（钩子用返回值影响宿主行为），只是这个钩子的返回字段是 `prependContext`（注入内容），那个是 `block`（拦截）。
- 主函数到此结束。下面是它用到的三个辅助函数。

---

## 第 51-98 行：`discoverCapabilities`——发现能力（缓存 + 并行 + 降级）

这是本篇最精华的函数，三个新概念都在这。

### 第 55-62 行：签名 + 命中缓存就直接返回

```typescript
async function discoverCapabilities(
  api: OpenClawPluginApi,
  namespace: string,
): Promise<DiscoveryCache> {
  // Return cached results if still fresh
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache;
  }
```

- 注意这个函数**没有 `export`**——它是模块内部的辅助函数，只给本文件用（回忆：不导出 = 私有）。
- `if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS)` —— **缓存命中判断**，拆开看：
  - `cache &&` —— 先得有缓存（不是 `null`）。`&&` 短路（第⑥篇）：没缓存就不算后面。
  - `Date.now() - cache.timestamp < CACHE_TTL_MS` —— **检查是否还新鲜**。
    - **语法小课堂：`Date.now()` 返回"现在的时间戳"**（从 1970 年至今的毫秒数，一个大整数）。
    - `Date.now() - cache.timestamp` —— 现在减去"缓存拿到的时刻" = **缓存已经存在了多少毫秒**。
    - `< CACHE_TTL_MS` —— 这个年龄小于 60 秒吗？小于就是"还新鲜"。
  - 两者都满足 → `return cache;` **直接返回旧缓存，跳过昂贵的重新发现**。这就是缓存省时间的核心：60 秒内的重复请求秒回。

### 第 64-71 行：缓存失效——并行发现三类能力（`Promise.all`）

```typescript
  try {
    const transport = getTransport();

    const [topics, services, actions] = await Promise.all([
      transport.listTopics(),
      transport.listServices(),
      transport.listActions(),
    ]);
```

- 缓存没命中（没有或过期），才真去问机器人。包在 `try` 里（下面有 catch 降级）。
- `const transport = getTransport();` —— 拿传输（这时传输肯定就绪了，因为钩子是对话时才触发的）。
- **本篇重磅新语法：`Promise.all`。**
  ```typescript
  const [topics, services, actions] = await Promise.all([
    transport.listTopics(),
    transport.listServices(),
    transport.listActions(),
  ]);
  ```
  - **语法小课堂：`Promise.all([承诺1, 承诺2, 承诺3])` —— "并行等待多个异步操作"。**
    - 我们要问三件事：列话题、列服务、列动作。每个都是异步的（返回 Promise）。
    - **如果一个个 `await`**（`await listTopics(); await listServices(); ...`），就是**串行**——等第一个完了才发第二个，三个加起来要等三段时间。
    - `Promise.all([...])` 把三个 Promise **同时发起**，然后等**它们全部完成**。总耗时≈最慢的那一个，而不是三个之和。这就是**并行**，快得多。
  - **语法小课堂：用数组解构接住结果 `const [topics, services, actions] = ...`。** `Promise.all` 返回的结果是个数组，**顺序和传入的一一对应**：第 0 个是 `listTopics` 的结果、第 1 个是 `listServices` 的、第 2 个是 `listActions` 的。用数组解构（回忆第⑥篇 `[x, y]`）一次性按位置拆出来，分别命名 `topics`/`services`/`actions`。
  - 一句话：**三件独立的事，与其排队做，不如一起做、一起等。** 这是 `Promise.all` 的典型用武之地。

### 第 73-82 行：按命名空间过滤 + 写入缓存

```typescript
    // Filter by namespace if configured
    const filterByNs = (name: string) =>
      !namespace || name.startsWith(namespace);

    cache = {
      topics: topics.filter((t: TopicInfo) => filterByNs(t.name)),
      services: services.filter((s: ServiceInfo) => filterByNs(s.name)),
      actions: actions.filter((a: ActionInfo) => filterByNs(a.name)),
      timestamp: Date.now(),
    };
```

- `const filterByNs = (name: string) => !namespace || name.startsWith(namespace);` —— 定义一个**判断函数**（存进变量，回忆第①篇"函数是一等公民"）：
  - 读作"这个名字该保留吗"：`!namespace || name.startsWith(namespace)`。
  - `!namespace` —— 没配命名空间（空字符串等假值）？那就**全保留**（`!` 取反 + 短路 `||`：没命名空间时直接 true）。
  - `name.startsWith(namespace)` —— 配了命名空间，就只保留**以它开头**的名字（`.startsWith`，第⑥篇）。比如命名空间 `/turtlebot3`，就只留 `/turtlebot3/...` 的话题，过滤掉别的机器人的。
- **语法小课堂：`数组.filter(判断函数)` —— "筛选数组"。**
  - 回忆第⑩篇的 `.map`（逐个变形）。`.filter` 是"逐个判断、只留下判断函数返回 `true` 的元素"，组成新数组。
  - `topics.filter((t: TopicInfo) => filterByNs(t.name))` —— 遍历每个话题 `t`，用 `filterByNs` 判断它的 `name` 该不该留，留下合格的。services、actions 同理。
- 把过滤后的三个数组 + 当前时间戳 `Date.now()` 组成新缓存，赋给 `cache`。**这就是"问到了就记下来"**——下次 60 秒内再来就命中上面那个缓存判断。

### 第 84-88 行：记日志 + 返回

```typescript
    api.logger.info(
      `Discovered ${cache.topics.length} topics, ${cache.services.length} services, ${cache.actions.length} actions`,
    );

    return cache;
```

- 记一行"发现了 N 个话题、M 个服务、K 个动作"（`.length` 取数组长度，模板字符串插值）。
- `return cache;` —— 返回这份新鲜缓存。

### 第 89-98 行：降级兜底（catch）

```typescript
  } catch (err) {
    api.logger.warn(`Capability discovery failed, using defaults: ${err}`);
    return {
      topics: [],
      services: [],
      actions: [],
      timestamp: 0,
    };
  }
}
```

- 如果上面任何一步出错（没连上、服务报错……），进 `catch`：
  - `catch (err)` —— 这次接住错误对象 `err`（和第22篇 `catch {` 不同，这里要用 `err` 写进日志）。
  - 记一条警告，把错误 `${err}` 拼进去（模板字符串里放对象会自动转成文字）。
  - **返回一份"空能力"**：三个空数组 `[]` + `timestamp: 0`。
    - **语法小课堂：`timestamp: 0` 是个小心机。** 0 是最古老的时间戳（1970 年），所以"现在 - 0"远大于 60 秒——这份兜底结果**天生就是"过期的"**，不会被当成有效缓存留用。下次还会重新尝试发现，而不是把这个空结果缓存住。
  - **注意：这里 `return` 的是空能力，但 `cache` 没被赋值**——失败结果不污染缓存。设计很细。
- **降级思想**：发现失败不崩、不卡，而是返回空，让上层用"硬编码默认清单"顶上（下面 `buildRobotContext` 会处理）。**宁可给 AI 一份不全的清单，也不让它彻底失明。**

---

## 第 100-117 行：`buildRobotContext`——选用动态还是兜底

```typescript
function buildRobotContext(
  name: string,
  namespace: string,
  capabilities: DiscoveryCache,
): string {
  const { topics, services, actions } = capabilities;

  // If discovery returned results, use them
  if (topics.length > 0 || services.length > 0 || actions.length > 0) {
    return buildDynamicContext(name, topics, services, actions);
  }

  // Fall back to hardcoded defaults if discovery failed
  return buildFallbackContext(name, namespace);
}
```

- `const { topics, services, actions } = capabilities;` —— **对象解构**（第⑪篇）：从能力对象里一次拆出三个数组。
- `if (三个 length 任一 > 0)` —— **只要发现到了任何能力**，就用 `buildDynamicContext` 拼**真实清单**。
- 否则（三个都空，说明发现失败了，回忆上面降级返回的空能力）—— 用 `buildFallbackContext` 拼**硬编码的默认清单**。
- 这就是降级的"分流口"：**有真数据用真的，没有就用兜底的。**

---

## 第 119-164 行：`buildDynamicContext`——把真实能力拼成 Markdown 文本

```typescript
function buildDynamicContext(
  name: string,
  topics: TopicInfo[],
  services: ServiceInfo[],
  actions: ActionInfo[],
): string {
  let context = `## Robot: ${name}\n\n`;
  context += `You are connected to a ROS2 robot named "${name}". You can control it using the ros2_* tools.\n\n`;
```

- 这个函数把能力清单拼成一段 **Markdown 格式的说明文字**（要喂给 AI 读）。
- `let context = \`## Robot: ${name}\n\n\`;` —— 用 `let` 起一个字符串变量（要反复追加，所以 `let`）。
  - **语法小课堂：`\n` 是"换行符"。** 字符串里的 `\n` 代表按一次回车。`\n\n` 就是空一行（Markdown 里用空行分段）。`## Robot:` 是 Markdown 的二级标题写法。
- `context += \`...\`;` —— **语法小课堂：`+=` 是"追加赋值"。** `context += x` 等于 `context = context + x`，即"把 x 接到 context 后面"。这里不断 `+=` 往说明里加内容，像往纸上一行行写字。

### 第 128-150 行：三段循环（话题/服务/动作各一段）

```typescript
  if (topics.length > 0) {
    context += "### Available Topics\n";
    for (const t of topics) {
      context += `- \`${t.name}\` (${t.type})\n`;
    }
    context += "\n";
  }
  // services、actions 两段结构完全相同，略
```

- 三段长得一样，看话题这段就懂：
  - `if (topics.length > 0)` —— 有话题才写这段（没有就跳过整段，不留空标题）。
  - `context += "### Available Topics\n";` —— 加个小标题。
  - `for (const t of topics) { context += ... }` —— **`for...of` 遍历**（第⑥篇），每个话题追加一行：`` - `话题名` (类型) ``。
    - `` `- \`${t.name}\` (${t.type})\n` `` —— 注意里头的 `` \` `` 是**转义的反引号**：因为整个模板字符串用反引号包着，里面想输出字面的反引号（Markdown 代码块标记）就得写 `\``。输出效果是 `` - `/cmd_vel` (geometry_msgs/msg/Twist) ``。
  - 末尾 `context += "\n";` 再空一行分段。
- 服务、动作两段一模一样，只换标题和变量。**重复三段而不抽函数**，是因为各段标题不同、且就三段，直接写更直白。

### 第 152-163 行：追加固定的安全限值 + 提示

```typescript
  context += `### Safety Limits
- Maximum linear velocity: 1.0 m/s
- Maximum angular velocity: 1.5 rad/s
- All velocity commands are validated before execution

### Tips
- Use \`ros2_list_topics\` to discover all available topics
...
- The user can say /estop at any time to immediately stop the robot`;

  return context;
}
```

- 最后追加两段**固定文本**：安全限值说明 + 使用提示（告诉 AI 有哪些好用的工具、用户能 `/estop` 急停）。
  - 注意这里用了**多行模板字符串**——反引号里直接换行，所见即所得（不用写 `\n`，直接敲回车）。这是模板字符串的便利。
  - 这段是写给 AI 的"行为引导"：让它知道速度有上限、知道可以用 `ros2_list_topics` 等工具、知道急停的存在。
- `return context;` —— 返回拼好的完整说明。

---

## 第 166-192 行：`buildFallbackContext`——发现失败时的硬编码清单

```typescript
function buildFallbackContext(name: string, namespace: string): string {
  const prefix = namespace ? `${namespace}/` : "/";

  return `
## Robot: ${name}
...
### Available Topics
- \`${prefix}cmd_vel\` (geometry_msgs/msg/Twist) — Velocity commands
- \`${prefix}odom\` (nav_msgs/msg/Odometry) — Odometry data
...
`.trim();
}
```

- 当发现失败（没连上等），用这份**写死的常见话题清单**顶上，免得 AI 完全没信息。
- `const prefix = namespace ? \`${namespace}/\` : "/";` —— **三元运算符**（第⑥篇）：有命名空间就用 `命名空间/` 当前缀，没有就用 `/`。这样兜底清单里的话题名也能带上正确前缀（如 `/turtlebot3/cmd_vel` 或 `/cmd_vel`）。
- 中间是一大段写死的话题（cmd_vel、odom、scan、camera、battery_state——典型移动机器人都有的），格式和动态版一致。
- 末尾 `.trim()` —— **语法小课堂：`字符串.trim()` 去掉首尾空白**（包括开头那个因为反引号换行产生的空行）。因为模板字符串从 `` ` `` 后直接换行会在开头多一个换行，`.trim()` 把它修掉，输出干净。
- **降级的价值**：哪怕完全没连上机器人，AI 也能拿到一份"典型机器人长这样"的清单先用着，而不是一无所知。这比"失败就什么都不给"友好得多。

---

## 整章回顾

`robot-context.ts` 用 `before_agent_start` 钩子，在每次对话开始前把机器人能力清单注入 AI 的系统提示。三个核心机制：

| 机制 | 怎么做 | 好处 |
|---|---|---|
| **注入** | 钩子返回 `{ prependContext: 文本 }` | AI 开场就懂这台机器人 |
| **缓存（TTL）** | `Date.now() - timestamp < 60s` 就复用旧结果 | 60 秒内不重复问，省时间；重连时清缓存 |
| **降级（fallback）** | 发现失败返回空能力 → 用硬编码默认清单 | 没连上也不让 AI 失明 |

并用 `Promise.all` 把"列话题/服务/动作"三件事**并行**做，进一步省时间。

**语法点回顾清单**（本章新增/巩固）：
- **`Promise.all([...])`：并行等待多个异步操作**，结果数组按序解构 `const [a,b,c] = ...`（重点）
- 带 TTL 的缓存：`Date.now()` 取时间戳、`现在 - timestamp < TTL` 判新鲜、模块级 `cache` 变量
- `数组.filter(判断函数)`：筛选出判断为 true 的元素（对照第⑩篇 `.map`）
- 降级兜底（fallback）：失败返回空/默认，分流口 `if (有数据) 用真的 else 用兜底`
- `catch {}`（不接错误对象，出错也无所谓）vs `catch (err)`（要用错误）
- 字符串拼装：`let s = ...; s += ...`、`\n` 换行、多行模板字符串、`\\\`` 转义反引号、`.trim()`
- `timestamp: 0` 让兜底结果天生"过期"、失败不写 `cache` 不污染缓存（设计细节）
- 三元 `namespace ? ... : "/"`（巩固）、`!namespace || name.startsWith(...)` 短路（巩固）

下一份：[`commands/estop.ts` 逐行详解 →](24-commands-estop.ts.md)（从"钩子"转到"命令"：用户直接打 `/estop` 立刻急停，绕过 AI）
