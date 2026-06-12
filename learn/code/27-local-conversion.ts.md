# 逐行详解 ㉗：`transport/local/conversion.ts`

> 对应源文件：[extensions/openclaw-plugin/src/transport/local/conversion.ts](../../extensions/openclaw-plugin/src/transport/local/conversion.ts)
>
> 推荐阅读顺序第 27 个文件。它是上一篇 `LocalTransport` 反复用到的"翻译官"：把**普通 JS 对象**（上层和 `RosTransport` 接口用的 `Record<string, unknown>`）和 **rclnodejs 的类型化消息实例**互相转换。难点不在语法，而在第一次正经接触**递归（recursion）**——因为消息会嵌套（如 `Twist.linear` 是个 `Vector3` 子消息），转换得"层层钻进去"。本篇把递归讲透。

---

## 先理解为什么需要"转换"

- 上层（工具、接口）说的是"普通话"：`{ linear: { x: 0.5 } }` 这种朴素 JS 对象。
- rclnodejs 说的是"方言"：它要的是 `new Twist()` 那种**带类型的消息实例**（有固定字段、有 setter）。
- 两边语言不通，需要翻译官：
  - **发消息时**：普通对象 → rclnodejs 实例（`toRosMessage`）。
  - **收消息时**：rclnodejs 实例 → 普通对象（`fromRosMessage`）。
- 注释里说这"类似 rosbridge_library 的 `dict_to_msg` / `msg_to_dict`"——同样的翻译活，ROS2 各语言库都得做一遍。

---

## 第 1-22 行：模块注释 + createRequire + 加载/缓存机制

```typescript
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Cached message classes keyed by normalized type string. */
const typeCache = new Map<string, any>();

function getRclnodejs(): any {
  return require("rclnodejs");
}
```

- `createRequire`（第26篇刚学）—— 这个文件也要加载 CJS 的 rclnodejs，所以自己也造一个 `require`。
- `const typeCache = new Map<string, any>();` —— **模块级缓存**（第⑫篇模块级变量 + 第⑥篇 Map）：键是类型字符串、值是加载来的消息类。
  - **为什么缓存？** 加载一个 ROS2 消息类有开销，同一类型反复用（每次发 Twist 都要它）。缓存后第二次直接取，省事。这和第23篇能力缓存、第28篇实体缓存是同一种"算一次记住"的思路。
- `getRclnodejs()` —— 一个小包装，返回加载来的 rclnodejs。包一层是为了"想拿 rclnodejs 都走这个口"，统一。

---

## 第 24-35 行：`normalizeType`——把类型字符串规整成统一格式

```typescript
function normalizeType(typeStr: string): string {
  const parts = typeStr.split("/");
  // Already fully qualified: "pkg/msg/Type" or "pkg/srv/Type" or "pkg/action/Type"
  if (parts.length === 3) return typeStr;
  // Short form: "pkg/Type" → assume msg
  if (parts.length === 2) return `${parts[0]}/msg/${parts[1]}`;
  return typeStr;
}
```

- 解决一个现实问题：ROS2 类型字符串有几种写法，rclnodejs 要的是**完整三段式** `包/msg/类型`。但上层可能传简写。这个函数把它们**规整成统一格式**。
- `const parts = typeStr.split("/");` —— 按 `/` 切开（第25篇 `.split`）。如 `"geometry_msgs/msg/Twist"` → `["geometry_msgs", "msg", "Twist"]`。
- `if (parts.length === 3) return typeStr;` —— **已经是三段**（完整的 `pkg/msg/Type`），原样返回。
- `if (parts.length === 2) return \`${parts[0]}/msg/${parts[1]}\`;` —— **只有两段**（简写 `pkg/Type`），中间补个 `msg` 凑成三段（默认当消息类型）。模板字符串拼接。
- 其余情况原样返回（兜底）。
- **小结**：这是一个"输入容错"——不管上层写完整还是简写，都规整成 rclnodejs 认的样子。

---

## 第 37-49 行：`loadMessageClass`——加载消息类（带缓存）

```typescript
export function loadMessageClass(typeStr: string): any {
  const normalized = normalizeType(typeStr);
  const cached = typeCache.get(normalized);
  if (cached) return cached;

  const rclnodejs = getRclnodejs();
  const cls = rclnodejs.require(normalized);
  typeCache.set(normalized, cls);
  return cls;
}
```

- 这是第26篇反复调用的那个 `loadMessageClass`。逻辑是标准的"**缓存读取模式**"：
  1. `normalizeType` 规整类型字符串。
  2. `typeCache.get(normalized)` 查缓存，命中（`if (cached)`）就直接返回。
  3. 没命中：`rclnodejs.require(normalized)` 真正加载这个消息类，存进缓存，再返回。
- **这个"先查缓存、没有才算、算完存起来"的三步，和第23篇 `discoverCapabilities` 开头的缓存判断、第28篇 `getPublisher` 一模一样**——是个反复出现的通用套路，认得它即可。

---

