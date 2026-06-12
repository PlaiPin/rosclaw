# 逐行详解 ㉕：`commands/transport.ts`

> 对应源文件：[extensions/openclaw-plugin/src/commands/transport.ts](../../extensions/openclaw-plugin/src/commands/transport.ts)
>
> 推荐阅读顺序第 25 个文件，**第六部分的收尾、也是命令里最丰富的一个**（171 行）。`/transport` 让用户在聊天里查看或切换传输模式（如 `/transport webrtc`、`/transport rosbridge ws://...`）。它把第⑫篇的 `switchTransport` 接到用户手里，并第一次综合演示**命令行参数解析**、**`as const` 与类型守卫**、**配置覆盖（override）+ 类型转换**等几个进阶技巧。本篇略长，但都是前面学过的东西的组合，我们分块吃。

---

## 先把这个命令的用法搞清楚

`/transport` 有几种用法：
- `/transport` —— 不带参数：**显示当前**传输模式和状态。
- `/transport webrtc` —— 切换到 webrtc 模式（用配置里的默认连接参数）。
- `/transport rosbridge ws://192.168.1.5:9090` —— 切到 rosbridge，并**覆盖**连接地址。
- `/transport webrtc robotId=robot42` —— 切到 webrtc，并用 `key=value` 形式覆盖某个配置项。

所以这个命令要做三件事：**①解析用户输入的参数 ②校验模式合法 ③按参数拼出配置、调 `switchTransport` 切换**。文件里那一堆辅助函数就是分别干这些的。

---

## 第 1-5 行：导入

```typescript
import type { OpenClawPluginApi } from "../plugin-api.js";
import type { RosClawConfig } from "../config.js";
import type { TransportConfig } from "../transport/types.js";
import { getTransport, getTransportMode, switchTransport } from "../service.js";
import { clearDiscoveryCache } from "../context/robot-context.js";
```

- 三个 `import type`：宿主接口、整份配置、传输配置（第③篇判别联合）。
- 值导入：
  - `getTransport`、`getTransportMode`、`switchTransport` —— 第⑫篇 service 的三个函数（查传输、查模式、切换）。
  - `clearDiscoveryCache` —— 第23篇那个清能力缓存的函数。**为什么这里要它？** 因为切换传输后，机器人能力清单可能变了，得作废旧缓存，让下次对话重新发现。下面会用到。

---

## 第 7-12 行：合法模式列表 + 类型守卫（本篇第一个新点）

```typescript
const VALID_MODES = ["rosbridge", "local", "webrtc"] as const;
type Mode = (typeof VALID_MODES)[number];

function isValidMode(value: string): value is Mode {
  return (VALID_MODES as readonly string[]).includes(value);
}
```

这三行信息量很大，逐个拆。

### `as const`

```typescript
const VALID_MODES = ["rosbridge", "local", "webrtc"] as const;
```
- **语法小课堂：`as const` —— "把值锁成最具体的字面量类型"。**
  - 普通写 `const VALID_MODES = ["rosbridge", "local", "webrtc"];`，TS 推断它的类型是 `string[]`（一个普通字符串数组）——只知道"里面是字符串"，不记得具体是哪三个。
  - 加 `as const` 后，TS 把它**锁死**成"只读的、由这三个确切字面量组成的元组"：`readonly ["rosbridge", "local", "webrtc"]`。即 TS **记住了这个数组就是这仨值、且不可改**。
  - 好处：下面能从它**反推出精确的类型**（而不是泛泛的 string）。

### 从数组反推类型 `(typeof X)[number]`

