<script lang="ts">
  import { store as s, keyLine, keyLineMember, go } from '../../lib/store.svelte';
  import { switchKeyLine } from '../../lib/actions';
  import { latText } from '../../lib/format';
  import { pauseOffscreen } from '../attach';

  /* 地球上的定位点：按出口地区粗略放置，没有的放中间 */
  const PIN: Record<string, [number, number]> = {
    'US·TX': [38, 48], 'US·CA': [22, 50], 'US·NY': [44, 44], 'US·WA': [24, 40],
    JP: [86, 46], HK: [78, 56], SG: [76, 70], DE: [60, 36], GB: [54, 34], CN: [74, 50],
  };

  const group = $derived(s.proxies?.groups.find(g => g.name === keyLine.group));
  const member = $derived(group ? keyLineMember() : undefined);
  const exit = $derived(member ? s.exits[member] : undefined);
  const verified = $derived(!!exit && (!keyLine.expectIp || exit.ip === keyLine.expectIp));
  const pin = $derived(PIN[exit?.region ?? ''] ?? PIN[exit?.region?.split('·')[0] ?? ''] ?? [56, 52]);

  function memberSub(name: string): string {
    const g = s.proxies?.groups.find(x => x.name === name);
    const nodeName = g?.now ?? name;
    return `${nodeName} · ${latText(s.proxies?.nodes[nodeName]?.delay ?? null)}`;
  }
</script>

{#if group}
  <section class="card claude" style="cursor:pointer" role="button" tabindex="0" {@attach pauseOffscreen}
    onclick={e => !(e.target as Element).closest('.pick') && go('proxy')}
    onkeydown={e => e.key === 'Enter' && go('proxy')}>
    <div>
      <div class="lbl">{keyLine.name}{#if verified}<span class="verified">已核对</span>{/if}</div>
      <div class="ip">{exit?.ip ?? '未核对'}</div>
      <div class="geo">{#if exit}<b>{exit.region}</b> {exit.city} · {exit.isp}{:else}经 {member}{/if}</div>
    </div>
    <svg class="globe" viewBox="0 0 112 112" aria-hidden="true">
      <defs><pattern id="dots" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="currentColor" /></pattern>
        <clipPath id="gc"><circle cx="56" cy="56" r="46" /></clipPath></defs>
      <circle cx="56" cy="56" r="50" fill="none" stroke="var(--line-2)" stroke-dasharray="2 4" />
      <g clip-path="url(#gc)" style="color:var(--ink-3)" opacity=".7">
        <path d="M10 40c10-8 24-14 34-12s10 10 20 9 16-10 30-6 10 14 4 20-20 4-26 12-2 18-12 22-18-4-22-14-14-6-20-14-10-12-8-17z" fill="url(#dots)" />
      </g>
      <circle cx="56" cy="56" r="46" fill="none" stroke="var(--line-2)" />
      <circle cx={pin[0]} cy={pin[1]} r="5" fill="var(--lime)" stroke="var(--s1)" stroke-width="2" />
      <circle class="ripple" cx={pin[0]} cy={pin[1]} r="5" fill="none" stroke="var(--lime)" stroke-width="2" />
    </svg>
    <div class="pick" style="grid-template-columns:repeat({Math.min(group.all.length, 3)}, 1fr)">
      {#each group.all.slice(0, 3) as m (m)}
        <button class:on={m === member} onclick={() => switchKeyLine(m)}><b>{m}</b><small>{memberSub(m)}</small></button>
      {/each}
    </div>
  </section>
{/if}
