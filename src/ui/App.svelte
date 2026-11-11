<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { store as s, go, loadCore, boot } from '../lib/store.svelte';
  import { ui, toast, closeTopLayer } from '../lib/ui.svelte';
  import { onBackButton, onAppActive } from '../lib/native';
  import { pausePolling, resumePolling } from '../lib/poll';
  import Header from './Header.svelte';
  import Nav from './Nav.svelte';
  import Dock from './Dock.svelte';
  import ConfirmSheet from './ConfirmSheet.svelte';
  import DetailSheet from './DetailSheet.svelte';
  import Home from './pages/Home.svelte';
  import Proxy from './pages/Proxy.svelte';
  import Devices from './pages/Devices.svelte';
  import More from './pages/More.svelte';
  import Wizard from './screens/Wizard.svelte';
  import Profiles from './screens/Profiles.svelte';
  import Export from './screens/Export.svelte';
  import Import from './screens/Import.svelte';

  let ready = $state(false);
  let marked = false;

  // 每次切换配置（session 变化）重新拉首屏
  $effect(() => {
    if (s.view !== 'app') return;
    const my = s.session;
    untrack(() => (ready = false));
    // 局域网正常时首屏数据一两百毫秒就回来；设备离线时不等满超时，1.2 秒后先渲染，让“正在连接”和错误卡顶上
    const first = untrack(loadCore);
    Promise.race([first, new Promise(r => setTimeout(r, 1200))]).finally(() => {
      if (my !== s.session) return;
      ready = true;
      // 首页数据画出来的时刻；经 WebView 调试接口读这个 mark 来量冷启动
      if (!marked) { marked = true; requestAnimationFrame(() => performance.mark('homenet-first-data')); }
    });
  });

  onMount(() => {
    boot();
    onBackButton(() => {
      if (closeTopLayer()) return true;
      if (s.page !== 'home') { go('home'); return true; }
      return false;
    }, () => toast('再按一次退出'));
    onAppActive(active => {
      document.documentElement.classList.toggle('bg', !active);
      if (active) resumePolling(); else pausePolling();
    });
  });
</script>

<!-- 设备插画共用的渐变：放在常驻的 svg 里，切页时引用才不失效 -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <linearGradient id="gF" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a4046" /><stop offset="1" stop-color="#1f2327" /></linearGradient>
    <linearGradient id="gT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4f4ef" /><stop offset="1" stop-color="#c9cbc4" /></linearGradient>
    <radialGradient id="gG" cx=".35" cy=".3"><stop offset="0" stop-color="#e9ff8a" /><stop offset=".55" stop-color="#b7e21f" /><stop offset="1" stop-color="#5d7a00" /></radialGradient>
  </defs>
</svg>

<div class="app">
  {#if ui.screen}
    {#key ui.screen}
      {#if ui.screen.kind === 'wizard'}<Wizard base={ui.screen.base} prefill={ui.screen.prefill} first={s.view === 'welcome'} />
      {:else if ui.screen.kind === 'profiles'}<Profiles />
      {:else if ui.screen.kind === 'export'}<Export profile={ui.screen.profile} />
      {:else}<Import />{/if}
    {/key}
  {:else if s.view === 'welcome'}
    <Wizard first />
  {:else if s.view === 'app'}
    {#key s.session}
      <Header />
      {#if ui.dock}<Dock />{/if}
      {#if ready}
        {#if s.page === 'home'}<Home />
        {:else if s.page === 'proxy'}<Proxy />
        {:else if s.page === 'dev'}<Devices />
        {:else}<More />{/if}
      {/if}
    {/key}
  {/if}
</div>

{#if s.view === 'app' && !ui.screen}<Nav />{/if}
<ConfirmSheet />
<DetailSheet />
<div class="toast" class:show={ui.toastOn} role="status">{ui.toast}</div>