```typescript
type Mode = (typeof VALID_MODES)[number];
```
- **语法小课堂：`(typeof 数组)[number]` —— 从数组值里抠出"元素类型"。** 拆成两步：
  - `typeof VALID_MODES` —— 取这个值的类型（回忆第②篇 `typeof 值`：值→类型）。因为有 `as const`，得到的是 `readonly ["rosbridge","local","webrtc"]`。
  - `[number]` —— **用"数字索引"去取它的元素类型**（回忆第⑫篇索引访问类型 `T["mode"]`，这是它的数组版：用 `[number]` 表示"任意下标处的元素"）。
  - 结果：`Mode` = `"rosbridge" | "local" | "webrtc"`（三个字面量的联合）。
- **这套组合拳的价值**：模式列表只写一次（`VALID_MODES`），类型 `Mode` 自动跟着它来。以后改列表，类型自动同步——又是"别重复自己"（回忆第⑫篇同样的精神）。

### 类型守卫 `value is Mode`

```typescript
function isValidMode(value: string): value is Mode {
  return (VALID_MODES as readonly string[]).includes(value);
}
```
- **语法小课堂：返回类型 `value is Mode` 是"类型守卫（type guard）"。**
  - 普通函数返回 `boolean`。这里返回 `value is Mode`——它仍是返回 true/false，但**额外告诉 TS：当这函数返回 true 时，传进去的 `value` 就是 `Mode` 类型**。
  - 作用：调用处 `if (isValidMode(x))` 成立的分支里，TS 会把 `x` 从 `string` **收窄成 `Mode`**。这样后面就能安全地把 `x` 当作三选一的模式用。
  - 这是"用一个运行时检查，同时给 TS 喂类型信息"的标准手法。
- 函数体 `(VALID_MODES as readonly string[]).includes(value)`：
  - **语法小课堂：`数组.includes(x)` —— 判断数组里有没有 x**，返回 true/false。这里看 `value` 是不是那三个合法模式之一。
  - `VALID_MODES as readonly string[]` —— 一个小技术细节：`VALID_MODES` 因为 `as const` 是"只含那仨字面量的元组"，直接 `.includes(任意字符串)` 会被 TS 嫌弃（"这字符串不可能是那仨之一"）。先 `as readonly string[]` 把它当普通只读字符串数组看，`.includes` 才能接受任意字符串来查。

> 这三行合起来：**定义一份"唯一可信的模式列表"，从它派生出类型 `Mode`，再用类型守卫把"运行时检查"和"类型收窄"绑在一起。** 是 TS 里处理"一组合法字符串值"的经典范式。

---

## 第 14-60 行：注册命令 + handler 主流程

### 第 17-23 行：注册 + 取参数

```typescript
export function registerTransportCommand(api: OpenClawPluginApi, config: RosClawConfig): void {
  api.registerCommand({
    name: "transport",
    description: "Show or switch the ROS2 transport mode (rosbridge, webrtc, local)",

    async handler(ctx) {
      const args = (ctx.args ?? "").trim();
```

- `registerCommand` 同第24篇。命令名 `transport`、说明写给人。
- `async handler(ctx)` —— **这次用到了 `ctx`**（不像 estop 加 `_`），因为要读用户输入的参数。
- `const args = (ctx.args ?? "").trim();` —— 取用户在 `/transport` 后面打的参数串：
  - `ctx.args` —— 命令的参数部分（回忆第①篇 `CommandContext` 有 `args?`）。可能没有（`undefined`）。
  - `?? ""` —— 没有就当空字符串（第⑥篇空值合并）。
  - `.trim()` —— 去掉首尾空格（第23篇见过）。比如用户打 `/transport  webrtc ` → `args` 变成干净的 `"webrtc"`。

### 第 25-28 行：无参数 → 显示状态

```typescript
      // No args → show current status
      if (!args) {
        return showStatus();
      }
```

- `if (!args)` —— 真值判断：参数是空字符串（用户只打了 `/transport`）就 `!args` 为 true。
- `return showStatus();` —— 调辅助函数显示当前状态（下面讲），把它的返回值直接返回。

### 第 30-38 行：解析模式 + 校验

