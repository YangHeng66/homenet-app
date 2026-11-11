<script lang="ts">
  import { store as s, conn, moduleError, retryAll } from '../../lib/store.svelte';
  import { MODULE_NAME, type ModuleKey } from '../../lib/session';
  import { editCurrentProfile } from '../../lib/profile-actions';
  import { openScreen } from '../../lib/ui.svelte';
  import Icon from './Icon.svelte';

  let { module: m, compact = false }: { module: ModuleKey; compact?: boolean } = $props();
  const err = $derived(moduleError(m));
  const host = $derived.by(() => { try { return new URL(conn.profile[m]?.url ?? '').host; } catch { return ''; } });
  let busy = $state(false);
  async function retry() { busy = true; try { await retryAll(); } finally { busy = false; } }
</script>

{#if !conn[m]}
  <!-- 这套配置没有这个模块 -->
{:else if err}
  <section class="card merr full" class:compact data-kind={err.kind} role="alert">
    <span class="mic"><Icon name={err.kind === 'auth' ? 'shield' : err.kind === 'blocked' ? 'globe' : 'warn'} /></span>
    <div class="mt">
      <b>{err.title}</b>
      <small class="mono">{MODULE_NAME[m]}{host ? ` · ${host}` : ''}</small>
    </div>
    {#if !compact}<p>{err.hint}</p>{/if}
    <div class="actions">
      {#if err.action !== 'none'}<button class="btn sm" class:busy disabled={busy} onclick={retry}><Icon name="sync" />{busy ? '正在重试' : '重试'}</button>{/if}
      {#if err.action === 'edit' || err.kind === 'network' || err.kind === 'timeout'}<button class="btn sm" class:pri={err.action === 'edit'} onclick={editCurrentProfile}>修改配置</button>{/if}
      {#if !compact}<button class="btn sm" onclick={() => openScreen({ kind: 'profiles' })}>切换配置</button>{/if}
    </div>
  </section>
{:else if !s.health[m] && !compact}
  <section class="card merr full loading" aria-busy="true">
    <span class="mic"><Icon name="sync" /></span>
    <div class="mt"><b>正在连接{MODULE_NAME[m]}</b><small class="mono">{host}</small></div>
  </section>
{/if}

<style>
  .merr { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 4px 12px; align-items: center; padding: 14px 16px; border-color: var(--mx-coral-25); background: var(--mx-coral-10); }
  .merr[data-kind='auth'], .merr[data-kind='blocked'] { border-color: var(--mx-amber-40); background: var(--mx-amber-16); }
  .merr.loading { border-color: var(--line); background: var(--s1); }
  .mic { width: 40px; height: 40px; border-radius: 13px; display: grid; place-items: center; background: var(--s1); color: var(--coral); }
  .merr[data-kind='auth'] .mic, .merr[data-kind='blocked'] .mic { color: var(--amber); }
  .loading .mic { color: var(--ink-3); }
  .loading .mic :global(svg) { animation: spin 1.2s linear infinite; }
  .mic :global(svg) { width: 20px; height: 20px; }
  .mt { min-width: 0; }
  .mt b { display: block; font-size: 15px; }
  .mt small { display: block; font-size: 11px; color: var(--ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { grid-column: 1 / -1; margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: var(--ink-2); }
  .actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .compact .actions { grid-column: 2; margin-top: 2px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .loading .mic :global(svg) { animation: none; } }
</style>
