/*
 * 全 App 只有这一个定时器。页面挂载时登记要刷新的任务，卸载时注销；
 * App 进后台或页面隐藏时停掉，回到前台立即补一拍。
 */
type Task = () => unknown;

const tasks = new Set<Task>();
let before: Task | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let interval = 2000;
let paused = false;
let running = false;

function schedule() {
  clearTimeout(timer);
  if (paused || !tasks.size) return;
  timer = setTimeout(run, interval);
}

async function run() {
  if (running) return;
  running = true;
  try {
    before?.();
    await Promise.allSettled([...tasks].map(t => t()));
  } finally {
    running = false;
    schedule();
  }
}

/** 登记一个刷新任务，返回注销函数。immediate 时先执行一次。 */
export function poll(task: Task, immediate = true): () => void {
  tasks.add(task);
  if (immediate) Promise.resolve().then(task).catch(() => {});
  if (tasks.size === 1) schedule();
  return () => {
    tasks.delete(task);
    if (!tasks.size) clearTimeout(timer);
  };
}

/** 每拍最先执行（演示模式用来推进假数据） */
export function beforeEachTick(task: Task | null) {
  before = task;
}

export function setPollInterval(sec: number) {
  interval = sec * 1000;
  schedule();
}

export function pausePolling() {
  paused = true;
  clearTimeout(timer);
}

export function resumePolling() {
  if (!paused) return;
  paused = false;
  run();
}
