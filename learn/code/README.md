# 逐行详解系列 · 总览

> 这是为**新手中的新手**准备的"逐行 + 逐语法"代码详解系列，是对 [`learn/04-核心代码导读.md`](../04-核心代码导读.md) 的深度展开。
>
> - 顶层 `04` 章是"鸟瞰"——讲设计意图、用简化代码。
> - 本系列 `code/` 是"显微镜"——读**真实源码**，**每一行、每一个符号**都拆开讲，第一次出现的 TypeScript 语法都用「语法小课堂」单独补课。
>
> **从哪开始**：🧭 **强烈建议先读 [00 · 一条命令的旅程](00-一条命令的旅程.md)**——它是全系列的"龙头"，跟着一条命令（「向前走 1 米」）走过 8 个文件，精确到"哪个文件、哪个函数、第几行"，并链到下面每一篇。有了这条主线打底，再按下表顺序逐篇读就不会迷路。
>
> **怎么用**：按下表顺序一篇篇读。每篇结尾有「语法点回顾清单」，可当字典反查。讲解顺序遵循**依赖关系**（先读被依赖的底层，再读依赖它的上层），而不是文件名顺序。

---

## 流程主线（先读我）

| # | 文档 | 内容 | 状态 |
|---|---|---|---|
| 00 | [一条命令的旅程](00-一条命令的旅程.md) | 跟踪一条命令端到端穿过 8 个文件，每跳标注 `文件:函数:行号` 并链入对应逐行详解——**全系列的导航主线** | ✅ |

---

## 进度一览

图例：✅ 已完成 · ⬜ 待完成 · "行数"=源码行数（难度参考）

### 第一部分：契约与配置（基础，无执行逻辑）

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 01 | [plugin-api.ts](01-plugin-api.ts.md) | `src/plugin-api.ts` | ✅ | 138 |
| 02 | [config.ts](02-config.ts.md) | `src/config.ts` | ✅ | 73 |

### 第二部分：传输层抽象（接口与数据结构）

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 03 | [transport-types.ts](03-transport-types.ts.md) | `src/transport/types.ts` | ✅ | 119 |
| 04 | [transport.ts](04-transport.ts.md) | `src/transport/transport.ts` | ✅ | 70 |

### 第三部分：rosbridge 实现（模式 B，唯一完整实现）

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 05 | [rosbridge-types.ts](05-rosbridge-types.ts.md) | `src/transport/rosbridge/types.ts` | ✅ | 119 |
| 06 | [rosbridge-client.ts](06-rosbridge-client.ts.md) 🔥最难 | `src/transport/rosbridge/client.ts` | ✅ | 317 |
| 07 | [rosbridge-topics.ts](07-rosbridge-topics.ts.md) | `src/transport/rosbridge/topics.ts` | ✅ | 60 |
| 08 | [rosbridge-services.ts](08-rosbridge-services.ts.md) | `src/transport/rosbridge/services.ts` | ✅ | 41 |
| 09 | [rosbridge-actions.ts](09-rosbridge-actions.ts.md) | `src/transport/rosbridge/actions.ts` | ✅ | 81 |
| 10 | [rosbridge-adapter.ts](10-rosbridge-adapter.ts.md) | `src/transport/rosbridge/adapter.ts` | ✅ | 148 |

### 第四部分：装配与启动

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 11 | [transport-factory.ts](11-transport-factory.ts.md) | `src/transport/factory.ts` | ✅ | 42 |
| 12 | [service.ts](12-service.ts.md) | `src/service.ts` | ✅ | 114 |
| 13 | [index.ts](13-index.ts.md) | `src/index.ts` | ✅ | 40 |

