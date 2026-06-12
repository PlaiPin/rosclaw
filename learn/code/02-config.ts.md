# 逐行详解 ②：`config.ts`

> 对应源文件：[extensions/openclaw-plugin/src/config.ts](../../extensions/openclaw-plugin/src/config.ts)
>
> 推荐阅读顺序第 2 个文件。它负责一件事：**定义"用户能填哪些配置、每项的默认值是什么"，并提供一个函数把用户填的原始数据校验成可靠的配置对象。**

---

## 先理解这个文件要解决的问题

用户在界面上会填一堆配置：连接机器人的地址、速度上限、机器人名字……但用户填的东西**不可信**：

- 可能漏填（那就该用默认值）。
- 可能填错类型（该填数字却填了文字）。
- 可能填了我们不认识的模式。

我们需要一个"守门员"：把用户填的"生数据"检查一遍，缺的补上默认值，错的直接拒绝。这个文件用一个叫 **Zod** 的库来当这个守门员。

**什么是 Zod？** 它是一个"运行时数据校验库"。你先用它描述"我期望的数据长什么样"（这份描述叫 **schema / 模式**），然后把真实数据丢给它检验。它和上一章的 `interface` 有个根本区别：

- `interface` 只在**开发期/编译期**检查，程序真正运行时它已经被删掉了，**管不到运行时来的真实数据**（比如用户输入）。
- Zod 是真正的代码，在**运行时**执行，能拦住运行时进来的脏数据。

所以：`interface` 管"我们自己写的代码对不对"，Zod 管"外面进来的数据对不对"。两者配合。

---

## 第 1 行：导入 Zod

```typescript
import { z } from "zod";
```

- `import { z } from "zod"` —— 从名为 `"zod"` 的库里，导入一个叫 `z` 的东西。
- 注意这里**没有** `type` 关键字（对比上一章的 `import type`）。因为 `z` 不是类型，而是一个**真实的对象**，我们要在运行时真的调用它身上的方法（`z.object(...)`、`z.string()` 等）。它必须留到运行时，不能被删掉。
- `z` 是 Zod 库约定俗成的名字，可以理解成"Zod 的工具台"，所有构建 schema 的工具都挂在它身上。

---

## 第 3-7 行：一个小 schema —— ICE 服务器

```typescript
const IceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
```

**语法小课堂：`const` 是什么？**
`const` 声明一个**常量**——一个起了名字、且**之后不会被重新赋值**的变量。`const IceServerSchema = ...` 就是"造一个叫 `IceServerSchema` 的常量，它的值是右边那一坨"。声明变量还有 `let`（可改）和过时的 `var`，本项目几乎只用 `const`，因为"不可变"更安全、更可预测。

> 这个 `IceServerSchema` 没有 `export`，所以只在本文件内部用——它是给下面 webrtc 配置当"零件"的。

逐行看里面：

- `z.object({ ... })` —— 调用 `z` 的 `object` 方法，"我要描述一个**对象**，它有以下这些字段"。花括号里就是字段清单。
- `urls: z.union([z.string(), z.array(z.string())]),` —— 描述一个叫 `urls` 的字段。
  - `z.union([...])` —— "联合"，表示"这个字段可以是下面几种类型之一"（对应上一章 TS 的 `|`，这里是 Zod 的运行时版本）。
  - `[z.string(), z.array(z.string())]` —— 方括号是一个**数组**，里面列出允许的两种形态：
    - `z.string()` —— 一个字符串（比如单个地址 `"stun:..."`）。
    - `z.array(z.string())` —— 一个"字符串的数组"（比如多个地址 `["...", "..."]`）。
  - 合起来：`urls` 既可以是一个地址，也可以是一串地址。
- `username: z.string().optional(),` —— 字段 `username`，类型是字符串，但 **`.optional()`** 表示"可以不填"。
  - **语法小课堂：`.方法()` 这种"点号链式调用"是什么？**
    `z.string()` 先得到一个"字符串 schema"，然后在它后面接 `.optional()`，是在这个 schema 的基础上"再加一条规则：可省略"。这种"造好一个东西后用点号继续在它身上加工"的写法叫**链式调用（chaining）**，整份文件大量使用。可以读成"字符串、并且可选"。
- `credential: z.string().optional(),` —— 同理，字段 `credential`（密码/凭据），字符串、可选。

这个小 schema 描述的是 WebRTC 用到的 STUN/TURN 服务器配置，现在不用懂它的网络含义，重点是**看懂 Zod 描述数据的写法**。

---

## 第 9 行：主配置 schema 开始