```typescript
      // Parse mode from first arg
      const parts = args.split(/\s+/);
      const modeArg = parts[0];

      if (!isValidMode(modeArg)) {
        return {
          text: `Unknown transport mode: "${modeArg}". Valid modes: ${VALID_MODES.join(", ")}`,
        };
      }
```

- `const parts = args.split(/\s+/);` —— **把参数串按空白切成数组**。
  - **语法小课堂：`字符串.split(分隔符)` —— 按分隔符拆成数组。** 比如 `"webrtc robotId=x".split(...)` → `["webrtc", "robotId=x"]`。
  - **语法小课堂：`/\s+/` 是"正则表达式"。** 两个 `/` 之间是一个**正则**（匹配文本的模式）。`\s` 表示"空白字符"（空格、Tab 等），`+` 表示"一个或多个"。所以 `/\s+/` 匹配"一段连续空白"——用它当分隔符，多个空格也能正确切开。（正则是个大主题，这里只需知道 `/\s+/` = 按空白分割。）
- `const modeArg = parts[0];` —— 第一段就是模式名（数组下标 0，第⑥篇）。
- `if (!isValidMode(modeArg))` —— **用上面那个类型守卫校验**。不合法就：
  - 返回 `{ text: ... }` 报错，列出合法模式。
  - `VALID_MODES.join(", ")` —— **语法小课堂：`数组.join(分隔符)` —— 把数组拼成字符串**（`.split` 的逆操作）。`["rosbridge","local","webrtc"].join(", ")` → `"rosbridge, local, webrtc"`。用来友好地列出选项。
- **关键**：通过这个 `if` 之后，因为 `isValidMode` 是类型守卫，**TS 已经把 `modeArg` 收窄成 `Mode` 类型**了——后面就能放心把它当三选一用。

### 第 40-46 行：拼配置（可能抛错）

```typescript
      // Build TransportConfig from base config + overrides
      let transportConfig: TransportConfig;
      try {
        transportConfig = buildTransportConfig(modeArg, parts.slice(1), config);
      } catch (err) {
        return { text: `Invalid arguments: ${String(err)}` };
      }
```

- `let transportConfig: TransportConfig;` —— 先声明后赋值（第⑫篇）。
- `buildTransportConfig(modeArg, parts.slice(1), config)` —— 调辅助函数拼出完整传输配置：
  - `modeArg` —— 模式（已是 `Mode` 类型）。
  - `parts.slice(1)` —— **`.slice(1)` 取数组从下标 1 到末尾**（回忆第⑩篇 `.slice`，这是数组版）。即"模式名之后的所有参数"，也就是那些覆盖项。
  - `config` —— 基础配置。
- 包在 `try/catch` 里：拼配置时若参数非法（如未知配置键），`buildTransportConfig` 会 `throw`，这里接住、返回友好错误。

### 第 48-57 行：执行切换

```typescript
      // Perform the switch
      try {
        await switchTransport(transportConfig, api.logger);
        clearDiscoveryCache();
        return { text: formatSwitchSuccess(transportConfig) };
      } catch (err) {
        return {
          text: `Failed to switch transport: ${String(err)}\nYou can retry with /transport ${modeArg}`,
        };
      }
    },
  });
}
```

- `await switchTransport(transportConfig, api.logger);` —— **调第⑫篇那个热切换函数**（断旧连新、带并发门闩）。命令到这里才真正动手切换。
- `clearDiscoveryCache();` —— 切换成功后清空能力缓存（第23篇），因为换了传输、能力可能变，强制下次重新发现。
- `return { text: formatSwitchSuccess(transportConfig) };` —— 返回成功消息（调辅助函数格式化，下面讲）。
- `catch (err)` —— 切换失败（连不上等）：返回友好错误，**还贴心地提示"可以用 `/transport <模式>` 重试"**（回忆第⑫篇 `switchTransport` 注释说"失败不回滚、用户重试"——这里就是那句"重试"的落地）。
- 注意 `\n` 让错误信息换行（第23篇）。

