<script lang="ts">
  import { decodeProfile, isShareText } from '../../lib/share';
  import { scanQr } from '../../lib/qr';
  import { isNative } from '../../lib/native';
  import { closeScreen, openScreen, toast } from '../../lib/ui.svelte';
  import Icon from '../parts/Icon.svelte';

  let text = $state('');
  let pass = $state('');
  let needPass = $state(false);
  let err = $state('');
  let busy = $state(false);

  async function scan() {
    err = '';
    try {
      const t = await scanQr();
      if (!t) return;
      text = t;
      await go();
    } catch (e) {
      err = `扫码失败：${(e as Error)?.message ?? e}`;
    }
  }

  async function paste() {
    try { text = await navigator.clipboard.readText(); } catch { toast('读不到剪贴板，请长按输入框粘贴'); }
  }

  async function go() {
    err = '';
    if (!isShareText(text)) { err = '这不是 HomeNet 的配置。应该以 homenet: 开头'; return; }
    busy = true;
    try {
      const r = await decodeProfile(text, needPass ? pass : undefined);
      if (r.ok) {
        openScreen({ kind: 'wizard', prefill: r.profile });
        toast(r.encrypted ? '已解密，确认一下再保存' : '不含密码，填上自己的密码再保存');
      } else if (r.reason === 'need-pass') { needPass = true; err = ''; }
      else if (r.reason === 'bad-pass') err = '口令不对';
      else err = '内容不完整或被改过，请让对方重新生成';
    } finally { busy = false; }
  }
</script>

<main class="page wiz">
  <header class="whead">
    <button class="icon-btn" aria-label="返回" onclick={closeScreen}><Icon name="back" /></button>
    <div><small class="mono">配置</small><h2>导入</h2></div>
  </header>

  <section class="card pad">
    <button class="btn pri big" onclick={scan}><Icon name="scan" />扫描二维码</button>
    {#if !isNative}<small class="sub mono">浏览器里会请求摄像头权限；没有摄像头就用下面的粘贴</small>{/if}
    <div class="lbl" style="margin-top:18px">或者粘贴文本<span class="r"><button class="btn sm" onclick={paste}>从剪贴板粘贴</button></span></div>
    <textarea rows="4" bind:value={text} oninput={() => { needPass = false; err = ''; }} placeholder="homenet:1:…" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
    {#if needPass}
      <label class="fld"><span>口令</span><input type="password" bind:value={pass} placeholder="对方告诉你的口令" autocomplete="off" /></label>
      <small class="sub mono">这份配置带密码，已加密</small>
    {/if}
    {#if err}<p class="hint2 warnline" role="alert"><Icon name="warn" /><span>{err}</span></p>{/if}
    <div class="actions"><button class="btn" disabled={!text.trim() || busy || (needPass && !pass)} onclick={go}>{busy ? '正在解密' : needPass ? '解密并导入' : '识别'}</button></div>
  </section>
  <p class="hint2"><Icon name="info" /><span>导入后会进入设置向导，可以检查地址、补上密码、测试连接，确认后才保存。</span></p>
</main>

<style>
  .btn.big { width: 100%; min-height: 52px; font-size: 15px; border-radius: 16px; }
  .sub { display: block; margin-top: 6px; font-size: 11px; color: var(--ink-3); }
  textarea { resize: vertical; }
</style>
