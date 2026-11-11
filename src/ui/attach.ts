import type { Attachment } from 'svelte/attachments';

/** 元素滚出屏幕时给它加 .paused，CSS 动画随之暂停 */
export const pauseOffscreen: Attachment<Element> = el => {
  const io = new IntersectionObserver(([e]) => el.classList.toggle('paused', !e.isIntersecting));
  io.observe(el);
  return () => io.disconnect();
};