---

## 第 62-76 行：`showStatus`——显示当前状态

```typescript
function showStatus(): { text: string } {
  const mode = getTransportMode();

  if (!mode) {
    return { text: "Transport: not active" };
  }

  try {
    const transport = getTransport();
    const status = transport.getStatus();
    return { text: `Transport: ${mode} (${status})` };
  } catch {
    return { text: `Transport: ${mode} (unknown status)` };
  }
}
```

- 返回类型写成 `{ text: string }`（和命令结果同形）。
- `const mode = getTransportMode();` —— 查当前模式（第⑫篇，可能 `null`）。
- `if (!mode)` —— 没有活动传输，回"not active"。
- 否则 `try` 里查具体连接状态：`getStatus()`（第④/⑩篇），拼成 `Transport: webrtc (connected)` 这样。
- `catch {}` —— **空 catch**（第23篇）：万一查状态出错也无所谓，退回显示 `(unknown status)`。**查状态是只读小事，失败就给个模糊答案，不值得报错。**

---

## 第 78-136 行：`buildTransportConfig`——按模式拼配置 + 应用覆盖

这是最长的辅助函数，但骨架是第⑫篇见过的 `switch (mode)`。

### 签名

```typescript
function buildTransportConfig(
  mode: Mode,
  overrides: string[],
  config: RosClawConfig,
): TransportConfig {
  switch (mode) {
```
- 吃模式、覆盖参数数组、基础配置，返回拼好的 `TransportConfig`。
- `switch (mode)` —— 按三种模式分别处理。因为 `mode` 是 `Mode`（三选一），三个 case 穷尽，**不用 default**（第⑫篇讲过的"穷尽即可省 default"）。

### rosbridge 分支（第 87-104 行，最完整）

```typescript
    case "rosbridge": {
      const base = { ...config.rosbridge };

      for (const arg of overrides) {
        if (arg.startsWith("ws://") || arg.startsWith("wss://")) {
          // Positional URL override
          base.url = arg;
        } else if (arg.includes("=")) {
          const [key, ...rest] = arg.split("=");
          const value = rest.join("=");
          applyOverride(base, key, value);
        } else {
          throw new Error(`Unexpected argument: "${arg}"`);
        }
      }

      return { mode: "rosbridge", rosbridge: base };
    }
```

- `const base = { ...config.rosbridge };` —— **语法小课堂：`{ ...对象 }` 是"展开（spread）"——浅拷贝一个对象。**
  - `...config.rosbridge` 把原配置的所有字段"摊开"复制进一个新对象 `base`。
  - **为什么要拷贝、不直接改 `config.rosbridge`？** 因为我们要往 `base` 上应用用户的覆盖项，但**不想污染原始配置**（原配置后面可能还要用）。拷一份改副本，是安全的做法。（回忆第⑫篇"先存局部变量再提交"的同款谨慎。）
- `for (const arg of overrides)` —— 遍历每个覆盖参数（第⑥篇 `for...of`）。对每个 `arg` 三种情况：
  1. `if (arg.startsWith("ws://") || arg.startsWith("wss://"))` —— 是个 WebSocket 地址（以 `ws://`/`wss://` 开头，第⑥篇 `.startsWith`）→ **位置式覆盖**：直接当作 url，`base.url = arg`。这让用户能简写 `/transport rosbridge ws://...` 而不必写 `url=ws://...`。
  2. `else if (arg.includes("="))` —— 含等号 → **key=value 式覆盖**：
     - **语法小课堂：`字符串.includes(x)` 判断是否包含子串**（和数组的 `.includes` 同名、用在字符串上）。
     - `const [key, ...rest] = arg.split("=");` —— 按 `=` 切开，**用数组解构 + 剩余元素 `...rest`**：
       - **语法小课堂：解构里的 `...rest`（剩余元素）。** `[key, ...rest]` 把第一段给 `key`，**其余所有段收进数组 `rest`**。
       - **为什么要 `...rest` 而不是 `[key, value]`？** 因为值里可能**也含 `=`**（如 `token=ab=cd`）。`split("=")` 会切成 `["token","ab","cd"]`；`key="token"`、`rest=["ab","cd"]`。
     - `const value = rest.join("=");` —— 再用 `=` 把 `rest` 拼回去（`"ab=cd"`）。**先按 = 切、第一段当键、剩下的用 = 拼回当值**——这样值里的 `=` 不会丢。是处理"键=值，值里可能有等号"的标准技巧。
     - `applyOverride(base, key, value);` —— 调下个函数应用这条覆盖（带类型转换）。
  3. `else { throw new Error(...) }` —— 既不是地址也不是 key=value → 非法参数，抛错（被上面 handler 的 try 接住）。
