# 逐行详解 ⑪：`transport/factory.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/factory.ts](../../extensions/openclaw-plugin/src/transport/factory.ts)
>
> 推荐阅读顺序第 11 个文件。它只有一个函数 `createTransport`——**"工厂（factory）"**：你把一份配置交给它，它看里头的 `mode` 字段，造出对应的传输适配器（rosbridge / local / webrtc 之一）。这篇会用上第③篇的"判别联合"，并第一次见到两个进阶语法：**动态 `import()`** 和 **`never` 穷举检查**。

---

## 先理解"工厂函数"是什么

回忆第③篇：`TransportConfig` 是个判别联合——它要么是 rosbridge 配置、要么是 local、要么是 webrtc，靠 `mode` 字段区分。第⑩篇我们写好了 rosbridge 的适配器 `RosbridgeTransport`。

但上层代码不想自己操心"该 `new` 哪个适配器"。于是有了**工厂**：给它配置，它替你判断 `mode`、`new` 出正确的那一个、返回出来。上层只管说"按这份配置给我一个传输"，至于底层是哪种，工厂内部消化。

```
config（带 mode 标签） ──> createTransport ──┬─ mode="rosbridge" → new RosbridgeTransport
                                            ├─ mode="local"     → new LocalTransport
                                            └─ mode="webrtc"    → new WebRTCTransport
```

---

## 第 1-2 行：导入（全是类型）

```typescript
import type { TransportConfig } from "./types.js";
import type { RosTransport } from "./transport.js";
```

- 两个都是 `import type`——只拿类型当标注：`TransportConfig`（入参类型）和 `RosTransport`（返回类型）。
- **注意**：这里**没有**用普通 `import` 把三个适配器类导进来。这是故意的——下面会用"动态 `import()`"按需加载，原因马上讲。

---

## 第 4-10 行：函数注释与签名

```typescript
/**
 * Create a RosTransport instance for the given deployment mode.
 *
 * Uses dynamic import() to load the correct adapter so that
 * unused adapters (and their dependencies) are never loaded.
 */
export async function createTransport(config: TransportConfig): Promise<RosTransport> {
```

- 注释翻译：「按给定部署模式创建一个 `RosTransport` 实例。**用动态 `import()` 只加载用到的那个适配器**，这样没用到的适配器（及其依赖）永远不会被加载。」——这句注释提前剧透了本篇的设计核心，下面会展开。
- `export async function createTransport(config: TransportConfig): Promise<RosTransport>` —— 导出一个 `async` 函数，吃一份 `TransportConfig`，返回 `Promise<RosTransport>`（造适配器涉及动态加载，是异步的，所以包 `Promise`）。

---

## 第 11 行：用判别联合开 `switch`

```typescript
  switch (config.mode) {
```

- 回忆第⑥篇的 `switch`：拿 `config.mode` 的值去逐个 `case` 匹配。
- 回忆第③篇的**类型收窄**：因为 `TransportConfig` 是判别联合、`mode` 是判别字段，所以进入每个 `case` 后，TS 会**自动确定 `config` 到底是哪种配置**——在 `case "rosbridge"` 里它知道 `config` 是 `RosbridgeTransportConfig`，于是 `config.rosbridge` 能安全访问。这正是判别联合的威力在真实代码里的体现。

---

## 第 12-15 行：`rosbridge` 分支（首见动态 `import()`）

```typescript
    case "rosbridge": {
      const { RosbridgeTransport } = await import("./rosbridge/adapter.js");
      return new RosbridgeTransport(config.rosbridge);
    }
```

- `case "rosbridge": {` —— 注意 `case` 后面跟了一对花括号 `{ }`。
  - **语法小课堂：给 `case` 套花括号 `{ }` 是为了开一个"块级作用域"。** 因为我们要在 `case` 里用 `const` 声明变量（`RosbridgeTransport`）。如果不套花括号，多个 `case` 里声明同名变量会冲突。套上 `{ }`，每个 `case` 的变量就关在自己的小房间里，互不打架。

