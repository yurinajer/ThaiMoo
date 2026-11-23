export type LeaveGuard = (from: string, to: string) => boolean;

let guard: LeaveGuard | null = null;

// 路由是 hash 直写的，页面拦不住自己的卸载；这里留一个唯一的离开闸口，
// 由 router 在清容器之前询问，放行后自动摘除，避免守卫漂到别的页面上。
export function setLeaveGuard(next: LeaveGuard | null): void {
  guard = next;
}

export function allowLeave(from: string, to: string): boolean {
  if (!guard) return true;
  if (!guard(from, to)) return false;
  guard = null;
  return true;
}