- 最后 `return { mode: "rosbridge", rosbridge: base };` —— 拼成判别联合的 rosbridge 成员（第③篇）返回。

### webrtc / local 分支（第 106-134 行）

- 这两个分支结构相同、比 rosbridge 简单：**只接受 key=value 形式**（没有"位置式 url"那种特例），不是 key=value 就抛错。
- 各自 `{ ...config.webrtc }` / `{ ...config.local }` 拷贝、遍历应用覆盖、返回对应判别联合成员。
- 重复三段而非强行合并——因为每个模式的特例不同（rosbridge 有 url 简写），分开写更清楚。

---

## 第 138-158 行：`applyOverride`——把字符串值转成正确类型（很妙）

```typescript
function applyOverride(obj: Record<string, unknown>, key: string, value: string): void {
  if (!(key in obj)) {
    throw new Error(`Unknown config key: "${key}"`);
  }

  const existing = obj[key];

  // Coerce value to match existing type
  if (typeof existing === "number") {
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`"${key}" expects a number, got "${value}"`);
    }
    obj[key] = num;
  } else if (typeof existing === "boolean") {
    obj[key] = value === "true";
  } else {
    obj[key] = value;
  }
}
```

这个函数解决一个实际问题：**用户输入的永远是字符串**（命令行就是文本），但配置项可能要数字或布尔。得"按原值的类型，把字符串转过去"。

- `if (!(key in obj))` —— **语法小课堂：`键 in 对象` 判断对象有没有这个键。** 没有这个配置项就抛错"未知配置键"——防止用户瞎写。
  - `!(key in obj)` 整体加括号取反："不存在这个键"。
- `const existing = obj[key];` —— 取出该键**现有的值**，用它的类型当"目标类型"。
- 按 `existing` 的类型分三种转换（`typeof`，回忆第②⑥篇）：
  - **是数字**：`const num = Number(value);` —— **`Number("3.5")` 把字符串转成数字**。
    - `if (Number.isNaN(num))` —— **语法小课堂：`Number.isNaN(x)` 判断是不是 NaN（Not a Number，非数字）。** 如果用户填了 `"abc"`，`Number("abc")` 得到 `NaN`，这里就抛错"期望数字"。`NaN` 是"转换失败"的标志。
    - 转换成功就 `obj[key] = num`。
  - **是布尔**：`obj[key] = value === "true";` —— 把字符串 `"true"` 转成布尔 `true`、其余转成 `false`。简单直接。
  - **否则（字符串等）**：`obj[key] = value;` —— 原样存字符串。
- **这个函数的智慧**：以现有配置值的类型为准，把用户输入的字符串"强制对齐"成对的类型，并在转不动时报错。这样 `/transport rosbridge timeout=5000` 里的 `"5000"` 会正确变成数字 5000，而不是字符串。

---

## 第 160-171 行：`formatSwitchSuccess`——拼成功消息

