<script lang="ts">
  import { conn, profiles, store as s } from '../../lib/store.svelte';
  import { closeScreen, openScreen } from '../../lib/ui.svelte';
  import { deleteProfile, editProfile, exportProfile, modulesText, useProfile } from '../../lib/profile-actions';
  import Icon from '../parts/Icon.svelte';

  let list = $state(profiles.list());
  const current = $derived(s.view === 'app' ? conn.profile.id : null);
  async function del(id: string) { if (await deleteProfile(id)) list = profiles.list(); }
</script>

<main class="page wiz">
  <header class="whead">
    <button class="icon-btn" aria-label="返回" onclick={closeScreen}><Icon name="back" /></button>
    <div><small class="mono">设置</small><h2>配置</h2></div>
  </header>

  {#if !profiles.secretsPersistent}
    <p class="hint2 warnline"><Icon name="info" /><span>浏览器调试环境：密码只存在内存里，刷新页面后要重新填写。装到手机上会存进系统 Keystore。</span></p>
  {/if}

  <section class="card">
    <div class="list">
      {#each list as p (p.id)}
        <div class="li prow" class:cur={p.id === current}>
          <button class="pick" onclick={() => useProfile(p.id)} aria-label="切换到 {p.name}">
            <span class="ic"><Icon name={p.demo ? 'spark' : 'home'} /></span>
            <b><span class="nm">{p.name}</span>{#if p.id === current}<em class="tag">正在用</em>{/if}</b>
            <small>{modulesText(p)}{p.allowPublic ? ' · 允许公网' : ''}</small>
          </button>
          {#if !p.demo}
            <div class="ops">
              <button class="btn sm" aria-label="编辑 {p.name}" onclick={() => editProfile(p.id)}><Icon name="edit" /></button>
              <button class="btn sm" aria-label="分享 {p.name}" onclick={() => exportProfile(p.id)}><Icon name="qr" /></button>
              <button class="btn sm danger" aria-label="删除 {p.name}" onclick={() => del(p.id)}><Icon name="x" /></button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <div class="actions">
    <button class="btn pri" onclick={() => openScreen({ kind: 'wizard' })}><Icon name="plus" />新建配置</button>
    <button class="btn" onclick={() => openScreen({ kind: 'import' })}><Icon name="scan" />导入</button>
  </div>
  <p class="hint2"><Icon name="shield" /><span>分享的二维码默认不带密码；要带密码时会用你设的口令加密。</span></p>
</main>

<style>
  .prow { grid-template-columns: minmax(0, 1fr) auto; }
  .prow:first-child { border-top: 0; }
  .pick { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 2px 12px; align-items: center; text-align: left; min-width: 0; }
  .pick .ic { grid-row: span 2; }
  .pick b { display: flex; align-items: center; min-width: 0; }
  .pick .nm, .pick small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick small { grid-column: 2; }
  .cur .ic { background: var(--lime); color: var(--lime-ink); }
  .ops { display: flex; gap: 6px; }
  .ops .btn { width: 34px; padding: 0; }
  .ops .btn :global(svg) { width: 15px; height: 15px; }
  .tag { margin-left: 6px; flex: none; }
  .actions { display: flex; gap: 10px; }
  .actions .btn { flex: 1; }
</style>
