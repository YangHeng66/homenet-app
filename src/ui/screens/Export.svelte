<script lang="ts">
  import type { Profile } from '../../lib/types';
  import { encodeProfile, MIN_PASS } from '../../lib/share';
  import { qrSvg } from '../../lib/qr';
  import { closeScreen, toast } from '../../lib/ui.svelte';
  import Icon from '../parts/Icon.svelte';
  import Switch from '../parts/Switch.svelte';

  let { profile }: { profile: Profile } = $props();
  const hasSecret = $derived(!!(profile.router?.secret || profile.mihomo?.secret || profile.ufi?.secret));
  let withPw = $state(false);
  let pass = $state('');
  let text = $state('');
  let err = $state('');

  $effect(() => {
    const want = withPw;
    const pw = pass;
    err = '';
    if (want && pw.length < MIN_PASS) { text = ''; return; }
    let live = true;
    encodeProfile(profile, want ? pw : undefined).then(t => { if (live) text = t; }, e => { if (live) err = (e as Error).message; });
    return () => { live = false; };
  });
  const svg = $derived(text ? qrSvg(text) : '');

  async function copy() {
    try { await navigator.clipboard.writeText(text); toast('已复制，可以粘贴到聊天里发给对方'); } catch { toast('复制失败，请长按下面的文本手动复制'); }
  }
</script>

<main class="page wiz">
  <header class="whead">
    <button class="icon-btn" aria-label="返回" onclick={closeScreen}><Icon name="back" /></button>
    <div><small class="mono">分享配置</small><h2>{profile.name}</h2></div>
  </header>

  <section class="card pad">
    <div class="qrbox" class:empty={!svg}>
      {#if svg}{@html svg}{:else}<span>{withPw ? `设一个至少 ${MIN_PASS} 位的口令` : '正在生成'}</span>{/if}
    </div>
    <div class="swrow" style="margin-top:12px">
      <b>包含密码</b><Switch on={withPw} onchange={v => (withPw = v)} label="包含密码" />
      <small>{hasSecret ? (withPw ? '用口令加密，对方导入时要输入口令' : '不带密码，对方导入后自己填') : '这套配置没有保存密码'}</small>
    </div>
    {#if withPw}
      <label class="fld"><span>口令</span><input type="password" bind:value={pass} placeholder="至少 {MIN_PASS} 位" autocomplete="new-password" /></label>
      <p class="hint2 warnline"><Icon name="warn" /><span>口令别和二维码一起发：二维码发聊天，口令当面或电话告诉对方。</span></p>
    {/if}
    {#if err}<p class="hint2 warnline"><Icon name="warn" /><span>{err}</span></p>{/if}
    <div class="lbl" style="margin-top:14px">文本<span class="r mono dim">{text.length} 字符</span></div>
    <textarea readonly rows="3" value={text} onfocus={e => (e.currentTarget as HTMLTextAreaElement).select()}></textarea>
    <div class="actions"><button class="btn pri" disabled={!text} onclick={copy}><Icon name="copy" />复制文本</button></div>
  </section>
  <p class="hint2"><Icon name="info" /><span>二维码里有设备地址{withPw ? '和加密后的密码' : ''}，只发给信得过的人。对方在「设置 → 配置 → 导入」里扫码或粘贴。</span></p>
</main>

<style>
  .qrbox { width: min(100%, 280px); aspect-ratio: 1; margin: 4px auto 0; border-radius: 18px; background: #fff; padding: 10px; display: grid; place-items: center; }
  .qrbox :global(svg) { width: 100%; height: 100%; display: block; }
  .qrbox.empty { background: var(--s2); color: var(--ink-3); font-size: 13px; text-align: center; }
  textarea { resize: none; color: var(--ink-2); }
</style>
