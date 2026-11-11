<script lang="ts">
  import { onMount } from 'svelte';
  import { store as s, conn, keyLine, keyLineMember, go, moduleError } from '../lib/store.svelte';
  import { MODULE_NAME } from '../lib/session';
  import { poll } from '../lib/poll';
  import Icon from './parts/Icon.svelte';

  let now = $state(new Date());
  onMount(() => poll(() => { const d = new Date(); if (d.getMinutes() !== now.getMinutes()) now = d; }, false));

  const date = $derived(`${now.getMonth() + 1}月${now.getDate()}日 周${'日一二三四五六'[now.getDay()]} · ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`);
  const hello = $derived.by(() => { const h = now.getHours(); return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; });
  const member = $derived(s.proxies ? keyLineMember() : undefined);
  const mods = (['router', 'mihomo', 'ufi'] as const).filter(m => conn[m]);
  const errs = $derived(mods.filter(m => moduleError(m)));
  const pending = $derived(mods.some(m => !s.health[m]));
  const health = $derived(
    errs.length === 1 ? moduleError(errs[0])!.title
    : errs.length ? `${errs.map(m => MODULE_NAME[m]).join('、')} 出错`
    : pending ? '正在连接设备…'
    : member ? `全部正常 · ${keyLine.name} 走 ${member}` : '全部正常',
  );
  const unread = $derived(s.alerts.some(a => a.unread));
</script>

<header class="hello">
  <div class="who">
    <small>{date}</small>
    <h1><span>{hello}</span></h1>
    <div class="health" class:bad={errs.length > 0} class:wait={!errs.length && pending}><i></i>{health}</div>
  </div>
  <button class="icon-btn" aria-label="告警" onclick={() => go('more')}><Icon name="bell" />{#if unread}<span class="dot"></span>{/if}</button>
</header>