### 第五部分：工具层（注册给 AI 的 8 个工具）

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 14 | [tools-index.ts（含通用结构）](14-tools-index.ts.md) | `src/tools/index.ts` | ✅ | 21 |
| 15 | [ros2-publish.ts](15-ros2-publish.ts.md) | `src/tools/ros2-publish.ts` | ✅ | 39 |
| 16 | [ros2-subscribe.ts](16-ros2-subscribe.ts.md) | `src/tools/ros2-subscribe.ts` | ✅ | 50 |
| 17 | [ros2-service.ts](17-ros2-service.ts.md) | `src/tools/ros2-service.ts` | ✅ | 43 |
| 18 | [ros2-action.ts](18-ros2-action.ts.md) | `src/tools/ros2-action.ts` | ✅ | 47 |
| 19 | [ros2-param.ts](19-ros2-param.ts.md) | `src/tools/ros2-param.ts` | ✅ | 83 |
| 20 | [ros2-introspect.ts](20-ros2-introspect.ts.md) | `src/tools/ros2-introspect.ts` | ✅ | 29 |
| 21 | [ros2-camera.ts](21-ros2-camera.ts.md) | `src/tools/ros2-camera.ts` | ✅ | 53 |

### 第六部分：钩子与命令

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 22 | [safety-validator.ts](22-safety-validator.ts.md) | `src/safety/validator.ts` | ✅ | 43 |
| 23 | [robot-context.ts](23-robot-context.ts.md) | `src/context/robot-context.ts` | ✅ | 192 |
| 24 | [commands-estop.ts](24-commands-estop.ts.md) | `src/commands/estop.ts` | ✅ | 40 |
| 25 | [commands-transport.ts](25-commands-transport.ts.md) | `src/commands/transport.ts` | ✅ | 171 |

### 第七部分：另外两种传输模式（模式 A / C）

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 26 | [local-transport.ts](26-local-transport.ts.md) | `src/transport/local/transport.ts` | ✅ | 375 |
| 27 | [local-conversion.ts](27-local-conversion.ts.md) | `src/transport/local/conversion.ts` | ✅ | 153 |
| 28 | [local-entities.ts](28-local-entities.ts.md) | `src/transport/local/entities.ts` | ✅ | 129 |
| 29 | [webrtc-signaling-types.ts](29-webrtc-signaling-types.ts.md) | `src/transport/webrtc/signaling-types.ts` | ✅ | 130 |
| 30 | [webrtc-transport.ts](30-webrtc-transport.ts.md) | `src/transport/webrtc/transport.ts` | ✅ | 516 |
| 31 | [webrtc-signaling-client.ts](31-webrtc-signaling-client.ts.md) | `src/transport/webrtc/signaling-client.ts` | ✅ | 196 |

### 第八部分：第二个扩展

| # | 文档 | 源文件 | 状态 | 行数 |
|---|---|---|---|---|
| 32 | [openclaw-canvas](32-openclaw-canvas.md) | `extensions/openclaw-canvas/` | ✅ | 14 |

---

## 当前进度

- **全部完成：32 / 32 篇 🎉**（整个 RosClaw 项目——主插件 31 个源文件 + 第二个扩展 canvas——已逐行读完）。
- 收官篇 [32 · openclaw-canvas](32-openclaw-canvas.md) 末尾有全系列总回顾与下一步建议。
- 想反查某个语法点，用下面的「语法学习地图」。

### 交付批次记录

| 批次 | 包含文档 | 状态 |
|---|---|---|
| 第一批 | 01, 02 | ✅ |
| 第二批（合并入第一批前的确认） | — | — |
| 第三批 | 03, 04 | ✅ |
| 第四批 | 05, 06 | ✅ |
| 第五批 | 07, 08, 09 | ✅ |
| 第六批 | 10, 11 | ✅ |
| 第七批 | 12, 13 | ✅ |
| 第八批 | 14, 15, 16 | ✅ |
| 第九批 | 17, 18, 19 | ✅ |
| 第十批 | 20, 21 | ✅ |
| 第十一批 | 22, 23 | ✅ |
| 第十二批 | 24, 25 | ✅ |
| 第十三批 | 26, 27, 28 | ✅ |
| 第十四批 | 29, 30, 31 | ✅ |
| 第十五批 | 32 | ✅ 收官 🎉 |

> 批次划分是计划，可能随内容长短微调；以上表"进度一览"的 ✅/⬜ 为准。

---

## 语法学习地图（已讲过的 TypeScript 语法 → 在哪篇首次出现）

读到后面遇到忘了的语法，回这里查它在哪篇讲过。