## 第 51-62 行：`toRosMessage`——普通对象 → rclnodejs 实例

```typescript
export function toRosMessage(typeStr: string, obj: Record<string, unknown>): any {
  const MessageClass = loadMessageClass(typeStr);
  const msg = new MessageClass();
  assignFields(msg, obj);
  return msg;
}
```

- 三步：加载类 → `new` 一个空实例 → 把普通对象 `obj` 的字段**赋到实例上**（靠 `assignFields`，下面是重点）→ 返回。
- 为什么不直接 `Object.assign` 一把梭？因为消息**有嵌套子消息**，得递归处理。这就引出 `assignFields`。

---

## 第 64-89 行：`assignFields`——递归赋值（本篇核心，递归首秀）

```typescript
function assignFields(target: any, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;

    if (typeof value === "object" && !Array.isArray(value)) {
      // Nested sub-message ...
      if (target[key] !== undefined && target[key] !== null && typeof target[key] === "object") {
        assignFields(target[key], value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    } else if (Array.isArray(value)) {
      target[key] = value;
    } else {
      target[key] = value;
    }
  }
}
```

**先讲"递归"这个概念**：

> **语法小课堂：递归（recursion）—— 函数自己调用自己。**
> 当一个问题"可以拆成同类的小问题"时，就用递归。这里：给一个消息赋值 = 给它的每个字段赋值；而某个字段如果**本身又是个子消息**，那"给子消息赋值"又是同一个问题——于是 `assignFields` **调用 `assignFields` 处理子消息**。像俄罗斯套娃，一层层钻进去，直到字段是简单值（不能再拆）为止。

逐行拆：

- `for (const [key, value] of Object.entries(source))` —— 遍历普通对象的每个字段（`Object.entries`，第26篇）。
- `if (value === undefined || value === null) continue;` —— 值是空的就**跳过**（`continue`，第⑥篇：跳过本轮、继续下一个字段）。不赋空值。
- 然后按 `value` 的种类分三路：
  1. **是对象、且不是数组**（`typeof value === "object" && !Array.isArray(value)`，回忆第⑥篇 `typeof`；`Array.isArray` 判断是不是数组）——这说明它是个**嵌套子消息**（如 Twist 的 `linear`）：
     - `if (target[key] 已存在且也是对象)` —— rclnodejs new 出来的实例，子消息字段通常**已经被初始化成默认子消息实例**了。这种情况就 **`assignFields(target[key], value)` 递归**——钻进这个子消息，把 `value` 的字段赋进去。**这就是递归调用本身。**
     - `else { target[key] = value; }` —— 否则（目标没有这个子字段实例）直接赋值。
  2. **是数组**（`Array.isArray(value)`）—— 直接赋值。注释解释：数组元素可能是基本类型或子消息，但 rclnodejs 的 setter 能自己处理基本类型数组和类型化数组的强转，所以这里**先简单直接赋**（注释也坦承这对"嵌套消息数组"是简化处理——又是一个诚实标注的取舍）。
  3. **其余**（数字、字符串、布尔等简单值）—— 直接 `target[key] = value;`。**这是递归的"底"**：简单值不能再拆，赋上就结束这一支。
- **理解递归的关键**：每次遇到"子消息"就往里钻一层（情况1的递归），遇到"简单值/数组"就赋值收尾（情况2、3）。一个嵌套对象就这样被层层赋值填满。

> **举个具体例子**：`toRosMessage("Twist", { linear: { x: 0.5 }, angular: { z: 1.0 } })`
> - 外层 `assignFields(twistMsg, {linear:..., angular:...})`：
>   - 字段 `linear` 是对象 → 递归 `assignFields(twistMsg.linear, {x:0.5})`：
>     - 字段 `x` 是数字 → `twistMsg.linear.x = 0.5`（到底，收尾）
>   - 字段 `angular` 是对象 → 递归 `assignFields(twistMsg.angular, {z:1.0})`：
>     - 字段 `z` 是数字 → `twistMsg.angular.z = 1.0`（到底）
> - 钻了两层，把嵌套对象完整搬进了类型化消息。

---

## 第 91-107 行：`fromRosMessage`——rclnodejs 实例 → 普通对象（反方向）

```typescript
export function fromRosMessage(msg: any): Record<string, unknown> {
  if (msg === null || msg === undefined) return {};

  // Preferred path: rclnodejs provides toPlainObject()
  if (typeof msg.toPlainObject === "function") {
    return msg.toPlainObject() as Record<string, unknown>;
  }

  // Fallback: manual extraction
  return extractFields(msg);
}
```

- 反方向：把 rclnodejs 消息转回普通对象。
- `if (msg === null || msg === undefined) return {};` —— 空的就返回空对象，省得后面崩。
- **优先用库自带的快捷方式**：`if (typeof msg.toPlainObject === "function")` —— 新版 rclnodejs 自带 `toPlainObject()` 方法，能一键转普通对象。**有就用它**（`typeof ... === "function"` 检查方法存在，第⑥篇/第26篇）。
- **没有就降级**到手工提取 `extractFields`（下面）。这又是"优先用现成的、不行再兜底"的降级思想（第23篇）。