```typescript
function formatSwitchSuccess(config: TransportConfig): string {
  switch (config.mode) {
    case "rosbridge":
      return `Switched to rosbridge transport (${config.rosbridge.url})`;
    case "webrtc": {
      const robotId = config.webrtc.robotId;
      return `Switched to webrtc transport (robotId: ${robotId})`;
    }
    case "local":
      return `Switched to local transport (domainId: ${config.local?.domainId ?? 0})`;
  }
}
```

- 按模式拼一句不同的成功提示（`switch` + 判别联合类型收窄，第③⑪篇——每个 case 里能安全访问对应字段）。
- `config.local?.domainId ?? 0` —— 可选链 + 空值合并（第⑥篇）：安全取 `domainId`，没有就显示 0。
- webrtc 那个 case 套了 `{ }` 块（因为里面用 `const` 声明了 `robotId`，回忆第⑪篇"case 里用 const 要套花括号"）；另两个 case 直接 return，不需要。

---

## 整章回顾

`/transport` 是命令里最丰富的一个，把"解析→校验→拼配置→切换"串成完整流程：

| 步骤 | 谁做 | 关键技巧 |
|---|---|---|
| 取参数 | handler | `ctx.args ?? ""`、`.trim()`、`.split(/\s+/)` |
| 校验模式 | `isValidMode` | `as const` + 派生类型 `Mode` + 类型守卫收窄 |
| 拼配置 | `buildTransportConfig` | `{...spread}` 拷贝、`for...of` 应用覆盖、`[key,...rest]` 解析 key=value |
| 类型转换 | `applyOverride` | 按现有值的 `typeof` 把字符串转 number/boolean，`Number.isNaN` 校验 |
| 切换 | handler | `await switchTransport`（第⑫篇）+ `clearDiscoveryCache`（第23篇）+ 失败提示重试 |

无参数时则走 `showStatus` 显示当前模式与状态。

**语法点回顾清单**（本章新增/巩固）：
- **`as const`**：把数组/值锁成只读字面量类型（让类型可从值派生）
- **从数组派生类型 `(typeof 数组)[number]`**（元素联合类型）
- **类型守卫 `function f(x): x is T`**：运行时检查 + 让 TS 收窄类型
- `数组.includes` / `字符串.includes`（是否包含）、`数组.join` / `字符串.split`（拼/拆）、`.slice(1)`（数组切片）
- 正则 `/\s+/`（匹配连续空白，用作分隔符）—— 仅需知其义
- 解构剩余元素 `const [key, ...rest] = ...`（处理"值里也含 = "）
- `{ ...对象 }` 展开浅拷贝（改副本不污染原配置）
- `键 in 对象`（判断有无该键）、`typeof` 分支转换、`Number(value)` 转数字、`Number.isNaN` 校验、`value === "true"` 转布尔
- `switch` + 判别联合收窄、case 用 `const` 套 `{}`（巩固第③⑪篇）

---

## 🎉 第六部分（钩子与命令）讲完！

到这里，**插件的三种交互方式全部讲透**：

> **工具**（AI 调，14–21）+ **钩子**（按时机自动触发，22–23）+ **命令**（用户直接打，24–25）。

加上前面的骨架（1–13），**整个 `@rosclaw/openclaw-plugin` 插件——以 rosbridge 为传输——你已经从头到尾、逐行读完了！** 这是项目的主体和精华。

接下来**第七部分**转向**另外两种传输模式**（模式 A 本地 DDS、模式 C WebRTC）——它们和 rosbridge 实现的是同一套 `RosTransport` 接口（第④篇），所以你已经懂它们"该长什么样"，读起来会有"换汤不换药"的熟悉感，同时会接触一些新东西（如 `rclnodejs`、WebRTC 信令）。

下一份：[`transport/local/transport.ts` 逐行详解 →](26-local-transport.ts.md)（模式 A：在同一台机器上直接用 DDS，不经 rosbridge——本系列最后会补的 `createRequire`/CommonJS 互操作在此登场）
