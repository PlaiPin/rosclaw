/**
 * CDR encode/decode for ROS 2 messages over Zenoh (rmw_zenoh uses CDR payloads).
 * Supports geometry_msgs/msg/Twist, sensor_msgs/msg/Image, sensor_msgs/msg/CompressedImage.
 */

import { CdrReader, CdrWriter } from "@foxglove/cdr";
import { EncapsulationKind } from "@foxglove/cdr";

const CDR_LE = EncapsulationKind.CDR_LE;

/** Normalize type string to "pkg/msg/Type" form. Handles short names (e.g. "Image") and combined forms. */
function normalizeType(typeStr: string): string {
  const s = typeStr.trim();
  if (s.includes("CompressedImage")) return "sensor_msgs/msg/CompressedImage";
  if (s === "Image" || s.endsWith("/Image") || (s.includes("sensor_msgs") && s.includes("Image"))) {
    return "sensor_msgs/msg/Image";
  }
  const parts = s.split("/");
  if (parts.length === 3) return s;
  if (parts.length === 2) return `${parts[0]}/msg/${parts[1]}`;
  return s;
}

/** Read std_msgs/Header from current reader offset (used by Image and CompressedImage). */
function readStdMsgsHeader(reader: CdrReader): Record<string, unknown> {
  const sec = reader.int32();
  const nanosec = reader.uint32();
  const frame_id = reader.string();
  return {
    stamp: { sec, nanosec },
    frame_id,
  };
}

/**
 * Encode a ROS 2 message to CDR (little-endian) for the given type.
 * Supports: geometry_msgs/msg/Twist.
 */
export function encodeCdr(typeStr: string, msg: Record<string, unknown>): Uint8Array {
  const type = normalizeType(typeStr);

  if (type === "geometry_msgs/msg/Twist") {
    const linear = (msg["linear"] as Record<string, unknown>) ?? {};
    const angular = (msg["angular"] as Record<string, unknown>) ?? {};
    const writer = new CdrWriter({ kind: CDR_LE });
    writer.align(8, 48);
    writer.float64(Number(linear["x"] ?? 0));
    writer.float64(Number(linear["y"] ?? 0));
    writer.float64(Number(linear["z"] ?? 0));
    writer.float64(Number(angular["x"] ?? 0));
    writer.float64(Number(angular["y"] ?? 0));
    writer.float64(Number(angular["z"] ?? 0));
    return new Uint8Array(writer.data.buffer, 0, writer.size);
  }

  throw new Error(`Zenoh CDR encode not implemented for type: ${typeStr}`);
}

/**
 * Decode a CDR payload to a plain object for the given type.
 * Supports: geometry_msgs/msg/Twist.
 */
export function decodeCdr(typeStr: string, data: Uint8Array): Record<string, unknown> {
  const type = normalizeType(typeStr);
  const reader = new CdrReader(new DataView(data.buffer, data.byteOffset, data.byteLength));

  if (type === "geometry_msgs/msg/Twist") {
    reader.seekTo(8);
    const linear = {
      x: reader.float64(),
      y: reader.float64(),
      z: reader.float64(),
    };
    const angular = {
      x: reader.float64(),
      y: reader.float64(),
      z: reader.float64(),
    };
    return { linear, angular };
  }

  if (type === "sensor_msgs/msg/CompressedImage") {
    reader.seekTo(4);
    const header = readStdMsgsHeader(reader);
    const format = reader.string();
    const dataLen = reader.sequenceLength();
    const payload = reader.uint8Array(dataLen);
    return {
      header,
      format,
      data: Array.from(payload),
    };
  }

  if (type === "sensor_msgs/msg/Image") {
    reader.seekTo(4);
    const header = readStdMsgsHeader(reader);
    const height = reader.uint32();
    const width = reader.uint32();
    const encoding = reader.string();
    const is_bigendian = reader.uint8();
    const step = reader.uint32();
    const dataLen = reader.sequenceLength();
    const payload = reader.uint8Array(dataLen);
    return {
      header,
      height,
      width,
      encoding,
      is_bigendian,
      step,
      data: Array.from(payload),
    };
  }

  throw new Error(`Zenoh CDR decode not implemented for type: ${typeStr}`);
}

/** Check if we can encode/decode the given type. */
export function isCdrTypeSupported(typeStr: string): boolean {
  const type = normalizeType(typeStr);
  return (
    type === "geometry_msgs/msg/Twist" ||
    type === "sensor_msgs/msg/Image" ||
    type === "sensor_msgs/msg/CompressedImage"
  );
}