- `const { RosbridgeTransport } = await import("./rosbridge/adapter.js");` —— 本篇重头戏：
  - **语法小课堂：动态 `import()`。** 我们之前见的 `import { X } from "..."`（写在文件顶部）是**静态导入**——文件一加载，所有静态导入的东西立刻全部加载进来。而 `import("...")` 写成**函数调用的样子**，是**动态导入**——它在**代码执行到这一行时**才去加载那个模块，并返回一个 Promise（所以前面要 `await`）。
  - **为什么要动态加载？** 看注释那句话：local 模式依赖 `rclnodejs`、webrtc 模式依赖一堆 WebRTC 库。如果用静态导入把三个适配器都写在文件顶部，那么**无论用户用哪种模式，三个适配器及其全部依赖都会被加载**——哪怕你只用 rosbridge，也被迫加载了 `rclnodejs`（可能根本没装，直接报错）。
  - 用动态 `import()` 后，**只有真正走到某个 `case` 才加载那一个适配器**。用 rosbridge 就只加载 rosbridge 适配器，碰都不碰 local/webrtc。这叫**按需加载（lazy loading）**，省内存、避免为没用的模式安装依赖。
  - `const { RosbridgeTransport } = ...` —— **对象解构**（回忆第⑥篇数组解构，这是对象版）：从加载进来的模块对象里，把名为 `RosbridgeTransport` 的导出"拆"出来。等价于"拿到那个模块，取它的 `RosbridgeTransport` 这一项"。
- `return new RosbridgeTransport(config.rosbridge);` —— `new` 出第⑩篇那个适配器，把 `config.rosbridge`（连接选项）喂给它的构造函数，返回。
  - 这里 `config.rosbridge` 能直接访问，全靠 `case "rosbridge"` 里 TS 已经收窄确定了 `config` 是 rosbridge 配置。

---

## 第 17-30 行：`local` 分支（含友好的错误处理）

```typescript
    case "local": {
      try {
        const { LocalTransport } = await import("./local/transport.js");
        return new LocalTransport(config.local);
      } catch (e: any) {
        if (e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND") {
          throw new Error(
            'Mode A (local) requires the "rclnodejs" package. ' +
              "Install it with: pnpm add rclnodejs (with ROS2 workspace sourced)",
          );
        }
        throw e;
      }
    }
```

- 主体和 rosbridge 一样：动态 `import` local 适配器、`new` 出来返回。但它包了 `try/catch`（回忆第②、⑥篇）来处理一个现实问题——**`rclnodejs` 可能没装**。
- `catch (e: any)` —— 抓住错误，命名为 `e`。
  - **语法小课堂：`e: any`。** `any` 是 TS 里"放弃类型检查"的逃生类型——标成 `any` 的值你爱怎么用就怎么用，TS 不管。catch 抓到的错误类型默认很模糊，这里标 `any` 图方便，好直接访问 `e.code`。（`any` 应少用，因为它关掉了类型保护，但在 catch 这种"啥错都可能"的场景常见。）
- `if (e?.code === "ERR_MODULE_NOT_FOUND" || e?.code === "MODULE_NOT_FOUND")` —— 判断这个错误是不是"模块没找到"：
  - `e?.code` —— 可选链（第⑥篇）：安全取错误的 `code` 字段（万一 `e` 不是对象也不崩）。
  - `=== "ERR_MODULE_NOT_FOUND" || ... === "MODULE_NOT_FOUND"` —— 用 `||`（或，第⑥篇）匹配两种可能的错误码（不同 Node 版本/场景报的码不一样，两个都认）。
- 若确实是"模块缺失"，就 `throw new Error(...)` **抛出一条人话错误**：告诉用户"local 模式需要 `rclnodejs` 包，请这样安装"。
  - 字符串用 `+` 拼接（回忆：`'...' + "..."` 把两段字符串接起来）。这比直接把 Node 原始的 `ERR_MODULE_NOT_FOUND` 甩给用户友好得多。
- `throw e;` —— 如果错误**不是**模块缺失（是别的问题），就**原样把它再抛出去**，别吞掉。
- **设计要点**：只有 local 分支做了这层"翻译错误"，因为只有它依赖一个"可能没装"的可选包 `rclnodejs`。rosbridge 是核心、依赖必装，不用这层保护。

---

## 第 32-35 行：`webrtc` 分支

```typescript
    case "webrtc": {
      const { WebRTCTransport } = await import("./webrtc/transport.js");
      return new WebRTCTransport(config.webrtc);
    }
```

- 和 rosbridge 分支同款：动态加载 webrtc 适配器、`new` 出来返回。（webrtc 目前是存根，第 30 篇会讲，但工厂这里照常写。）

---

## 第 37-40 行：`default` 分支 + `never` 穷举检查（本篇精华）

```typescript
    default: {
      const _exhaustive: never = config;
      throw new Error(`Unknown transport mode: ${(_exhaustive as TransportConfig).mode}`);
    }
  }
}
```

