<script lang="ts">
  import { store as s, go, type Page } from '../lib/store.svelte';
  import Icon from './parts/Icon.svelte';
  import type { IconName } from '../lib/icons';
  const items: [Page, IconName, string][] = [['home', 'navHome', '首页'], ['proxy', 'globe', '代理'], ['dev', 'router', '设备'], ['more', 'navMore', '更多']];
</script>

<nav class="nav" aria-label="页面">
  {#each items as [p, ic, n] (p)}
    <button class:on={s.page === p} onclick={() => go(p)} aria-label={n} aria-current={s.page === p ? 'page' : undefined}><Icon name={ic} /><span>{n}</span></button>
  {/each}
</nav>