### 注释与模块
- 三种注释 `// /* */ /** */`、JSDoc、`@see` —— 01、05
- `import { X }`（具名）/ `import X`（默认）/ `import type` —— 01、02、06
- `import`（值，要 new/调用）vs `import type`（仅类型，运行时抹除）的判断标准 —— 10
- 一条 import 混用值与类型：`import { 值, type 类型 } from …` —— 30
- 动态 `import("...")`：执行到才加载、返回 Promise、按需加载 —— 11
- `createRequire(import.meta.url)`：在 ESM 里借 CJS 的 `require` 加载老库（rclnodejs）；`import.meta.url` 当前文件地址 —— 26
- `export default`（默认导出，一文件至多一个、导入不带花括号）vs 具名 `export` —— 13
- `export` 导出、`./` 当前目录、`../` 上级、内部导入写 `.js` 后缀 —— 01、04

### 类型系统基础
- 基础类型 `string`/`number`/`boolean`/`void`/`unknown`/`null` —— 01、06
- `interface`（对象形状）vs `type`（更万能） —— 01
- 可选 `?`、数组 `[]`、`Record<K,V>`、`Promise<T>` —— 01
- 联合 `|`、字面量类型、判别联合、类型收窄 —— 01、03
- 交叉类型 `&` —— 06
- 函数类型 `(参数) => 返回`、回调、函数重载 —— 01、03
- 剩余参数 `function f(a, ...args: unknown[])`（收集任意多个尾部参数） —— 32
- 极简局部接口：只声明真正用到的成员（vs 完整 `OpenClawPluginApi`） —— 32
- `interface extends`（继承）、子接口收紧字段 —— 05
- `class implements 接口`：承诺实现契约、TS 逐方法强制检查 —— 10
- `never` 类型 + 穷举检查（`const _e: never = 判别变量`，漏分支编译期报错） —— 11
- `any`（放弃类型检查的逃生类型，catch 里常见） —— 11
- `type X = any` 给 any 起有意义的别名（自我文档化） —— 28
- 工具类型 `Required<T>`、`ReturnType<typeof f>` —— 06
- `as`（类型断言）、`!`（非空断言）、`typeof 值`（值→类型） —— 06、02
- 双重断言 `as unknown as X`（源/目标差太远时的强转） —— 09
- `satisfies 类型`：验证对象符合某类型但保留精确类型（比 `as` 安全——核对而非强断言） —— 31
- 索引签名 `[key: string]: unknown`（除已知字段外允许任意字符串键） —— 29
- `string | null`（值可为 null）vs `?`（键可省略）的区别 —— 29
- 索引访问类型 `TransportConfig["mode"]`（从对象类型里取某字段的类型，跟着源头自动变） —— 12
- `as const`（锁成只读字面量类型）+ 从数组派生类型 `(typeof 数组)[number]` —— 25
- 类型守卫 `function f(x): x is T`（运行时检查 + 让 TS 收窄类型） —— 25
- 真值判断 `if (someValue)`（判空简写）、可空函数字段 `(() => void) | null` —— 07

### 值与变量
- `const`/`let`/`var`、对象简写 `{a,b}`、数组解构 `[x,y]` —— 02、06
- 模块级变量（写在文件最外层、全文件共享、程序运行期长存）——单例的朴素实现 —— 12
- 先声明后赋值 `let x: T;` 再在各分支赋值（穷尽分支时可省 `default`） —— 12
- 参数名加 `_` 前缀（`_ctx`）表示"故意不用此参数" —— 12
- 对象解构 `const { X } = 模块/对象`（拆出某项） —— 11
- 模板字符串 `` `${x}` ``、数字分隔符 `10_000` —— 06
- `??`（空值合并）、`?.`（可选链）、默认参数 —— 06