```typescript
export const RosClawConfigSchema = z.object({
```

- `export const RosClawConfigSchema = z.object({` —— 导出一个常量 `RosClawConfigSchema`，它是一个 Zod 对象 schema。这是**整个插件的配置总表**。
- 花括号 `{` 开始列字段，一直到第 63 行的 `})` 才结束。中间分成 `transport / rosbridge / local / webrtc / robot / safety` 六大块，每块自己又是一个 `z.object`（对象套对象，叫"嵌套"）。

下面逐块讲。

---

## 第 10-14 行：`transport`（传输模式）

```typescript
  transport: z
    .object({
      mode: z.enum(["rosbridge", "local", "webrtc"]).default("rosbridge"),
    })
    .default({}),
```

- `transport: z.object({ ... }).default({}),` —— 一个叫 `transport` 的字段，它本身又是个对象。
  - 注意这里把链式调用**换行**写了：`z` 在一行，`.object({...})` 一段，`.default({})` 又一段。换行只是排版，连起来读就是 `z.object({...}).default({})`。
- 里面只有一个字段 `mode`：
  - `z.enum(["rosbridge", "local", "webrtc"])` —— **枚举**。意思是"这个字段的值**只能是**列出的这几个之一"，填别的就报错。这里限定传输模式只能三选一。
  - `.default("rosbridge")` —— 如果用户没填 `mode`，就默认用 `"rosbridge"`。
- 外层的 `.default({})` 是这一块设计上的**关键技巧**：
  - `{}` 是一个**空对象**（什么字段都没有）。
  - `.default({})` 表示"如果用户连 `transport` 这一整块都没填，就当他填了个空对象 `{}`"。
  - 而空对象会触发里面每个字段各自的 `.default(...)`——于是 `mode` 又变回 `"rosbridge"`。
  - **效果**：一层层的默认值像多米诺骨牌一样被触发，最终保证"即使用户什么都不填，也能得到一份完整、合理的配置"。这就是文档里说的"`parseConfig({})` 也能正常工作"的原理。

---

## 第 16-22 行：`rosbridge`（WebSocket 连接配置）

```typescript
  rosbridge: z
    .object({
      url: z.string().default("ws://localhost:9090"),
      reconnect: z.boolean().default(true),
      reconnectInterval: z.number().default(3000),
    })
    .default({}),
```

- `url: z.string().default("ws://localhost:9090"),` —— 连接地址，字符串，默认是本机的 `ws://localhost:9090`（`ws://` 是 WebSocket 协议的前缀，`localhost` 指本机，`9090` 是端口号，是 rosbridge 的默认端口）。
- `reconnect: z.boolean().default(true),` —— 是否自动重连，布尔值，默认 `true`（开启）。
- `reconnectInterval: z.number().default(3000),` —— 重连间隔，数字，默认 `3000`（单位毫秒，即 3 秒）。
- 末尾同样 `.default({})`，整块可省略。

---

## 第 24-28 行：`local`（本机直连 DDS）

```typescript
  local: z
    .object({
      domainId: z.number().default(0),
    })
    .default({}),
```

- `domainId: z.number().default(0),` —— ROS2 的"域 ID"，数字，默认 `0`。（ROS2 用域 ID 把不同机器人/系统隔离开，默认大家都在 0 号域。）现在记住"它是一个数字配置项"即可。
- 整块可省略（`.default({})`）。

---

## 第 30-40 行：`webrtc`（点对点远程连接）

```typescript
  webrtc: z
    .object({
      signalingUrl: z.string().default(""),
      apiUrl: z.string().default(""),
      robotId: z.string().default(""),
      robotKey: z.string().default(""),
      iceServers: z
        .array(IceServerSchema)
        .default([{ urls: "stun:stun.l.google.com:19302" }]),
    })
    .default({}),
```

- 前四个字段 `signalingUrl / apiUrl / robotId / robotKey` 都是字符串，默认值都是 `""`（**空字符串**，即"一个字都没有的文字"）。默认留空意味着"用户不配 WebRTC 就不填，这些值是空的"。
- `iceServers: z.array(IceServerSchema).default([...]),` —— 这里把前面定义的小 schema 用上了：
  - `z.array(IceServerSchema)` —— "一个数组，里面每个元素都必须符合 `IceServerSchema` 的形状"。这就是为什么前面要先单独定义那个小 schema——为了在这里当"数组元素的模板"复用。
  - `.default([{ urls: "stun:stun.l.google.com:19302" }])` —— 默认值是一个**含一个元素的数组**：`[ {...} ]`。那一个元素 `{ urls: "stun:stun.l.google.com:19302" }` 是个对象，提供了一个公共的 Google STUN 服务器地址。
