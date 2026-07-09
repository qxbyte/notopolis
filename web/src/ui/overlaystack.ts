/**
 * ui/overlaystack.ts — 浮层层级栈。
 * Esc 永远先关最上层浮层，栈空时才由 main.ts 执行「回世界地图」。
 */
type CloseFn = () => void;
const stack: CloseFn[] = [];

/** 浮层打开时调用；返回的函数在浮层被用户主动关闭时调用（把自己出栈，不触发 close） */
export function pushOverlay(close: CloseFn): () => void {
  stack.push(close);
  return () => {
    const i = stack.indexOf(close);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Esc 入口：有浮层则关最上层并返回 true */
export function closeTopOverlay(): boolean {
  const top = stack.pop();
  if (!top) return false;
  top();
  return true;
}

/** 视图切换（dispose）时清空，防止悬挂引用 */
export function clearOverlays(): void {
  stack.length = 0;
}

/** 当前浮层数量（测试辅助） */
export function overlayCount(): number {
  return stack.length;
}
