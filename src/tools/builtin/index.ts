export { bashTool } from "./bash.js";
export { readTool } from "./read.js";
export { writeTool } from "./write.js";
export { editTool } from "./edit.js";

import type { Tool } from "../../core/types.js";
import { bashTool } from "./bash.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";

export function getBuiltinTools(): Tool[] {
  return [bashTool, readTool, writeTool, editTool];
}