- 整块可省略。

---

## 第 42-47 行：`robot`（机器人身份）

```typescript
  robot: z
    .object({
      name: z.string().default("Robot"),
      namespace: z.string().default(""),
    })
    .default({}),
```

- `name: z.string().default("Robot"),` —— 机器人名字，字符串，默认 `"Robot"`。这个名字会出现在注入给 AI 的提示里（"你正连接着一台叫 XXX 的机器人"）。
- `namespace: z.string().default(""),` —— 命名空间，字符串，默认空。
  - ROS2 用"命名空间"给话题名加前缀，实现多机器人隔离。比如命名空间是 `/robot1`，那它的速度话题就是 `/robot1/cmd_vel` 而不是 `/cmd_vel`。默认空表示不加前缀。

---

## 第 49-62 行：`safety`（安全限制）—— 含一层嵌套

```typescript
  safety: z
    .object({
      maxLinearVelocity: z.number().default(1.0),
      maxAngularVelocity: z.number().default(1.5),
      workspaceLimits: z
        .object({
          xMin: z.number().default(-10),
          xMax: z.number().default(10),
          yMin: z.number().default(-10),
          yMax: z.number().default(10),
        })
        .default({}),
    })
    .default({}),
```

- `maxLinearVelocity: z.number().default(1.0),` —— **最大线速度**（直线行进速度），数字，默认 `1.0`（米/秒）。安全钩子会用它来拦截超速指令。
- `maxAngularVelocity: z.number().default(1.5),` —— **最大角速度**（转弯/旋转速度），数字，默认 `1.5`（弧度/秒）。
- `workspaceLimits: z.object({ ... }).default({}),` —— **工作空间边界**，它本身又是一个嵌套对象（对象套对象套对象，到这里是第三层了）。里面四个数字定义了一个矩形活动范围：
  - `xMin: z.number().default(-10),` —— X 方向最小值，默认 `-10`。
  - `xMax: z.number().default(10),` —— X 方向最大值，默认 `10`。
  - `yMin / yMax` 同理，Y 方向的 `-10` 到 `10`。
  - 即默认允许机器人在一个 20×20 的方形区域内活动。
  - **语法小课堂：负数 `-10` 怎么读？** `-` 是负号，`-10` 就是负十。没什么特别，只是数字。
- 这一块同样层层 `.default({})`，全可省略。

---

## 第 63 行：主 schema 结束

```typescript
});
```

- `}` 关闭最外层 `z.object({` 的花括号。
- `)` 关闭 `z.object(` 的圆括号。
- `;` 语句结束。

到这里，`RosClawConfigSchema` 这份"配置总表"就定义完了。

---

## 第 65 行：从 schema **反推**出 TS 类型

```typescript
export type RosClawConfig = z.infer<typeof RosClawConfigSchema>;
```

这一行很巧妙，是 Zod 最受欢迎的特性，逐部分拆：

- `export type RosClawConfig = ...` —— 导出一个**类型**叫 `RosClawConfig`。
- `z.infer<...>` —— `infer` 意思是"推断"。`z.infer<某个schema>` 的作用是：**自动从一个 Zod schema 推算出对应的 TS 静态类型**。
- `typeof RosClawConfigSchema` —— **语法小课堂：`typeof` 是什么？**
  - `RosClawConfigSchema` 是一个**值**（一个真实存在的常量对象）。
  - 但 `z.infer<...>` 尖括号里需要的是一个**类型**。
  - `typeof 某个值` 这个写法，作用是"取出这个值的类型"，把值"翻译"成类型，好让它能放进尖括号里。
- 整句合起来：**"看看 `RosClawConfigSchema` 这个 schema 描述的数据长啥样，自动生成一个对应的 TS 类型，命名为 `RosClawConfig`。"**

**为什么要这样做？** 这是为了**"单一事实来源"**：我们只在一个地方（Zod schema）描述配置结构，TS 类型自动跟着生成。如果以后改了 schema（比如加一个配置项），对应的 TS 类型会**自动更新**，永远不会和 schema 不一致。如果手动再写一遍 `interface`，就得改两处、容易忘记其一。

推断出来的 `RosClawConfig` 大致等价于：

```typescript
type RosClawConfig = {
  transport: { mode: "rosbridge" | "local" | "webrtc" };
  rosbridge: { url: string; reconnect: boolean; reconnectInterval: number };
  local: { domainId: number };
  // ...等等
};
```

