<script lang="ts">
  import { onMount } from 'svelte';
  import { store as s, conn, refreshUfi, refreshRouter, refreshClients, loadF50, loadRouterPage } from '../../lib/store.svelte';
  import { poll } from '../../lib/poll';
  import F50 from '../devices/F50.svelte';
  import Router from '../devices/Router.svelte';
  import Icon from '../parts/Icon.svelte';
  import { editCurrentProfile } from '../../lib/profile-actions';

  let dev = $state<'f50' | 'tr'>(conn.ufi ? 'f50' : 'tr');

  onMount(() => {
    loadF50();
    loadRouterPage();
    return poll(() => (dev === 'f50' ? refreshUfi() : Promise.all([refreshRouter(), refreshClients()])), false);
  });

  const short = (v: string | undefined, d: string) => (v ? v.split(/\s+/).at(-1)! : d);
</script>

<main class="page">
  {#if conn.ufi && conn.router}
    <div class="devsw full">
      <button class="devbtn" class:on={dev === 'f50'} onclick={() => (dev = 'f50')}>
        <svg viewBox="0 0 46 46"><rect x="9" y="3" width="28" height="40" rx="8" fill="#2b3035" stroke="rgba(255,255,255,.15)" /><rect x="13" y="8" width="20" height="13" rx="3" fill="#0c0e0f" /><text x="23" y="17.5" text-anchor="middle" font-family="Geist Mono" font-size="6.5" font-weight="700" fill="#d4ff3a">5G</text></svg>
        <div><b>{short(s.ufi?.model, 'F50')}</b><small>{s.ufi ? `${s.ufi.signal.network} · ${s.ufi.temps.board}°` : '—'}</small></div>
      </button>
      <button class="devbtn" class:on={dev === 'tr'} onclick={() => (dev = 'tr')}>
        <svg viewBox="0 0 46 46"><rect x="9" y="4" width="3.5" height="20" rx="1.7" fill="#c9cbc4" transform="rotate(-12 10 24)" /><rect x="33" y="4" width="3.5" height="20" rx="1.7" fill="#c9cbc4" transform="rotate(12 35 24)" /><rect x="4" y="20" width="38" height="22" rx="7" fill="#eceee8" /><circle cx="12" cy="31" r="1.8" fill="#45d483" /><circle cx="18" cy="31" r="1.8" fill="#45d483" /></svg>
        <div><b>{short(s.board?.model, '路由器')}</b><small>OpenWrt · {s.clients.length} 台</small></div>
      </button>
    </div>
  {/if}
  {#if !conn.ufi && !conn.router}
    <section class="card pad full">
      <div class="lbl">设备</div>
      <p class="hint2"><Icon name="info" /><span>这套配置没有填路由器和 F50。填上后这里能看在线设备、开关 Wi-Fi、锁频。</span></p>
      <div class="actions"><button class="btn pri" onclick={editCurrentProfile}>修改配置</button></div>
    </section>
  {:else if dev === 'f50'}<F50 />{:else}<Router />{/if}
</main>