- `default:` —— `switch` 的兜底分支（前面所有 `case` 都没匹配上才走这）。
- `const _exhaustive: never = config;` —— **本篇最烧脑、也最妙的一行**。

**语法小课堂：`never` 类型与"穷举检查（exhaustiveness check）"。**
- `never` 是 TS 里一个特殊类型，意思是"**不可能存在的值**"。能赋给 `never` 的，只有"类型上根本不可能到达"的东西。
- 想想这里的逻辑：`config` 的类型是判别联合 `rosbridge | local | webrtc` 三选一。如果上面三个 `case` 已经把三种 `mode` **全覆盖**了，那么走到 `default` 时，`config` 在 TS 看来**剩下的可能性已经为空**——它的类型被收窄成了 `never`（没有任何一种 mode 没处理）。
- 此时 `const _exhaustive: never = config;` 能编译通过，因为 `config` 确实是 `never`。✅
- **关键在于"将来加新模式"时**：假设以后有人往 `TransportConfig` 加了第四种 `mode: "bluetooth"`，却**忘了**在这个 `switch` 里加对应 `case`。那么走到 `default` 时，`config` 还可能是 bluetooth 配置——它的类型**不是 `never`** 了（还剩 bluetooth 没处理）。于是 `const _exhaustive: never = config;` 会**编译报错**："bluetooth 配置不能赋给 never"。
- **这就是穷举检查的妙处**：它把"漏处理某个 case"从"运行时才发现的 bug"变成"**编译时立刻报错**"。等于让 TS 站岗：以后谁加了新模式忘了在这里处理，代码根本编译不过，强制你补上。`_exhaustive` 这个变量名（前缀 `_` 表示"我只是用来做检查、不真用它"）和注释惯例都在表达这个意图。

- `throw new Error(\`Unknown transport mode: ${(_exhaustive as TransportConfig).mode}\`);` —— 万一真在运行时走到了这里（比如配置是从外部 JSON 来的、绕过了类型检查、塞了个非法 mode），就抛错报告这个未知 mode。
  - 模板字符串 `` `...${...}` ``（第⑥篇）插值。
  - `(_exhaustive as TransportConfig).mode` —— `_exhaustive` 类型是 `never`，直接访问 `.mode` 不行（`never` 上没有任何属性），所以先 `as TransportConfig` 断言回联合类型，才能取它的 `.mode` 拼进错误信息。这是"为了打印出那个非法值"的小技巧。
- 两个 `}` 分别关闭 `default` 块和 `switch`，最后 `}` 关闭函数。

---

## 把工厂的两个设计亮点拎出来

这个小函数浓缩了两个值得记住的工程手法：

1. **动态 `import()` 按需加载**：只加载用到的那一个适配器，避免为没用的模式背上沉重依赖（尤其 local 的 `rclnodejs`）。判断标准：**当某些模块"很重"或"可能没装"、且不一定会用到时，用动态 import 延迟到真要用时再加载。**

2. **`never` 穷举检查**：在 `switch` 的 `default` 里写 `const _x: never = 那个判别变量;`，让 TS 在"将来漏处理某个分支"时**编译期就报错**。这是判别联合的标准搭档，几乎所有处理判别联合的 `switch` 都该配一个，等于免费上一道保险。

---

## 整章回顾

- `createTransport` 是传输层的"工厂"：吃一份 `TransportConfig`，按 `mode` 造出对应适配器返回。
- 它把第③篇的**判别联合 + 类型收窄**、第⑩篇的**适配器**，和两个新手法（**动态 import**、**`never` 穷举**）串在一起，是"前面零碎知识汇合"的一篇。
- local 分支额外做了**友好错误翻译**，因为它依赖可选包 `rclnodejs`。

**语法点回顾清单**（本章新增/巩固）：
- 动态 `import("...")`：执行到才加载、返回 Promise、按需加载（vs 顶部静态 import）
- 对象解构 `const { X } = 模块`（从模块/对象里拆出某项）
- `case "x": { ... }` 给 case 套花括号开块级作用域（好在里面用 `const`）
- `never` 类型 + 穷举检查：`const _e: never = 判别变量` 让漏分支在编译期报错
- `catch (e: any)`、`e?.code`、`||` 多条件、`throw new Error` 翻译错误、`throw e` 原样重抛
- 判别联合在 `switch` 里的类型收窄（巩固第③篇）

下一份：[`service.ts` 逐行详解 →](12-service.ts.md)（把工厂造出的传输接进插件的"服务"，管理连接生命周期）