注意：因为所有字段都有 `.default()`，推断出来的类型里这些字段都是**必有**的（不是可选的）——因为经过校验后它们一定有值了。

---

## 第 67-73 行：守门员函数 `parseConfig`

```typescript
/**
 * Parse and validate raw plugin config against the RosClaw schema.
 * Returns a fully-defaulted, typed config object.
 */
export function parseConfig(raw: Record<string, unknown>): RosClawConfig {
  return RosClawConfigSchema.parse(raw);
}
```

先看注释（第 67-70 行）：
> 根据 RosClaw schema 解析并校验"生的"插件配置。返回一个"补全了所有默认值的、带类型的"配置对象。

再看函数本体：

- `export function parseConfig(...)` —— **语法小课堂：`function` 怎么定义函数？**
  - `function` 是定义函数的关键字。
  - `parseConfig` 是函数名。
  - 括号里是参数，`): 类型` 是返回类型，花括号 `{ }` 里是函数体（真正执行的代码）。
- 参数 `raw: Record<string, unknown>` —— 接收一个"生的"配置对象。回忆上一章：`Record<string, unknown>` = "键是文字、值类型未知的对象"，正好描述"用户填的、还没校验的脏数据"。参数名取 `raw`（生的、未加工的）很贴切。
- 返回类型 `: RosClawConfig` —— 承诺"我会返回一个符合 `RosClawConfig` 类型的、干净的配置对象"。
- 函数体只有一行：
  - `return RosClawConfigSchema.parse(raw);`
  - **语法小课堂：`return` 是什么？** `return` 表示"把后面这个值作为函数的结果交出去，并结束函数"。
  - `RosClawConfigSchema.parse(raw)` —— 调用 schema 的 `.parse()` 方法，把生数据 `raw` 丢进去校验。`.parse()` 会做三件事：
    1. **校验**：检查每个字段类型对不对、枚举值合不合法。
    2. **补默认值**：缺的字段用 `.default(...)` 补上。
    3. **要么成功返回干净对象，要么直接抛出异常**：如果数据有无法接受的错误（比如 `mode` 填了 `"foobar"` 这种不在枚举里的值），`.parse()` 会**抛出错误（throw）**，整个插件加载就会失败并报错。
  - 这正是文档里强调的"**Zod 解析失败会直接抛出异常——插件不会带着错误配置悄悄运行**"。宁可一开始就响亮地报错，也不要带着坏配置偷偷跑起来导致更难查的问题。

> **`throw`（抛出异常）是什么？** 当代码遇到无法继续的错误，它可以"抛出"一个异常，就像拉响警报。如果没人"接住"（用 `try/catch`，后面文件会见到），程序就会中断并打印错误。这里我们故意不接住——配置错了就该让插件启动失败。

---

## 整章回顾

这个文件做了三件事：

1. **用 Zod 描述配置结构**（`RosClawConfigSchema`）——六大块配置，每项都带默认值，层层 `.default({})` 保证"全空也能跑"。
2. **从 schema 自动推断 TS 类型**（`RosClawConfig`）——一处定义，类型自动同步，杜绝不一致。
3. **提供守门员函数**（`parseConfig`）——把用户的脏数据校验+补全成干净配置，错就报错。

它和上一章的关系：上一章 `OpenClawPluginApi` 里有个 `pluginConfig?: Record<string, unknown>`（用户填的生配置）。我们拿到它之后，第一件事就是丢给这里的 `parseConfig` 洗干净，之后全程用洗干净的 `RosClawConfig`。这个交接动作发生在下一个要读的关键文件 `index.ts` 里。

**语法点回顾清单**（本章新增）：
- `const` / `let` / `var`：声明变量，本项目偏爱 `const`（不可变）
- 不带 `type` 的 `import { z } from "zod"`：导入运行时真实存在的值
- Zod 基础：`z.object` / `z.string` / `z.number` / `z.boolean` / `z.enum` / `z.array` / `z.union`
- 链式调用 `.方法().方法()`，尤其 `.optional()` 和 `.default(值)`
- 空对象 `{}`、空字符串 `""`、数组字面量 `[...]`
- `z.infer<typeof X>`：从 schema 反推类型
- `typeof 值`：把"值"翻译成"类型"
- `function 名字(参数): 返回类型 { ... }`：定义函数
- `return`：交出结果
- `throw` / 抛出异常的概念（Zod 校验失败时）

下一份：[`transport/types.ts` 逐行详解 →](03-transport-types.ts.md)（第三批开始进入传输层）
