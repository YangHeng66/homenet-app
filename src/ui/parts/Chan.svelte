<script lang="ts" generics="K extends string">
  let { options, value, onpick, style = '', id }: { options: [K, string][]; value: K; onpick: (k: K) => void; style?: string; id?: string } = $props();
</script>

<div class="chan" {style} {id}>
  {#each options as [k, n] (k)}
    <button class:on={value === k} onclick={() => onpick(k)}>{n}</button>
  {/each}
</div>