### 运算与控制流
- `===`/`!==`、`!`/`&&`/`||`、三元 `?:` —— 06
- `if`、`switch`/`case`/`break`、`for...of`、`continue`、`return` —— 02、06
- `++x`/`x++`、`Math.min`/`Math.pow`、`字符串.startsWith` —— 06
- `**`（乘方）、`Math.sqrt`（平方根）、`Math.abs`（绝对值）、`数字.toFixed(2)`（保留小数） —— 22
- 数组 `.map((元素,下标)=>…)`、`.push()`；箭头函数返回对象套圆括号 `({...})` —— 10
- 数组 `.filter(判断函数)`（筛选）、`.length`（长度） —— 23
- 数组 `.some(判断)`（有无任一满足）、`.find(判断)`（找第一个）、链式 `.filter().map()` —— 26
- `Object.entries`（键值对数组）/`Object.keys`（键名数组）/`Map.values`（值），配 `for...of` 遍历 —— 26
- 数组 `.includes`/`.join`/`.slice(1)`、字符串 `.includes`/`.split`、正则 `/\s+/`（按空白分割） —— 25
- 解构剩余元素 `const [key, ...rest] = …`（处理"值里也含分隔符"） —— 25
- `{ ...对象 }` 展开浅拷贝（改副本不污染原对象）、`键 in 对象`（判断有无该键） —— 25
- `Number(value)` 转数字、`Number.isNaN` 校验、`value === "true"` 转布尔、按 `typeof` 分支转换 —— 25
- 字符串 `.endsWith` / `.slice(起,止)` / 负数下标"从末尾数"；`对象["键名"]` 取属性 —— 10
- 字符串拼装：`s += x`（追加）、`\n` 换行、多行模板字符串、`\\\`` 转义反引号、`.trim()` —— 23
- `字符串.replace(/\/+$/, "")`：正则去掉结尾斜杠（URL 规整） —— 31

### 类与异步
- `class`/`new`/实例/`this`/`constructor`/`private` —— 06
- `static` 静态成员（类共享一份）+ 静态门闩（全进程只初始化一次） —— 26
- 递归：函数调用自己处理"同类的子结构"（嵌套消息层层穿透） —— 27
- 构造函数参数属性简写（参数前加 `private`/`public` 自动建字段） —— 07
- `get 属性()`：取值器（getter），用时不加括号、像读属性但实时计算 —— 31
- `Map`/`Set` 容器及其方法 —— 06
- `Promise` 构造 `new Promise((resolve,reject)=>…)`、`async`/`await` —— 06
- `async` 函数直接 `return` 一个 Promise（不在体内 await）、事件→Promise 桥接 —— 08
- `setTimeout`/`clearTimeout`、`try/catch`、`throw`/`new Error` —— 02、06
- `setInterval`/`clearInterval`：反复定时触发（vs setTimeout 一次）；心跳保活 —— 31
- `fetch(url, {method,headers,body})` 发 HTTP 请求；`res.ok`/`res.status`/`res.json()`/`res.text()` —— 31
- `catch {}`（不接错误对象，出错也无所谓）vs `catch (err)`（要用错误） —— 23
- `try/finally`（无论成败必执行的善后） —— 09
- 并发门闩：布尔标志 + `try { 上闩… } finally { 抬闩 }` 防止异步操作重入 —— 12
- **`Promise.all([...])`：多个异步操作并行、一起等，结果按序解构 `const [a,b,c]=…`** —— 23
- 带 TTL 的缓存：`Date.now()` 时间戳 + `现在-timestamp<TTL` 判新鲜 + 模块级 `cache` —— 23
- 降级兜底（fallback）：失败返回空/默认，`if(有数据)用真的 else 用兜底` —— 23
- `JSON.stringify`/`JSON.parse` —— 06

### 第三方库
- Zod：`z.object/string/number/boolean/enum/array/union`、链式 `.optional()/.default()`、`z.infer` —— 02
- `TSchema`（TypeBox，工具参数定义） —— 01
- TypeBox：`Type.Object/String/Number/Record/Unknown/Optional`、字段带 `{ description }`（写给 AI） —— 14、15、16