---

## 第 109-146 行：`extractFields`——手工递归提取（反方向的递归）

```typescript
function extractFields(msg: any): Record<string, unknown> {
  if (msg === null || msg === undefined) return {};
  if (typeof msg !== "object") return {};

  const result: Record<string, unknown> = {};

  const keys = Object.keys(msg);
  for (const key of keys) {
    if (key.startsWith("_")) continue;

    const value = msg[key];
    if (typeof value === "function") continue;

    if (value === null || value === undefined) {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value.map((item: any) =>
        typeof item === "object" && item !== null ? extractFields(item) : item,
      );
    } else if (typeof value === "object") {
      if (value.constructor && value.constructor.name !== "Object") {
        result[key] = extractFields(value);
      } else {
        result[key] = value;
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}
```

和 `assignFields` 镜像——也是递归，但方向相反（从类型化实例**抽**字段到普通对象）。

- 开头两个守卫：空的或非对象，返回空对象。
- `const result = {};` —— 准备一个空普通对象装结果。
- `const keys = Object.keys(msg);` —— **语法小课堂：`Object.keys(对象)` 取对象所有键名的数组**（`Object.entries` 的"只要键"版）。
- 遍历每个键，先两道**跳过**：
  - `if (key.startsWith("_")) continue;` —— 跳过下划线开头的（内部/私有属性，rclnodejs 实例上有些内部字段，不要）。
  - `if (typeof value === "function") continue;` —— 跳过方法（只要数据，不要函数）。
- 然后按值的种类分路（和 `assignFields` 对称）：
  - **空值** → 原样记下。
  - **数组** → `value.map(...)`：对每个元素，**是对象就递归 `extractFields(item)`、否则原样**（`.map` + 三元，第⑩篇）。这处理"子消息数组"——每个子消息也要转成普通对象。
  - **对象** → 判断 `value.constructor.name !== "Object"`：
    - **语法小课堂：`value.constructor.name` 看"这个对象是哪个类造出来的"。** 普通 JS 对象 `{}` 的 `constructor.name` 是 `"Object"`；而 rclnodejs 的子消息实例是别的类（如 `"Vector3"`）。
    - 如果**不是普通 Object**（是个类型化子消息）→ 递归 `extractFields(value)` 钻进去提取。
    - 是普通对象 → 直接记下。
  - **其余简单值** → 直接记下（递归的底）。
- 返回填好的 `result`。
- **和 `assignFields` 对照看**：一个"往类型化实例里塞"（递归点是"目标字段已是子消息实例"），一个"从类型化实例里抽"（递归点是"值是非普通对象"）。两个递归方向相反、判断子消息的依据不同，但"遇嵌套就钻、遇简单值就收"的递归骨架完全一样。

---

## 第 148-153 行：`clearTypeCache`——清缓存

```typescript
export function clearTypeCache(): void {
  typeCache.clear();
}
```

- 把类型缓存清空（`Map.clear()`，第⑥篇）。第26篇 `disconnect` 时调它——断开连接就把缓存的消息类释放掉。

---

## 整章回顾

`conversion.ts` 是本地模式的"翻译官"，三对核心能力：

| 函数 | 方向 | 关键 |
|---|---|---|
| `loadMessageClass` | 取消息类 | 规整类型字符串 + `typeCache` 缓存（算一次记住） |
| `toRosMessage` → `assignFields` | 普通对象 → 类型化实例 | **递归**把嵌套字段层层赋进去 |
| `fromRosMessage` → `extractFields` | 类型化实例 → 普通对象 | 优先 `toPlainObject()`，否则**递归**层层抽出来 |

最大的收获是**递归**：当数据是"可嵌套同类结构"时（消息里套子消息），用"函数调用自己处理子结构"来层层穿透——遇嵌套就钻进去、遇简单值就赋值收尾。

**语法点回顾清单**（本章新增/巩固）：
- **递归：函数调用自己处理"同类的子结构"**（`assignFields`/`extractFields` 处理嵌套子消息）
- `Array.isArray(x)`（是否数组）、`Object.keys(对象)`（所有键名）、`value.constructor.name`（对象由哪个类造）
- 缓存读取套路：查缓存→命中即返→未命中则算+存（`loadMessageClass`，呼应第23、28篇）
- 降级：优先用库的 `toPlainObject()`，没有才手工 `extractFields`（呼应第23篇）
- `continue` 跳过不需要的字段（空值/方法/下划线私有）
- `.split("/")` + `parts.length` 判断格式、模板串补全（巩固第25篇）
- `typeof x === "function"` 判断方法是否存在（巩固第26篇）

下一份：[`transport/local/entities.ts` 逐行详解 →](28-local-entities.ts.md)（实体缓存：把 rclnodejs 的发布器/订阅器/服务客户端缓存复用，本地模式三大件中最后一块）