### 工具开发（OpenClaw）
- 工具对象 `AgentTool`：name/label/description/parameters/execute —— 14
- `description` 是写给 AI 的提示词（决定 AI 是否/如何使用工具） —— 14
- `execute(_toolCallId, params): Promise<ToolResult>`、返回 `content`(文本) + `details`(对象) —— 14、15
- `params["键"] as 类型`：从 `Record<string,unknown>` 取参数并断言（有 schema 校验兜底） —— 15
- 竞速 Promise：一条路 `resolve`、另一条 `setTimeout`→`reject`，谁先到谁结束 + 双向清理 —— 16
- 一个注册函数里多次 `api.registerTool`（一文件注册多个工具） —— 19
- "某能力 = 调某约定服务"模式：模板字符串拼服务名 + 迁就服务形状（值包成数组、嵌套结构） —— 19（呼应 10 的 `/rosapi/topics`）
- 纯转发的值不必 `as` 断言（要用具体能力才断言） —— 19
- 底层能力（如动作进度回调）在工具层可选择不用——务实取舍 —— 18
- `Type.Object({})`：声明"无参数"工具（仍必须写 `parameters`） —— 20
- base64：把二进制（图像）编码成纯文本以便走 JSON 协议；`ToolResult.content` 支持 `text`/`image` 两型 —— 21

### 钩子（OpenClaw hooks，按时机自动触发）
- `api.on(事件名, async (event, ctx) => {...})`：登记钩子，宿主到点自动触发（vs 工具被动调用） —— 22
- `before_tool_call`：工具调用前拦截，返回 `{block,blockReason}` 拦下 / `void` 放行 —— 22
- `before_agent_start`：对话开始前注入，返回 `{prependContext: 文本}` 塞进系统提示 —— 23
- 钩子用返回值影响宿主行为（拦截 / 注入），是统一的机制 —— 22、23

### 命令（OpenClaw commands，用户直接打 `/xxx`）
- `api.registerCommand({ name, description, handler })`：登记命令，绕过 AI；`description` 写给人 —— 24
- 命令 `handler(ctx)` 返回 `{ text }`：作为回复直接显示给用户 —— 24
- 三种交互对照：工具(AI 调,返 content/details) / 钩子(宿主触发,返 block/prependContext) / 命令(用户打,返 text) —— 24
- `ctx.args` 解析参数：`?? ""` + `.trim()` + `.split(/\s+/)` + 类型守卫校验 —— 25
- 安全操作的 try/catch：成功确认、失败响亮告警、绝不静默（`/estop`） —— 24

> 早先预告的大语法（`Promise.all` 并行、`createRequire`/CommonJS 互操作）均已在第 23、26 篇讲完。至此本系列承诺补的语法点已全部覆盖。

### 读码方法论（比语法更值钱的几样）
- 看懂"分层"：接口在中间、实现可替换（三种传输模式同实现一个 `RosTransport`） —— 04 + 10/26/30
- 识别"模式"：缓存（查→建→存）、Promise 包装回调、按 id 配对、引用计数清理 —— 反复出现
- 对照"现状 vs 文档"：发现并诚实指出代码与文档/注释的不一致（以代码为准） —— 21、30、31
- 存根的正当价值：正确类型签名 + 诚实标注未实现（vs 假装实现） —— 32

---

## 阅读建议

1. **严格按顺序**：后一篇默认你已掌握前面讲过的语法，讲过的不再重复。
2. **对照真实源码**：每篇开头有源文件链接，建议左边开源码、右边开详解对照看。
3. **卡住就回查**：忘了某语法，用上面「语法学习地图」定位到首讲那篇。
4. **第 06 篇（client.ts）是分水岭**：它最难、语法最密。吃透它，后面都是轻松的。建议反复读 `connect` 和 `handleMessage` 两个方法。
5. **读完动手改一行**：挑个最感兴趣的方法，自己改一行、跑一下看会怎样——"读"之后"动手"才能把知识焊牢。

---

## 🎉 全系列已完成（32 / 32）

从 01 `plugin-api.ts` 到 32 `openclaw-canvas`，整个 RosClaw 已逐行读完。收官总回顾见 [第 32 篇结尾](32-openclaw-canvas.md)。一路累计的上百个 TypeScript 语法点都收录在上面的「语法学习地图」里，可随时反查——它们是读**任何** TS 项目的通用功底。

← 返回 [核心代码导读（鸟瞰版）](../04-核心代码导读.md)
